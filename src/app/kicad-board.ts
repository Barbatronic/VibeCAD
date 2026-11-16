/**
 * Carte KiCad dans le projet : un ensemble au nom de la carte, qui contient la carte (contour
 * extrudé à son épaisseur, trous de fixation percés) et ses composants en blocs. Les composants de
 * même forme partagent une pièce, posée autant de fois qu'il le faut (copies liées) ; chaque
 * exemplaire porte le repère du composant (R1, J3…). Voir io/kicad-pcb.ts.
 */
import { addFeature, addPart, findPart, makeExtrudeFeature, makePrimitiveFeature, makeSketchFeature } from '../domain/document';
import { createId } from '../domain/ids';
import type { AssemblyInstance, CadDocument, Id, SketchEntity, SketchParams } from '../domain/model';
import { addSubassembly, addSubassemblyInstance } from '../domain/subassemblies';
import { estimatedHeight, modelBox, type BoardComponent, type KicadBoard, type OutlineSegment } from '../io/kicad-pcb';
import type { Vec2, Vec3 } from '../math/vec';

export type Box3 = { min: Vec3; max: Vec3 };

const BOARD_COLOR = '#2e7d4f';
const PART_COLOR = '#34373c';
const CONNECTOR_COLOR = '#e4dfd2';

/** Écart sous lequel deux extrémités du contour sont le même point (mm). */
const JOIN = 1e-3;

/** Contour en boucles : segments mis bout à bout, cercles seuls. */
function loops(segments: OutlineSegment[]): { segments: OutlineSegment[] }[] {
  const near = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) <= JOIN && Math.abs(p.y - q.y) <= JOIN;
  const reverse = (s: OutlineSegment): OutlineSegment => (s.kind === 'line' ? { kind: 'line', a: s.b, b: s.a } : s.kind === 'arc' ? { kind: 'arc', a: s.b, mid: s.mid, b: s.a } : s);
  type Open = Exclude<OutlineSegment, { kind: 'circle' }>;
  const left = segments.filter((s): s is Open => s.kind !== 'circle');
  const out: { segments: OutlineSegment[] }[] = segments.filter((s) => s.kind === 'circle').map((s) => ({ segments: [s] }));
  while (left.length) {
    const chain: Open[] = [left.shift()!];
    for (;;) {
      const tail = chain[chain.length - 1]!.b;
      const head = chain[0]!.a;
      if (chain.length > 1 && near(head, tail)) break;
      const i = left.findIndex((s) => near(s.a, tail) || near(s.b, tail));
      if (i < 0) break;
      const s = left.splice(i, 1)[0]!;
      chain.push(near(s.a, tail) ? s : (reverse(s) as Open));
    }
    out.push({ segments: chain });
  }
  return out;
}

/** Centre du cercle qui passe par trois points (null s'ils sont alignés). */
function circleThrough(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
}

/** Esquisse du contour de la carte et de ses trous ; les boucles partagent leurs sommets. */
export function boardSketch(board: KicadBoard, base: SketchParams): SketchParams {
  const entities: SketchEntity[] = [];
  let n = 0;
  const point = (p: Vec2): string => {
    const id = `p${++n}`;
    entities.push({ id, type: 'point', x: p.x, y: p.y });
    return id;
  };
  for (const loop of loops(board.outline)) {
    const first = loop.segments[0]!;
    if (first.kind === 'circle') {
      entities.push({ id: `c${++n}`, type: 'circle', center: point(first.center), radius: first.radius });
      continue;
    }
    const closed = loop.segments.length > 1;
    const starts = loop.segments.map((s) => point((s as Exclude<OutlineSegment, { kind: 'circle' }>).a));
    const endOf = (i: number) => (closed ? starts[(i + 1) % starts.length]! : point((loop.segments[i] as Exclude<OutlineSegment, { kind: 'circle' }>).b));
    loop.segments.forEach((s, i) => {
      const a = starts[i]!;
      const b = endOf(i);
      if (s.kind === 'line') entities.push({ id: `l${++n}`, type: 'line', a, b });
      else if (s.kind === 'arc') {
        const center = circleThrough(s.a, s.mid, s.b);
        if (!center) {
          entities.push({ id: `l${++n}`, type: 'line', a, b });
          return;
        }
        // Arc de l'esquisse : de `start` à `end` dans le sens trigonométrique.
        const ccw = (s.mid.x - s.a.x) * (s.b.y - s.mid.y) - (s.mid.y - s.a.y) * (s.b.x - s.mid.x) > 0;
        entities.push({ id: `a${++n}`, type: 'arc', center: point(center), start: ccw ? a : b, end: ccw ? b : a });
      }
    });
  }
  for (const h of board.holes) entities.push({ id: `c${++n}`, type: 'circle', center: point(h.center), radius: h.diameter / 2 });
  return { ...base, entities, constraints: [] };
}

