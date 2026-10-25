/**
 * Composants de la bibliothèque Barbatronic (dépôt VibeCAD-Components), construits par le modèle
 * métier comme le ferait l'utilisateur : esquisses, extrusions, poches, chanfreins, générateur
 * d'engrenages. `npm run library:build` les écrit en .vibecad (historique paramétrique) et en
 * .step (solide exact), avec leur fiche .json ; les vignettes .png viennent de la vue 3D.
 *
 * Un dossier = une collection (bearings/, motors/…) ; un composant = des fichiers de même nom.
 * Toutes les esquisses sont entièrement cotées (0 degré de liberté) : voir ./sketch.ts.
 */
import {
  addFeature,
  createDocument,
  findPart,
  makeChamferFeature,
  makeExtrudeFeature,
  makeGearFeature,
  makePocketFeature,
  makeSketchFeature,
  renamePart,
  setPartColor,
  setPartMaterial,
} from '../../src/domain/document';
import type { CadDocument, EdgeRef, Id, SketchSupport } from '../../src/domain/model';
import { circles, rectangle, solved } from './sketch';

export interface CollectionSpec {
  /** Nom du dossier. */
  id: string;
  name: string;
  description: string;
}

export interface ComponentSpec {
  collection: string;
  /** Nom des fichiers (sans extension). */
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Cotes principales (mm), affichées dans la fiche. */
  dimensions: Record<string, number>;
  build: () => CadDocument;
}

export const COLLECTIONS: CollectionSpec[] = [
  { id: 'bearings', name: 'Roulements', description: 'Roulements à billes à gorge profonde, avec flasques (2RS).' },
  { id: 'motors', name: 'Moteurs', description: 'Moteurs pas à pas NEMA, avec centreur, arbre et taraudages de fixation.' },
  { id: 'pulleys', name: 'Poulies', description: 'Poulies crantées GT2 pour courroie de 6 mm, alésage 5 mm.' },
  { id: 'couplers', name: 'Accouplements', description: 'Accouplements rigides entre deux arbres, avec vis de pression.' },
  { id: 'servos', name: 'Servomoteurs', description: 'Servomoteurs de modélisme : format standard (MG996R) et micro (SG90, MG90S), avec pattes de fixation et cannelure de sortie.' },
];

/** Pièce unique : nom, couleur, matière. */
function single(name: string, color: string, material: string): { doc: CadDocument; partId: Id } {
  let doc = createDocument(name);
  const partId = doc.parts[0]!.id;
  doc = setPartMaterial(setPartColor(renamePart(doc, partId, name), partId, color), partId, material);
  return { doc, partId };
}

/** Ajoute une esquisse de cercles sur un support ; renvoie l'esquisse et les identifiants des cercles. */
function circleSketch(doc: CadDocument, partId: Id, support: SketchSupport, list: { x: number; y: number; r: number }[]) {
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, support);
  const c = circles(sk.params, list);
  return { doc: addFeature(doc, partId, { ...sk, params: c.sketch }), sketchId: sk.id, circles: c.ids };
}

/** Roulement à billes : bague d × D × B, flasques en léger retrait, chanfreins. */
function bearing(code: string, d: number, D: number, B: number): ComponentSpec {
  return {
    collection: 'bearings',
    id: `${code.toLowerCase()}-2rs`,
    name: `Roulement ${code}-2RS`,
    description: `Roulement à billes ${code}-2RS : alésage ${d} mm, diamètre extérieur ${D} mm, largeur ${B} mm.`,
    tags: ['roulement', code, `${d}x${D}x${B}`],
    dimensions: { d, D, B },
    build: () => {
      let { doc, partId } = single(`Roulement ${code}-2RS`, '#b8c0ca', 'steel');
      const s1 = circleSketch(doc, partId, { kind: 'plane', plane: 'XY', offset: 0 }, [
        { x: 0, y: 0, r: D / 2 },
        { x: 0, y: 0, r: d / 2 },
      ]);
      doc = s1.doc;
      const ex = makeExtrudeFeature(doc, findPart(doc, partId)!, s1.sketchId, B);
      doc = addFeature(doc, partId, ex);
      const edge = (circle: string, role: 'start' | 'end'): EdgeRef => ({
        faces: [
          { featureId: ex.id, role: 'side', entityId: circle },
          { featureId: ex.id, role },
        ],
      });
      const c = Math.min(0.5, B / 12);
      doc = addFeature(doc, partId, makeChamferFeature(doc, findPart(doc, partId)!, s1.circles.flatMap((id) => [edge(id, 'start'), edge(id, 'end')]), c));
      // Flasques : anneau en retrait de 0,3 mm sur chaque face.
      const w = (D - d) / 2;
      const seal = [
        { x: 0, y: 0, r: D / 2 - w * 0.18 },
        { x: 0, y: 0, r: d / 2 + w * 0.28 },
      ];
      for (const role of ['end', 'start'] as const) {
        const s = circleSketch(doc, partId, { kind: 'face', ref: { featureId: ex.id, role } }, seal);
        doc = s.doc;
        doc = addFeature(doc, partId, makePocketFeature(doc, findPart(doc, partId)!, s.sketchId, { kind: 'distance', distance: 0.3 }));
      }
      return doc;
    },
  };
}

/** Moteur pas à pas NEMA 17 : corps 42,3 × 42,3 × L, centreur Ø 22, arbre Ø 5 × 24, taraudages M3. */
function nema17(length: number): ComponentSpec {
  return {
    collection: 'motors',
    id: `nema17-${length}`,
    name: `Moteur NEMA 17 × ${length} mm`,
    description: `Moteur pas à pas NEMA 17, corps de ${length} mm, arbre Ø 5 × 24 mm, centreur Ø 22 mm, 4 taraudages M3 à 31 mm d'entraxe.`,
    tags: ['moteur', 'pas à pas', 'NEMA 17'],
    dimensions: { A: 42.3, L: length, arbre: 5 },
    build: () => {
      let { doc, partId } = single(`Moteur NEMA 17 × ${length}`, '#6b7480', 'steel');
      const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
      const rect = rectangle(sk.params, 42.3, 42.3);
      doc = addFeature(doc, partId, { ...sk, params: solved(rect.sketch) });
      const ex = makeExtrudeFeature(doc, findPart(doc, partId)!, sk.id, length);
      doc = addFeature(doc, partId, ex);
      const corners: EdgeRef[] = rect.lines.map((l, i) => ({
        faces: [
          { featureId: ex.id, role: 'side', entityId: l },
          { featureId: ex.id, role: 'side', entityId: rect.lines[(i + 1) % 4]! },
        ],
      }));
      doc = addFeature(doc, partId, makeChamferFeature(doc, findPart(doc, partId)!, corners, 4));
      const boss = circleSketch(doc, partId, { kind: 'face', ref: { featureId: ex.id, role: 'end' } }, [{ x: 0, y: 0, r: 11 }]);
      doc = boss.doc;
      const exBoss = makeExtrudeFeature(doc, findPart(doc, partId)!, boss.sketchId, 2);
      doc = addFeature(doc, partId, exBoss);
      const shaft = circleSketch(doc, partId, { kind: 'face', ref: { featureId: exBoss.id, role: 'end' } }, [{ x: 0, y: 0, r: 2.5 }]);
      doc = shaft.doc;
      doc = addFeature(doc, partId, makeExtrudeFeature(doc, findPart(doc, partId)!, shaft.sketchId, 24));
      const m3 = [-15.5, 15.5].flatMap((x) => [-15.5, 15.5].map((y) => ({ x, y, r: 1.25 })));
      const taps = circleSketch(doc, partId, { kind: 'face', ref: { featureId: ex.id, role: 'end' } }, m3);
      doc = taps.doc;
      doc = addFeature(doc, partId, makePocketFeature(doc, findPart(doc, partId)!, taps.sketchId, { kind: 'distance', distance: 4.5 }));
      return doc;
    },
  };
}