/** Forme d'un composant : boîte dans le repère de l'empreinte, et d'où vient sa hauteur. */
export interface ComponentShape {
  box: Box3;
  fromModel: boolean;
}

const union = (a: Box3, b: Box3): Box3 => ({
  min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
  max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
});

/**
 * Boîte d'un composant dans le repère de l'empreinte telle qu'elle est posée sur la carte (Y vers
 * le haut ; Z positif : au-dessus de la carte côté dessus, en dessous côté dessous). Avec son
 * modèle 3D (`modelBoxes`, par nom de fichier) : sa boîte réelle ; sinon l'emprise de l'empreinte
 * et une hauteur estimée.
 */
export function componentShape(c: BoardComponent, modelBoxes: ReadonlyMap<string, Box3 | null>): ComponentShape {
  const footprint = c.box ?? { min: { x: -0.5, y: -0.5 }, max: { x: 0.5, y: 0.5 } };
  let model: Box3 | null = null;
  for (const m of c.models) {
    const raw = modelBoxes.get(m.file.toLowerCase());
    if (!raw) continue;
    const b = modelBox(m, raw);
    model = model ? union(model, b) : b;
  }
  if (model) {
    // Côté dessous : l'empreinte est retournée (miroir en Y) ; la hauteur part de la face du dessous.
    const flip = c.side === 'bottom';
    const xy = { min: { x: model.min.x, y: flip ? -model.max.y : model.min.y }, max: { x: model.max.x, y: flip ? -model.min.y : model.max.y } };
    // Garde-fou : un modèle dont la boîte ne recouvre pas l'empreinte (placement mal compris) ne donne que la hauteur.
    const overlaps = xy.min.x < footprint.max.x && xy.max.x > footprint.min.x && xy.min.y < footprint.max.y && xy.max.y > footprint.min.y;
    const plane = overlaps ? xy : footprint;
    const top = Math.max(0.05, model.max.z);
    return { box: { min: { x: plane.min.x, y: plane.min.y, z: Math.max(0, model.min.z) }, max: { x: plane.max.x, y: plane.max.y, z: top } }, fromModel: true };
  }
  const h = estimatedHeight(c.footprint, c.through);
  return { box: { min: { x: footprint.min.x, y: footprint.min.y, z: 0 }, max: { x: footprint.max.x, y: footprint.max.y, z: h } }, fromModel: false };
}

export interface BoardImportResult {
  doc: CadDocument;
  ensembleId: Id;
  components: number;
  fromModel: number;
  estimated: string[];
  parts: number;
}

/**
 * Ajoute la carte au projet. `modelBoxes` : boîte de chaque modèle 3D trouvé (clé : nom du fichier
 * en minuscules ; null : introuvable ou illisible).
 */