/** Poulie GT2 (générateur d'engrenages), alésage 5 mm, flasques. */
function gt2(teeth: number): ComponentSpec {
  return {
    collection: 'pulleys',
    id: `gt2-${teeth}t-5mm`,
    name: `Poulie GT2 ${teeth} dents`,
    description: `Poulie crantée GT2 ${teeth} dents pour courroie de 6 mm, alésage 5 mm, avec flasques.`,
    tags: ['poulie', 'GT2', 'courroie'],
    dimensions: { dents: teeth, alésage: 5, largeur: 7 },
    build: () => {
      let { doc, partId } = single(`Poulie GT2 ${teeth} dents`, '#d9a441', 'aluminium');
      const gear = makeGearFeature(doc, findPart(doc, partId)!, 'pulley');
      doc = addFeature(doc, partId, { ...gear, params: { ...gear.params, belt: 'GT2-2', teeth, thickness: 7, bore: 5, flanges: true } });
      return doc;
    },
  };
}

/** Accouplement rigide d1 / d2 : cylindre Ø D × L, deux alésages, deux vis de pression M3. */
function coupler(d1: number, d2: number): ComponentSpec {
  const D = 19;
  const L = 25;
  return {
    collection: 'couplers',
    id: `rigid-${d1}x${d2}`,
    name: `Accouplement rigide ${d1} / ${d2} mm`,
    description: `Accouplement rigide Ø ${D} × ${L} mm entre un arbre de ${d1} mm et un arbre de ${d2} mm, deux vis de pression M3.`,
    tags: ['accouplement', 'arbre', `${d1}x${d2}`],
    dimensions: { D, L, d1, d2 },
    build: () => {
      let { doc, partId } = single(`Accouplement ${d1} / ${d2}`, '#9aa7b4', 'aluminium');
      const body = circleSketch(doc, partId, { kind: 'plane', plane: 'XY', offset: 0 }, [{ x: 0, y: 0, r: D / 2 }]);
      doc = body.doc;
      const ex = makeExtrudeFeature(doc, findPart(doc, partId)!, body.sketchId, L);
      doc = addFeature(doc, partId, ex);
      for (const [role, d] of [['start', d1], ['end', d2]] as const) {
        const s = circleSketch(doc, partId, { kind: 'face', ref: { featureId: ex.id, role } }, [{ x: 0, y: 0, r: d / 2 }]);
        doc = s.doc;
        doc = addFeature(doc, partId, makePocketFeature(doc, findPart(doc, partId)!, s.sketchId, { kind: 'distance', distance: L / 2 + 0.5 }));
      }
      // Vis de pression : un trou M3 radial au milieu de chaque alésage.
      const screws = circleSketch(doc, partId, { kind: 'plane', plane: 'XZ', offset: 0 }, [
        { x: 0, y: L / 4, r: 1.25 },
        { x: 0, y: (3 * L) / 4, r: 1.25 },
      ]);
      doc = screws.doc;
      doc = addFeature(doc, partId, makePocketFeature(doc, findPart(doc, partId)!, screws.sketchId, { kind: 'throughAll' }, 'symmetric'));
      return doc;
    },
  };
}

interface ServoSize {
  /** Corps : longueur (X), largeur (Y), hauteur du boîtier (Z). */
  body: [number, number, number];
  /** Pattes : longueur totale, épaisseur, hauteur du dessous des pattes. */
  tabs: { length: number; thickness: number; z: number };
  /** Trous des pattes : diamètre, entraxe en longueur et en largeur (0 : un trou par patte). */
  holes: { d: number; spanX: number; spanY: number };
  /** Sortie : distance de l'axe au bout du boîtier, bossage (Ø, hauteur), cannelure (Ø, hauteur). */
  output: { fromEnd: number; boss: [number, number]; spline: [number, number] };
}