export function addKicadBoard(docIn: CadDocument, board: KicadBoard, modelBoxes: ReadonlyMap<string, Box3 | null>): BoardImportResult {
  let doc = docIn;
  // Carte : esquisse du contour et des trous, extrudée à l'épaisseur.
  const boardPart = addPart(doc, board.name);
  doc = { ...boardPart.doc, parts: boardPart.doc.parts.map((p) => (p.id === boardPart.partId ? { ...p, color: BOARD_COLOR } : p)) };
  const sketch = makeSketchFeature(doc, findPart(doc, boardPart.partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
  doc = addFeature(doc, boardPart.partId, { ...sketch, name: 'Contour', visible: false, params: boardSketch(board, sketch.params) });
  const extrude = makeExtrudeFeature(doc, findPart(doc, boardPart.partId)!, sketch.id, board.thickness);
  doc = addFeature(doc, boardPart.partId, { ...extrude, name: 'Épaisseur' });
  // Composants : une pièce par forme (empreinte, côté, boîte arrondie au centième).
  const shapes = new Map<string, { partId: Id; count: number }>();
  const instances: AssemblyInstance[] = [];
  const taken = new Set<string>();
  let fromModel = 0;
  const estimated: string[] = [];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  for (const c of board.components) {
    const shape = componentShape(c, modelBoxes);
    if (shape.fromModel) fromModel++;
    else estimated.push(c.ref || c.footprint);
    const b = shape.box;
    const key = [c.footprint, c.side, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => (typeof v === 'number' ? r2(v) : v)).join('|');
    let entry = shapes.get(key);
    if (!entry) {
      const short = c.footprint.split(':').pop() || c.ref || 'Composant';
      const sameName = [...shapes.keys()].filter((k) => k.startsWith(`${c.footprint}|`)).length;
      const name = sameName ? `${short} (${sameName + 1})` : short;
      const added = addPart(doc, name);
      doc = added.doc;
      const connector = /^(J|P|CN|X|USB)\d/i.test(c.ref) || /Connector|PinHeader|PinSocket|Molex|JST|USB/i.test(c.footprint);
      doc = { ...doc, parts: doc.parts.map((p) => (p.id === added.partId ? { ...p, color: connector ? CONNECTOR_COLOR : PART_COLOR } : p)) };
      const box = makePrimitiveFeature(doc, findPart(doc, added.partId)!);
      // Côté dessous : la pièce est dessinée vers le bas (Z négatif), sous la face du dessous.
      const z0 = c.side === 'bottom' ? -b.max.z : b.min.z;
      doc = addFeature(doc, added.partId, {
        ...box,
        name: shape.fromModel ? 'Boîtier' : 'Boîtier (hauteur estimée)',
        params: { ...box.params, position: { x: r2(b.min.x), y: r2(b.min.y), z: r2(z0) }, width: r2(Math.max(0.05, b.max.x - b.min.x)), depth: r2(Math.max(0.05, b.max.y - b.min.y)), height: r2(Math.max(0.05, b.max.z - b.min.z)) },
      });
      entry = { partId: added.partId, count: 0 };
      shapes.set(key, entry);
    }
    entry.count++;
    const id = createId('in', taken);
    taken.add(id);
    const z = c.side === 'bottom' ? 0 : board.thickness;
    instances.push({ id, partId: entry.partId, name: c.ref || c.footprint, position: { x: c.at.x, y: c.at.y, z }, ...(c.rotation ? { rotation: { x: 0, y: 0, z: c.rotation } } : {}) });
  }
  // Ensemble au nom de la carte : la carte, puis ses composants.
  const sub = addSubassembly(doc, board.name);
  doc = sub.doc;
  const boardInstance: AssemblyInstance = { id: createId('in', taken), partId: boardPart.partId, name: board.name, position: { x: 0, y: 0, z: 0 } };
  doc = { ...doc, subassemblies: doc.subassemblies!.map((s) => (s.id === sub.id ? { ...s, instances: [boardInstance, ...instances] } : s)) };
  doc = addSubassemblyInstance(doc, sub.id, { x: 0, y: 0, z: 0 }).doc;
  return { doc, ensembleId: sub.id, components: board.components.length, fromModel, estimated, parts: shapes.size };
}