/** Servomoteur : boîtier, pattes de fixation percées, bossage et cannelure de sortie. */
function servo(id: string, code: string, size: ServoSize, color: string, realMass: number, extra: string): ComponentSpec {
  const [L, W, H] = size.body;
  const height = H + size.output.boss[1] + size.output.spline[1];
  return {
    collection: 'servos',
    id,
    name: `Servomoteur ${code}`,
    description: `Servomoteur ${code} : boîtier ${L} × ${W} × ${H} mm, hauteur ${Math.round(height * 10) / 10} mm avec la cannelure, pattes de ${size.tabs.length} mm percées Ø ${size.holes.d} (entraxe ${size.holes.spanX} mm). ${extra} Masse réelle ≈ ${realMass} g (moteur et engrenages).`,
    tags: ['servomoteur', 'servo', code, 'modélisme'],
    dimensions: { L, W, H, pattes: size.tabs.length, entraxe: size.holes.spanX },
    build: () => {
      let { doc, partId } = single(`Servomoteur ${code}`, color, 'abs');
      const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
      doc = addFeature(doc, partId, { ...sk, params: solved(rectangle(sk.params, L, W).sketch) });
      const body = makeExtrudeFeature(doc, findPart(doc, partId)!, sk.id, H);
      doc = addFeature(doc, partId, body);
      // Pattes : une plaque sur toute la longueur, à la hauteur de fixation.
      const skT = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: size.tabs.z });
      doc = addFeature(doc, partId, { ...skT, params: solved(rectangle(skT.params, size.tabs.length, W).sketch) });
      const tabs = makeExtrudeFeature(doc, findPart(doc, partId)!, skT.id, size.tabs.thickness);
      doc = addFeature(doc, partId, tabs);
      const hx = size.holes.spanX / 2;
      const ys = size.holes.spanY ? [-size.holes.spanY / 2, size.holes.spanY / 2] : [0];
      const holes = circleSketch(doc, partId, { kind: 'face', ref: { featureId: tabs.id, role: 'end' } }, [-hx, hx].flatMap((x) => ys.map((y) => ({ x, y, r: size.holes.d / 2 }))));
      doc = holes.doc;
      doc = addFeature(doc, partId, makePocketFeature(doc, findPart(doc, partId)!, holes.sketchId, { kind: 'distance', distance: size.tabs.thickness + 0.5 }));
      // Sortie : bossage puis cannelure, axe à `fromEnd` du bout du boîtier.
      const ax = L / 2 - size.output.fromEnd;
      const boss = circleSketch(doc, partId, { kind: 'face', ref: { featureId: body.id, role: 'end' } }, [{ x: ax, y: 0, r: size.output.boss[0] / 2 }]);
      doc = boss.doc;
      const exBoss = makeExtrudeFeature(doc, findPart(doc, partId)!, boss.sketchId, size.output.boss[1]);
      doc = addFeature(doc, partId, exBoss);
      const spline = circleSketch(doc, partId, { kind: 'face', ref: { featureId: exBoss.id, role: 'end' } }, [{ x: ax, y: 0, r: size.output.spline[0] / 2 }]);
      doc = spline.doc;
      doc = addFeature(doc, partId, makeExtrudeFeature(doc, findPart(doc, partId)!, spline.sketchId, size.output.spline[1]));
      return doc;
    },
  };
}

const STANDARD_SERVO: ServoSize = {
  body: [40.7, 19.7, 36.8],
  tabs: { length: 54.5, thickness: 2.5, z: 26.6 },
  holes: { d: 4.6, spanX: 49.5, spanY: 10 },
  output: { fromEnd: 10, boss: [13, 2], spline: [5.8, 4.1] },
};

const MICRO_SERVO: ServoSize = {
  body: [22.5, 12.2, 22.7],
  tabs: { length: 32.2, thickness: 2.5, z: 15.9 },
  holes: { d: 2.2, spanX: 27.6, spanY: 0 },
  output: { fromEnd: 6, boss: [11.8, 4], spline: [4.8, 3.2] },
};

export const COMPONENTS: ComponentSpec[] = [
  bearing('625', 5, 16, 5),
  bearing('608', 8, 22, 7),
  bearing('6800', 10, 19, 5),
  bearing('6001', 12, 28, 8),
  nema17(34),
  nema17(40),
  nema17(48),
  gt2(16),
  gt2(20),
  gt2(36),
  coupler(5, 5),
  coupler(5, 8),
  servo('mg996r', 'MG996R', STANDARD_SERVO, '#626a76', 55, 'Format standard, pignons métal, couple ≈ 1 N·m sous 6 V.'),
  servo('sg90', 'SG90', MICRO_SERVO, '#3d7fd6', 9, 'Micro-servo, pignons plastique, couple ≈ 0,18 N·m sous 4,8 V.'),
  servo('mg90s', 'MG90S', MICRO_SERVO, '#737b87', 13.4, 'Micro-servo, pignons métal, couple ≈ 0,22 N·m sous 4,8 V.'),
];
