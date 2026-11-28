/**
 * Pont MCP, côté navigateur (serveur de développement seulement) : exécute les appels d'outils de
 * l'assistant (`mcp/vibecad-mcp.mjs`, relayés par `scripts/vite-plugin-mcp-bridge.ts`) sur le
 * projet ouvert. Chaque modification passe par `controller.commit` : elle apparaît dans la vue et
 * l'historique, et Ctrl+Z l'annule comme une action faite à la souris.
 */
import { addFeature, addPart, findFeature, findPart, makeMirrorFeature, makeSketchFeature, removeFeaturesCascade, removePart, renamePart, replaceFeature, updateFeature, updatePart } from '../domain/document';
import { addIndependentCopy } from '../domain/ensembles';
import { AXIS_X_ID, AXIS_Y_ID, ORIGIN_POINT_ID, type CadDocument, type EdgeRef, type FaceRef, type Feature, type FeatureType, type Id, type LaserItem, type LaserMaterial, type Part, type PrintItem, type PrintPlate, type SketchFeature, type SketchParams, type SketchSupport } from '../domain/model';
import type { FeatureDefinition, ToolInput } from '../features/definition';
import { FEATURE_DEFINITIONS, featureDependencies, featureSummary, validateFeature } from '../features/registry';
import { pickFaceReference } from '../features/sketch/support';
import { addArc, addCircle, addClosedPolyline, addConstraint, addEllipse, addLine, addPoint, addRectangle, addSpline, addText, removeConstraints, removeEntities, updateConstraint, type NewConstraint } from '../sketch/model';
import { nextRedoLabel, nextUndoLabel } from '../commands/history';
import { nextLocalId } from '../domain/ids';
import { evaluateExpression, expressionNames, PARAMETER_NAME } from '../domain/units';
import { applyFieldValue, applyParameters, parameterUses, renameParameterUses, resolveParameters } from '../features/parameters';
import { arcPoint, booleanOperand, circlePrim, primEnds, rectanglePrims, regularPolygonPoints, roundedPolygon, simpleOperand, slotPrims, type BoolOp, type Operand, type Prim } from '../sketch/boolean2d';
import { addOffsetLoop, loopOfCurve } from '../sketch/offset';
import type { StandardView } from '../viewport/camera-rig';
import { edgeRefFromPick } from './edges';
import { newLaserMaterial, newPlate, printableParts } from './fabrication';
import { toDxf, toSvg } from '../io/vector';
import { findPlanarFace } from './laser';
import { optimizedPlacements } from './laser';
import type { AppController } from './controller';

type Args = Record<string, unknown>;
interface ToolOutput {
  result: unknown;
  /** Image PNG en base64 (sans préfixe data:). */
  image?: string;
  /** Fichier exporté en base64, enregistré sur disque par le serveur MCP. */
  file?: string;
}

class ToolError extends Error {}

const fail = (message: string): never => {
  throw new ToolError(message);
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Arrondit les nombres (µm) d'une structure JSON pour des réponses lisibles. */
function rounded(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object') {
    if (ArrayBuffer.isView(value)) return undefined;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  }
  return value;
}

/** Fusion profonde : les objets sont fusionnés, les tableaux et valeurs simples remplacés. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !base || typeof base !== 'object' || Array.isArray(base)) return patch === undefined ? base : (patch as T);
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = deepMerge(out[k], v);
  }
  return out as T;
}

const str = (args: Args, key: string): string | undefined => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} : nombre attendu.`));
const vec2 = (v: unknown, what: string): { x: number; y: number } => {
  if (Array.isArray(v) && v.length === 2) return { x: num(v[0], what), y: num(v[1], what) };
  if (v && typeof v === 'object' && 'x' in v && 'y' in v) return { x: num((v as { x: unknown }).x, what), y: num((v as { y: unknown }).y, what) };
  return fail(`${what} : point [x, y] attendu.`);
};

/**
 * Cote ou champ : un nombre, ou une équation qui utilise des paramètres du projet (« largeur/2 »),
 * évaluée avec les paramètres actuels et gardée pour être recalculée quand ils changent.
 */
function dimArg(v: unknown, what: string, scope: ReadonlyMap<string, number>): { value: number; expression?: string } {
  if (typeof v === 'number') return { value: num(v, what) };
  if (typeof v !== 'string' || !v.trim()) return fail(`${what} : nombre ou équation attendu.`);
  const r = evaluateExpression(v, scope);
  if (!r.ok) return fail(`${what} : « ${v} » ne se calcule pas (${r.unknown ? `« ${r.unknown} » n'est pas un paramètre du projet, voir get_parameters` : r.error}).`);
  return expressionNames(v).length ? { value: r.value, expression: v.trim() } : { value: r.value };
}

const vec3 = (v: unknown, what: string): { x: number; y: number; z: number } => {
  if (Array.isArray(v) && v.length === 3) return { x: num(v[0], what), y: num(v[1], what), z: num(v[2], what) };
  if (v && typeof v === 'object') {
    const o = v as Args;
    return { x: o.x === undefined ? 0 : num(o.x, `${what}.x`), y: o.y === undefined ? 0 : num(o.y, `${what}.y`), z: o.z === undefined ? 0 : num(o.z, `${what}.z`) };
  }
  return fail(`${what} : {x, y, z} ou [x, y, z] attendu.`);
};

const radiusArg = (v: unknown, what: string): number | number[] => {
  if (v === undefined) return 0;
  if (Array.isArray(v)) return v.map((x, i) => num(x, `${what}[${i}]`));
  return num(v, what);
};

/** Cote liée à une équation (rien à faire sans équation). */
function withExpression(sketch: SketchParams, constraintId: string, expression: string | undefined): SketchParams {
  if (!expression) return sketch;
  return updateConstraint(sketch, constraintId, { expression } as never);
}

/** Forme fermée décrite par l'assistant → contour exact (segments, arcs) et matière, pour les booléens. */
function operandOf(sh: Args, where: string): Operand {
  switch (sh.type) {
    case 'rectangle': {
      const w = num(sh.width, `${where}.width`);
      const h = num(sh.height, `${where}.height`);
      const at = vec2(sh.at ?? [0, 0], `${where}.at`);
      const c1 = sh.centered === true ? { x: at.x - w / 2, y: at.y - h / 2 } : at;
      return simpleOperand(rectanglePrims(c1, w, h, sh.radius === undefined ? 0 : num(sh.radius, `${where}.radius`)));
    }
    case 'circle': {
      const d = sh.diameter !== undefined ? num(sh.diameter, `${where}.diameter`) : 2 * num(sh.radius, `${where}.radius`);
      return simpleOperand([circlePrim(vec2(sh.center ?? [0, 0], `${where}.center`), d / 2)]);
    }
    case 'polygon': {
      if (!Array.isArray(sh.points) || sh.points.length < 3) fail(`${where}.points : au moins 3 points [x, y].`);
      const pts = (sh.points as unknown[]).map((pt, k) => vec2(pt, `${where}.points[${k}]`));
      return simpleOperand(roundedPolygon(pts, radiusArg(sh.corner_radius, `${where}.corner_radius`)));
    }
    case 'regular_polygon': {
      const sides = Math.round(num(sh.sides, `${where}.sides`));
      if (sides < 3) fail(`${where}.sides : 3 côtés au moins.`);
      // Rayon du cercle passant par les sommets, ou largeur entre plats (across_flats, comme une clé).
      const r = sh.across_flats !== undefined ? num(sh.across_flats, `${where}.across_flats`) / 2 / Math.cos(Math.PI / sides) : num(sh.radius, `${where}.radius`);
      const pts = regularPolygonPoints(vec2(sh.center ?? [0, 0], `${where}.center`), sides, r, sh.angle === undefined ? 90 : num(sh.angle, `${where}.angle`));
      return simpleOperand(roundedPolygon(pts, radiusArg(sh.corner_radius, `${where}.corner_radius`)));
    }
    case 'slot':
      return simpleOperand(slotPrims(vec2(sh.from, `${where}.from`), vec2(sh.to, `${where}.to`), num(sh.width, `${where}.width`)));
    case 'boolean': {
      const op = sh.op;
      if (op !== 'union' && op !== 'difference' && op !== 'intersection') fail(`${where}.op : "union", "difference" ou "intersection".`);
      if (!Array.isArray(sh.shapes) || sh.shapes.length < 1) fail(`${where}.shapes : formes à combiner attendues.`);
      return booleanOperand(op as BoolOp, (sh.shapes as Args[]).map((x, k) => operandOf(x, `${where}.shapes[${k}]`)));
    }
    default:
      return fail(`${where} : forme « ${String(sh.type)} » impossible dans un booléen (rectangle, circle, polygon, regular_polygon, slot ou boolean).`);
  }
}

/**
 * Pose des segments et des arcs dans l'esquisse ; les extrémités qui se touchent partagent un même
 * point (contour fermé). Renvoie les identifiants des courbes.
 */
function emitPrims(sketch: SketchParams, prims: readonly Prim[], construction: boolean): { sketch: SketchParams; curves: string[] } {
  let s = sketch;
  const flag = construction ? { construction: true } : {};
  const pts: { id: string; at: { x: number; y: number } }[] = [];
  const pointAt = (at: { x: number; y: number }, shared = true): string => {
    const found = shared ? pts.find((p) => Math.hypot(p.at.x - at.x, p.at.y - at.y) < 1e-6) : undefined;
    if (found) return found.id;
    const r = addPoint(s, at);
    s = r.sketch;
    if (shared) pts.push({ id: r.id, at });
    return r.id;
  };
  const curves: string[] = [];
  const ids = () => s.entities.map((e) => e.id);
  for (const p of prims) {
    if (p.kind === 'line') {
      const a = pointAt(p.a);
      const b = pointAt(p.b);
      const id = nextLocalId('l', ids());
      s = { ...s, entities: [...s.entities, { id, type: 'line', a, b, ...flag }] };
      curves.push(id);
      continue;
    }
    const center = pointAt(p.c, false);
    if (!primEnds(p)) {
      const id = nextLocalId('c', ids());
      s = { ...s, entities: [...s.entities, { id, type: 'circle', center, radius: p.r, ...flag }] };
      curves.push(id);
      continue;
    }
    const start = pointAt(arcPoint(p, p.a0));
    const end = pointAt(arcPoint(p, p.a0 + p.sweep));
    const id = nextLocalId('a', ids());
    s = { ...s, entities: [...s.entities, { id, type: 'arc', center, start, end, ...flag }] };
    curves.push(id);
  }
  return { sketch: s, curves };
}

export class McpBridge {
  constructor(private readonly controller: AppController) {}

  private get state() {
    return this.controller.state;
  }

  // -------------------------------------------------------------------------
  // Attente du calcul

  private async kernelReady(): Promise<void> {
    for (let i = 0; i < 600; i++) {
      const k = this.state.kernel;
      if (k.status === 'ready') return;
      if (k.status === 'error') fail(`Le noyau géométrique n'a pas démarré : ${k.message ?? 'erreur inconnue'}.`);
      await sleep(100);
    }
    fail("Le noyau géométrique n'est pas prêt.");
  }

  /** Attend la fin du recalcul déclenché par la dernière modification. */
  private async settle(timeoutMs = 90_000): Promise<void> {
    const start = performance.now();
    await sleep(0);
    let calm = 0;
    while (performance.now() - start < timeoutMs) {
      calm = this.state.evaluating ? 0 : calm + 1;
      if (calm >= 3) return;
      await sleep(40);
    }
    fail('Le recalcul prend trop de temps.');
  }

  private requireModelMode(): void {
    const m = this.state.mode.kind;
    if (m !== 'model') fail(`VibeCAD est en cours d'opération (mode « ${m} ») : validez ou annulez-la dans l'interface, puis recommencez.`);
  }

  // -------------------------------------------------------------------------
  // Lecture du projet

  private part(id: string | undefined): Part {
    const doc = this.state.doc;
    if (id) return findPart(doc, id) ?? fail(`Pièce « ${id} » introuvable.`);
    return findPart(doc, this.state.activePartId) ?? doc.parts[0] ?? fail('Le projet ne contient aucune pièce.');
  }

  private editablePart(id: string | undefined): Part {
    const part = this.part(id);
    if (part.component && !part.component.editable) fail(`« ${part.name} » est un composant de bibliothèque verrouillé : rendez-le modifiable dans l'interface.`);
    return part;
  }

  private feature(id: unknown): { part: Part; feature: Feature } {
    if (typeof id !== 'string') fail('feature_id attendu.');
    return findFeature(this.state.doc, id as string) ?? fail(`Étape « ${String(id)} » introuvable.`);
  }

  private featureInfo(part: Part, f: Feature) {
    const result = this.state.display[part.id]?.result;
    const status = result?.statuses.find((s) => s.featureId === f.id);
    let summary = '';
    try {
      summary = featureSummary(f);
    } catch {
      /* résumé indisponible */
    }
    const info: Record<string, unknown> = { id: f.id, type: f.type, name: f.name, summary, state: status?.state ?? 'inconnu' };
    if (status?.message) info.message = status.message;
    if (status?.blockedBy) info.blockedBy = status.blockedBy;
    if (status?.relatedFeatureId) info.relatedFeatureId = status.relatedFeatureId;
    if (f.type === 'sketch') {
      const sk = result?.sketches.find((s) => s.featureId === f.id);
      if (sk) {
        info.dof = sk.dof;
        info.converged = sk.converged;
        if (sk.unsatisfied.length) info.unsatisfied = sk.unsatisfied;
        info.profile = sk.profile;
      }
    }
    return info;
  }

  private partInfo(part: Part) {
    const display = this.state.display[part.id];
    const a = display?.result.analysis;
    return {
      id: part.id,
      name: part.name,
      color: part.color,
      visible: part.visible,
      material: part.material,
      locked: !!part.component && !part.component.editable,
      solid: a ? { volume_mm3: a.volume, area_mm2: a.area, bbox: a.bbox, solidCount: a.solidCount, valid: a.valid, centroid: a.centroid } : null,
      stale: display?.stale ?? false,
      features: part.features.map((f) => this.featureInfo(part, f)),
    };
  }

  private documentInfo() {
    const s = this.state;
    return {
      name: s.doc.name,
      units: s.doc.units,
      activePartId: s.activePartId,
      mode: s.mode.kind,
      workspace: s.workspace,
      parameters: s.doc.parameters ?? [],
      undo: nextUndoLabel(s.history),
      redo: nextRedoLabel(s.history),
      parts: s.doc.parts.map((p) => this.partInfo(p)),
    };
  }

  // -------------------------------------------------------------------------
  // Modification

  private async apply(doc: CadDocument, label: string, partId: Id): Promise<void> {
    this.controller.commit(doc, label, { activePartId: partId });
    await this.settle();
  }

  /** Valide une modification ; si l'étape visée est en erreur, la modification est annulée. */
  private async applyChecked(doc: CadDocument, label: string, partId: Id, featureId: Id) {
    await this.apply(doc, label, partId);
    const part = findPart(this.state.doc, partId)!;
    const feature = part.features.find((f) => f.id === featureId);
    const info = feature ? this.featureInfo(part, feature) : null;
    if (info?.state === 'error') {
      this.controller.undo();
      await this.settle();
      fail(`Modification annulée, l'étape est en erreur : ${String(info.message ?? 'raison inconnue')}`);
    }
    return { feature: info, part: this.partInfo(part) };
  }

  private faceRefFromIndex(part: Part, index: number): FaceRef {
    const mesh = this.state.display[part.id]?.mesh ?? fail(`« ${part.name} » n'a pas encore de volume.`);
    const face = mesh.faces[index] ?? fail(`Face n° ${index} introuvable (voir list_geometry).`);
    return pickFaceReference(face.tags, part) ?? fail(`La face n° ${index} ne peut pas être désignée de façon durable.`);
  }

  // -------------------------------------------------------------------------
  // Impression 3D : plateaux

  /** Pièce désignée par son identifiant ou son nom exact. */
  private partByIdOrName(ref: unknown): Part {
    if (typeof ref !== 'string' || !ref) return fail('part : identifiant ou nom de pièce attendu.');
    const doc = this.state.doc;
    return findPart(doc, ref) ?? doc.parts.find((p) => p.name === ref) ?? fail(`Pièce « ${ref} » introuvable.`);
  }

  /** Index (list_geometry) d'une face désignée ; null sans face choisie, -1 si elle n'existe plus. */
  private faceIndexOf(partId: Id, ref: FaceRef | undefined): number | null {
    if (!ref) return null;
    const mesh = this.state.display[partId]?.mesh;
    return mesh ? findPlanarFace(mesh, ref) : -1;
  }

  private hasSolid = (id: Id): boolean => (this.state.display[id]?.result.analysis?.solidCount ?? 0) > 0;

  private printPlatesInfo() {
    const doc = this.state.doc;
    const print = this.controller.fabrication().print;
    const current = this.controller.currentPlate();
    const layout = this.controller.printLayout();
    const nameOf = (id: Id) => findPart(doc, id)?.name ?? '?';
    return {
      bed: print.bed,
      spacing: print.spacing,
      current_plate: current.id,
      plates: (print.plates?.length ? print.plates : [current]).map((p) => ({
        id: p.id,
        name: p.name,
        items: p.items.map((i) => ({
          part_id: i.partId,
          name: nameOf(i.partId),
          copies: i.copies,
          scale: i.scale,
          down_face_index: this.faceIndexOf(i.partId, i.downFace),
          ...(i.series ? { series: i.series.parameter } : {}),
        })),
      })),
      printable_parts: printableParts(doc, this.hasSolid).map((p) => ({ id: p.id, name: p.name })),
      layout_of_current_plate: { prints_needed: layout.plates, grams: layout.grams, placed: layout.placements.length, warnings: layout.warnings },
    };
  }

  /** Crée ou modifie un plateau en une seule action annulable, puis l'affiche dans l'atelier Fabrication. */
  private async setPrintPlate(args: Args) {
    const doc = this.state.doc;
    const f0 = this.controller.fabrication();
    const plates0 = f0.print.plates?.length ? f0.print.plates : [this.controller.currentPlate()];
    const wanted = str(args, 'plate');
    let plate: PrintPlate;
    let isNew = false;
    if (wanted === 'new') {
      plate = newPlate(plates0);
      isNew = true;
    } else if (wanted) {
      plate = plates0.find((p) => p.id === wanted || p.name === wanted) ?? fail(`Plateau « ${wanted} » introuvable (voir get_print_plates).`);
    } else {
      plate = this.controller.currentPlate();
    }
    const name = str(args, 'name')?.trim();
    if (name) plate = { ...plate, name };
    if (args.clear === true) plate = { ...plate, items: [] };

    const printable = new Set(printableParts(doc, this.hasSolid).map((p) => p.id));
    const changes: string[] = [];
    for (const raw of Array.isArray(args.items) ? (args.items as Args[]) : []) {
      const part = this.partByIdOrName(raw.part ?? raw.part_id);
      if (!printable.has(part.id)) fail(`« ${part.name} » ne peut pas aller sur un plateau : pas de volume, ou matière découpée au laser.`);
      const existing = plate.items.find((i) => i.partId === part.id);
      const copies = raw.copies === undefined ? existing?.copies ?? 1 : Math.round(num(raw.copies, 'copies'));
      if (copies < 0) fail('copies : 0 ou plus (0 retire la pièce du plateau).');
      if (copies === 0) {
        plate = { ...plate, items: plate.items.filter((i) => i.partId !== part.id) };
        changes.push(`${part.name} retirée`);
        continue;
      }
      const item: PrintItem = { ...(existing ?? { partId: part.id, copies: 1, scale: 100 }), copies };
      if (raw.scale !== undefined) {
        const scale = num(raw.scale, 'scale');
        if (scale <= 0) fail('scale : pourcentage positif attendu.');
        item.scale = scale;
      }
      if (raw.down_face_index === null) delete item.downFace;
      else if (raw.down_face_index !== undefined) item.downFace = this.faceRefFromIndex(part, num(raw.down_face_index, 'down_face_index'));
      plate = { ...plate, items: existing ? plate.items.map((i) => (i.partId === part.id ? item : i)) : [...plate.items, item] };
      changes.push(`${part.name} × ${copies}`);
    }

    let bed = f0.print.bed;
    if (args.bed && typeof args.bed === 'object') {
      const b = args.bed as Args;
      bed = { x: b.x === undefined ? bed.x : num(b.x, 'bed.x'), y: b.y === undefined ? bed.y : num(b.y, 'bed.y'), z: b.z === undefined ? bed.z : num(b.z, 'bed.z') };
      if (bed.x <= 0 || bed.y <= 0 || bed.z <= 0) fail('bed : dimensions positives attendues.');
    }

    const plates = isNew ? [...plates0, plate] : plates0.map((p) => (p.id === plate.id ? plate : p));
    const label = `Plateau « ${plate.name} »${changes.length ? ` : ${changes.join(', ')}` : ''}`;
    this.controller.updateFabrication((f) => ({ ...f, print: { ...f.print, bed, plates } }), label);
    if (args.show !== false) {
      this.controller.setWorkspace('fabrication');
      if (this.state.workspace === 'fabrication') this.controller.setFabricationTab('print');
    }
    this.controller.selectPrintPlate(plate.id);
    await this.settle();
    return this.printPlatesInfo();
  }

  // -------------------------------------------------------------------------
  // Découpe laser

  private laserMaterialByIdOrName(ref: unknown): LaserMaterial {
    const materials = this.controller.fabrication().laser.materials;
    if (typeof ref !== 'string' || !ref) return fail('material : identifiant ou nom de matériau attendu.');
    return materials.find((m) => m.id === ref || m.name === ref) ?? fail(`Matériau « ${ref} » introuvable (voir get_laser_layout).`);
  }

  private laserInfo() {
    const doc = this.state.doc;
    const f = this.controller.fabrication().laser;
    const layout = this.controller.laserLayout();
    const nameOf = (id: Id) => findPart(doc, id)?.name ?? '?';
    const bbox = (loops: { x: number; y: number }[][]) => {
      const pts = loops.flat();
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    return {
      spacing: f.spacing,
      engrave_names: !!f.engraveNames,
      current_material: this.state.laserPage ?? null,
      materials: layout.materials.map((g) => ({
        id: g.material.id,
        name: g.material.name,
        thickness: g.material.thickness,
        sheet: g.material.sheet,
        kerf: g.material.kerf,
        ...(g.material.fromSheet ? { from_material_sheet: true } : {}),
        placement: g.material.placements ? 'figé (optimisé ou déplacé à la main)' : 'automatique par rangées',
        sheets_used: g.sheets,
        placed: g.placed.map((p) => ({
          part: p.name,
          copy: p.copy,
          sheet: p.sheet,
          center: { x: p.placement.x, y: p.placement.y },
          angle: p.placement.angle,
          bbox: bbox(p.loops),
        })),
      })),
      items: f.items.map((i) => ({
        part_id: i.partId,
        name: nameOf(i.partId),
        copies: i.copies,
        face_index: this.faceIndexOf(i.partId, i.face) ?? 'automatique (plus grande face plane)',
        material: i.materialId ? 'choisi' : 'automatique (épaisseur la plus proche)',
        resolved_material: layout.materialOf[i.partId] ?? null,
        thickness: layout.thickness[i.partId] ?? null,
      })),
      warnings: layout.warnings,
    };
  }

  /** Règle la découpe laser en une seule action annulable (l'optimisation éventuelle en est une seconde). */
  private async setLaser(args: Args) {
    const f0 = this.controller.fabrication().laser;
    let materials = [...f0.materials];
    let items = [...f0.items];
    const changes: string[] = [];

    for (const raw of Array.isArray(args.materials) ? (args.materials as Args[]) : []) {
      const ref = raw.material ?? raw.id;
      let m: LaserMaterial;
      if (ref === 'new') {
        m = newLaserMaterial(materials);
        materials = [...materials, m];
      } else {
        m = materials.find((x) => x.id === ref || x.name === ref) ?? fail(`Matériau « ${String(ref)} » introuvable (voir get_laser_layout).`);
      }
      const patch: Partial<LaserMaterial> = {};
      const newName = str(raw, 'name')?.trim();
      if ((newName || raw.thickness !== undefined) && m.fromSheet) {
        fail(`« ${m.name} » vient d'une fiche matière : son nom et son épaisseur se règlent dans la fiche (seuls sheet et kerf ici).`);
      }
      if (newName) patch.name = newName;
      if (raw.thickness !== undefined) patch.thickness = num(raw.thickness, 'thickness');
      if (raw.kerf !== undefined) patch.kerf = num(raw.kerf, 'kerf');
      if (raw.sheet && typeof raw.sheet === 'object') {
        const s = raw.sheet as Args;
        patch.sheet = { w: s.w === undefined ? m.sheet.w : num(s.w, 'sheet.w'), h: s.h === undefined ? m.sheet.h : num(s.h, 'sheet.h') };
      }
      if ((patch.thickness ?? 1) <= 0 || (patch.kerf ?? 0) < 0 || (patch.sheet && (patch.sheet.w <= 0 || patch.sheet.h <= 0))) fail('Matériau : épaisseur et plaque positives, trait de coupe ≥ 0.');
      const next = { ...m, ...patch };
      // Plaque ou trait changés : les placements figés ne correspondent plus.
      if (patch.sheet || patch.kerf !== undefined) delete next.placements;
      materials = materials.map((x) => (x.id === m.id ? next : x));
      changes.push(next.name);
    }

    for (const raw of Array.isArray(args.items) ? (args.items as Args[]) : []) {
      const part = this.partByIdOrName(raw.part ?? raw.part_id);
      const existing = items.find((i) => i.partId === part.id) ?? fail(`« ${part.name} » ne se découpe pas au laser : pas de volume, ou matière imprimée.`);
      const item: LaserItem = { ...existing };
      if (raw.copies !== undefined) {
        item.copies = Math.round(num(raw.copies, 'copies'));
        if (item.copies < 0) fail('copies : 0 ou plus.');
      }
      if (raw.face_index === null) delete item.face;
      else if (raw.face_index !== undefined) item.face = this.faceRefFromIndex(part, num(raw.face_index, 'face_index'));
      if (raw.material === null) delete item.materialId;
      else if (raw.material !== undefined) {
        if (findPart(this.state.doc, part.id)?.make) fail(`« ${part.name} » a une fiche matière : son matériau de découpe vient de la fiche.`);
        const ref = raw.material;
        item.materialId = (materials.find((m) => m.id === ref || m.name === ref) ?? fail(`Matériau « ${String(ref)} » introuvable.`)).id;
      }
      items = items.map((i) => (i.partId === part.id ? item : i));
      changes.push(`${part.name} × ${item.copies}`);
    }

    let spacing = f0.spacing;
    if (args.spacing !== undefined) {
      spacing = num(args.spacing, 'spacing');
      if (spacing < 0) fail('spacing : 0 ou plus.');
      changes.push(`espace ${spacing} mm`);
    }
    const engraveNames = args.engrave_names === undefined ? !!f0.engraveNames : args.engrave_names === true;

    if (changes.length || args.engrave_names !== undefined) {
      const label = `Découpe laser${changes.length ? ` : ${changes.join(', ')}` : ''}`;
      this.controller.updateFabrication((f) => ({ ...f, laser: { ...f.laser, materials, items, spacing, engraveNames } }), label);
      await this.settle();
    }

    if (args.reset_placements !== undefined && args.reset_placements !== false) {
      const targets = args.reset_placements === true ? this.controller.fabrication().laser.materials : [this.laserMaterialByIdOrName(args.reset_placements)];
      for (const m of targets) if (m.placements) this.controller.resetLaserPlacements(m.id);
    }
    const optimized: { material: string; sheets_before: number; sheets_after: number }[] = [];
    if (args.optimize !== undefined && args.optimize !== false) {
      const layout = this.controller.laserLayout();
      const targets = args.optimize === true ? layout.materials.filter((g) => g.placed.length).map((g) => g.material) : [this.laserMaterialByIdOrName(args.optimize)];
      // Même calcul que le bouton « Optimiser », sans notification : le résultat est dans la réponse.
      for (const m of targets) {
        const sheetsOf = () => this.controller.laserLayout().materials.find((g) => g.material.id === m.id)?.sheets ?? 0;
        const placements = optimizedPlacements(this.controller.laserLayout(), m.id, this.controller.fabrication().laser.spacing);
        if (!placements.length) continue;
        const before = sheetsOf();
        this.controller.updateFabrication(
          (f) => ({ ...f, laser: { ...f.laser, materials: f.laser.materials.map((x) => (x.id === m.id ? { ...x, placements } : x)) } }),
          `Optimiser le placement (${m.name})`,
        );
        optimized.push({ material: m.name, sheets_before: before, sheets_after: sheetsOf() });
      }
    }

    const shown = this.controller.laserLayout().materials.find((g) => g.placed.length);
    if (args.show !== false) {
      this.controller.setWorkspace('fabrication');
      if (this.state.workspace === 'fabrication') this.controller.setFabricationTab('laser');
      if (shown) this.controller.setLaserPage(shown.material.id);
    }
    await this.settle();
    return { ...this.laserInfo(), ...(optimized.length ? { optimized } : {}) };
  }

  // -------------------------------------------------------------------------
  // Copies de pièces

  /**
   * Copies d'une pièce en une action annulable : indépendantes (leur propre historique), ou
   * variantes symétriques liées (elles suivent les modifications de l'original). Avec `move`,
   * l'exemplaire k est déplacé k fois (réseau linéaire ou circulaire de pièces).
   */
  private async copyPart(args: Args) {
    const src = this.partByIdOrName(args.part ?? args.part_id);
    if (!this.hasSolid(src.id)) fail(`« ${src.name} » n'a pas encore de volume à copier.`);
    const mode = args.mode ?? 'copy';
    if (mode !== 'copy' && mode !== 'mirror') fail('mode : "copy" (copie indépendante) ou "mirror" (variante symétrique liée).');
    const plane = (args.plane ?? 'YZ') as 'XY' | 'XZ' | 'YZ';
    if (!['XY', 'XZ', 'YZ'].includes(plane)) fail('plane : "XY", "XZ" ou "YZ" (plan de symétrie passant par l’origine).');
    const count = args.count === undefined ? 1 : Math.round(num(args.count, 'count'));
    if (count < 1 || count > 50) fail('count : de 1 à 50.');
    const names = Array.isArray(args.names) ? (args.names as unknown[]).map(String) : [];
    const mv = args.move && typeof args.move === 'object' ? (args.move as Args) : null;
    const t = mv?.translation ? vec3(mv.translation, 'move.translation') : { x: 0, y: 0, z: 0 };
    const angle = mv?.angle === undefined ? 0 : num(mv.angle, 'move.angle');
    const axis = (mv?.axis ?? 'Z') as 'X' | 'Y' | 'Z';
    if (!['X', 'Y', 'Z'].includes(axis)) fail('move.axis : "X", "Y" ou "Z".');
    const center = mv?.center ? vec3(mv.center, 'move.center') : { x: 0, y: 0, z: 0 };
    const moveDef = FEATURE_DEFINITIONS.move as unknown as FeatureDefinition;

    let doc = this.state.doc;
    const created: Id[] = [];
    const taken = new Set(doc.parts.map((p) => p.name));
    for (let k = 1; k <= count; k++) {
      let name = names[k - 1] ?? (count === 1 && str(args, 'name')) ?? '';
      if (!name) {
        const base = mode === 'mirror' ? `${src.name} (symétrique)` : `${src.name} (copie)`;
        name = base;
        for (let n = 2; taken.has(name); n++) name = `${base.slice(0, -1)} ${n})`;
      }
      taken.add(name);
      let id: Id;
      if (mode === 'mirror') {
        const added = addPart(doc, name);
        id = added.partId;
        doc = updatePart(added.doc, id, (p) => ({ ...p, color: src.color, ...(src.make ? { make: src.make } : {}) }));
        const mirror = makeMirrorFeature(doc, findPart(doc, id)!, { kind: 'otherPart', partId: src.id }, { kind: 'plane', plane });
        doc = addFeature(doc, id, { ...mirror, name: `Symétrique de « ${src.name} » (${plane})` });
      } else {
        const r = addIndependentCopy(doc, src.id, 0) ?? fail(`Copie de « ${src.name} » impossible.`);
        id = r.partId;
        doc = renamePart(r.doc, id, name);
      }
      if (mv) {
        const part = findPart(doc, id)!;
        let feature = moveDef.tool!.create(doc, part, { kind: 'part' }, { sketchFrame: null, partBounds: null });
        feature = {
          ...feature,
          name: count > 1 ? `Exemplaire ${k}` : 'Placement',
          params: deepMerge(feature.params, { translation: { x: t.x * k, y: t.y * k, z: t.z * k }, axis, angle: angle * k, center, copy: false }),
        } as Feature;
        doc = addFeature(doc, id, feature);
      }
      created.push(id);
    }
    const what = mode === 'mirror' ? `Variante${count > 1 ? 's' : ''} symétrique${count > 1 ? 's' : ''}` : `Copie${count > 1 ? 's' : ''}`;
    await this.apply(doc, `${what} de « ${src.name} »${count > 1 ? ` × ${count}` : ''}`, created[created.length - 1]!);
    const parts = created.map((id) => findPart(this.state.doc, id)!).map((p) => this.partInfo(p));
    const broken = parts.filter((p) => !(p as { solid?: unknown }).solid);
    return { created: parts.map((p) => ({ id: (p as { id: Id }).id, name: (p as { name: string }).name, solid: (p as { solid?: unknown }).solid ?? null })), ...(broken.length ? { warning: 'Certaines copies n’ont pas de volume : voir get_document.' } : {}) };
  }

  // -------------------------------------------------------------------------
  // Paramètres du projet

  private parameterValues(): ReadonlyMap<string, number> {
    return resolveParameters(this.state.doc.parameters ?? []).values;
  }

  private parametersInfo() {
    const doc = this.state.doc;
    const { values, errors } = resolveParameters(doc.parameters ?? []);
    const linked: { part: string; feature: string; field: string; expression: string }[] = [];
    for (const part of doc.parts)
      for (const f of part.features) {
        for (const [field, expression] of Object.entries(f.expressions ?? {})) linked.push({ part: part.name, feature: f.name, field, expression });
        if (f.type === 'sketch')
          for (const c of f.params.constraints) if ('value' in c && c.expression) linked.push({ part: part.name, feature: f.name, field: `cote ${c.id} (${c.type})`, expression: c.expression });
      }
    return {
      parameters: (doc.parameters ?? []).map((p) => ({
        name: p.name,
        expression: p.expression,
        value: values.get(p.name.toLowerCase()) ?? null,
        ...(p.comment ? { comment: p.comment } : {}),
        ...(errors.has(p.name) ? { error: errors.get(p.name) } : {}),
        used_by: parameterUses(doc, p.name),
      })),
      linked,
    };
  }

  /**
   * Crée, modifie, renomme ou supprime des paramètres en une action annulable ; les étapes et cotes
   * liées sont recalculées. Renvoie les paramètres et les étapes devenues fautives.
   */
  private async setParameters(args: Args) {
    let doc = this.state.doc;
    let params = [...(doc.parameters ?? [])];
    const changes: string[] = [];
    const find = (name: string) => params.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    for (const r of Array.isArray(args.rename) ? (args.rename as Args[]) : []) {
      const from = str(r, 'from') ?? fail('rename : { from, to } attendu.');
      const to = str(r, 'to')?.trim() ?? fail('rename : { from, to } attendu.');
      const i = find(from);
      if (i < 0) fail(`Paramètre « ${from} » introuvable.`);
      if (!PARAMETER_NAME.test(to)) fail(`« ${to} » : un nom commence par une lettre, puis lettres, chiffres ou _ (pas d'espace).`);
      params[i] = { ...params[i]!, name: to };
      doc = renameParameterUses(doc, from, to);
      changes.push(`${from} → ${to}`);
    }
    for (const r of Array.isArray(args.set) ? (args.set as Args[]) : []) {
      const name = str(r, 'name')?.trim() ?? fail('set : { name, value | expression } attendu.');
      if (!PARAMETER_NAME.test(name)) fail(`« ${name} » : un nom commence par une lettre, puis lettres, chiffres ou _ (pas d'espace).`);
      const expression = r.expression !== undefined ? String(r.expression) : r.value !== undefined ? String(num(r.value, `${name}.value`)) : undefined;
      const i = find(name);
      if (i < 0 && expression === undefined) fail(`« ${name} » : value ou expression attendu pour un nouveau paramètre.`);
      const prev = i >= 0 ? params[i]! : { name, expression: '0' };
      const next = { ...prev, ...(expression !== undefined ? { expression } : {}), ...(typeof r.comment === 'string' ? { comment: r.comment } : {}) };
      if (i >= 0) params[i] = next;
      else params.push(next);
      changes.push(`${name} = ${next.expression}`);
    }
    for (const name of Array.isArray(args.remove) ? (args.remove as string[]) : []) {
      const i = find(name);
      if (i < 0) fail(`Paramètre « ${name} » introuvable.`);
      const uses = parameterUses({ ...doc, parameters: params }, name);
      if (uses.length && args.force !== true) fail(`« ${name} » est utilisé par : ${uses.join(', ')}. Supprimez ces liens d'abord, ou force:true (les valeurs actuelles restent).`);
      params.splice(i, 1);
      changes.push(`${name} supprimé`);
    }
    if (!changes.length) return this.parametersInfo();
    const { errors } = resolveParameters(params);
    if (errors.size) fail(`Paramètres refusés : ${[...errors.values()].join(' ; ')}`);
    doc = applyParameters({ ...doc, parameters: params });
    this.controller.commit(doc, `Paramètres : ${changes.join(', ')}`);
    await this.settle();
    const failing = this.state.doc.parts.flatMap((part) =>
      part.features.flatMap((f) => {
        const info = this.featureInfo(part, f);
        return info.state === 'error' ? [{ part: part.name, feature: f.name, message: info.message }] : [];
      }),
    );
    return { ...this.parametersInfo(), ...(failing.length ? { features_in_error: failing } : {}) };
  }

  /**
   * Champs d'étape liés à une équation (`{ distance: "epaisseur*2" }` ; null retire le lien) : la
   * valeur est calculée tout de suite, et recalculée quand un paramètre change.
   */
  private withFieldExpressions(feature: Feature, raw: unknown): Feature {
    if (raw === undefined) return feature;
    if (!raw || typeof raw !== 'object') fail('expressions : { champ: "équation" } attendu.');
    const scope = this.parameterValues();
    let next = feature;
    const expressions = { ...(feature.expressions ?? {}) };
    for (const [field, value] of Object.entries(raw as Args)) {
      if (value === null) {
        delete expressions[field];
        continue;
      }
      const dim = dimArg(value, `expressions.${field}`, scope);
      const applied = applyFieldValue(next, field, dim.value);
      if (applied === next) {
        const numeric = Object.entries(feature.params as unknown as Args).filter(([, v]) => typeof v === 'number').map(([k]) => k);
        fail(`expressions.${field} : champ inconnu pour « ${feature.type} » (champs numériques : ${numeric.join(', ') || 'aucun'} ; poche : distance ; déplacement : tx, ty, tz ; congé, chanfrein : size).`);
      }
      next = applied;
      if (dim.expression) expressions[field] = dim.expression;
      else delete expressions[field];
    }
    const { expressions: _old, ...bare } = next;
    return (Object.keys(expressions).length ? { ...bare, expressions } : bare) as Feature;
  }

  // -------------------------------------------------------------------------
  // Lot d'opérations

  /**
   * Exécute des opérations à la suite et les regroupe en une seule action annulable. Une chaîne
   * « $N.chemin » dans les arguments est remplacée par le résultat de l'opération N (ex.
   * « $0.partId », « $1.sketch.id ») ; « $prev » désigne l'opération précédente. Si une opération
   * échoue, tout le lot est annulé.
   */
  private async batch(args: Args): Promise<ToolOutput> {
    this.requireModelMode();
    const ops = Array.isArray(args.operations) ? (args.operations as Args[]) : fail('operations : liste de { tool, args } attendue.');
    if (!ops.length) fail('operations : liste vide.');
    const h0 = this.state.history;
    const results: unknown[] = [];
    const lookup = (ref: string): unknown => {
      const m = /^\$(prev|\d+)((?:\.[\w-]+)*)$/.exec(ref);
      if (!m) return ref;
      const index = m[1] === 'prev' ? results.length - 1 : Number(m[1]);
      if (index < 0 || index >= results.length) fail(`${ref} : l'opération ${index} n'a pas encore eu lieu.`);
      let v: unknown = results[index];
      for (const key of m[2]!.split('.').filter(Boolean)) {
        v = v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined;
        if (v === undefined) fail(`${ref} : « ${key} » absent du résultat de l'opération ${index}.`);
      }
      return v;
    };
    const resolve = (v: unknown): unknown =>
      typeof v === 'string' ? lookup(v) : Array.isArray(v) ? v.map(resolve) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)])) : v;
    for (const [i, op] of ops.entries()) {
      const tool = typeof op.tool === 'string' ? op.tool : fail(`operations[${i}].tool attendu.`);
      if (tool === 'batch' || tool === 'undo' || tool === 'redo') fail(`operations[${i}] : « ${tool} » n'est pas permis dans un lot.`);
      try {
        const out = await this.call(tool, (resolve(op.args ?? {}) as Args) ?? {});
        results.push(out.result);
      } catch (err) {
        // Retour à l'état d'avant le lot.
        // Retour à l'état d'avant le lot (borné : on s'arrête si une annulation ne fait plus rien).
        const known = new Set(h0.past);
        let complete = true;
        for (let k = 0; this.state.history.past.some((e) => !known.has(e)); k++) {
          const before = this.state.history;
          if (k >= 200 || this.state.mode.kind !== 'model') {
            complete = false;
            break;
          }
          this.controller.undo();
          await this.settle();
          if (this.state.history === before) {
            complete = false;
            break;
          }
        }
        if (complete) this.controller.store.patch({ history: h0 });
        const why = `l'opération ${i} (${tool}) a échoué : ${err instanceof Error ? err.message : String(err)}`;
        fail(complete ? `Lot annulé : ${why}` : `Lot interrompu, et annulation incomplète (mode « ${this.state.mode.kind} ») : ${why}`);
      }
    }
    // Les actions du lot ne forment plus qu'une étape d'annulation.
    const kept = new Set(h0.past);
    const h = this.state.history;
    const fresh = h.past.filter((e) => !kept.has(e));
    if (fresh.length > 1) {
      const label = str(args, 'label') ?? `Assistant : ${fresh.map((e) => e.label).slice(0, 3).join(', ')}${fresh.length > 3 ? '…' : ''}`;
      this.controller.store.patch({ history: { past: [...h.past.filter((e) => kept.has(e)), { doc: fresh[0]!.doc, label }], future: [] } });
    }
    return { result: { results: results.map(rounded), undo: nextUndoLabel(this.state.history) } };
  }

  private edgeRefFromIndex(part: Part, index: number): EdgeRef {
    const mesh = this.state.display[part.id]?.mesh ?? fail(`« ${part.name} » n'a pas encore de volume.`);
    const r = edgeRefFromPick(mesh, index, part, null);
    if (r.kind !== 'ref') fail(r.kind === 'invalid' ? `Arête n° ${index} : ${r.reason}` : `L'arête n° ${index} est déjà arrondie ou chanfreinée.`);
    return (r as { ref: EdgeRef }).ref;
  }

  private support(part: Part, raw: unknown): SketchSupport {
    const s = (raw ?? { plane: 'XY' }) as Args;
    if (typeof s.plane === 'string') {
      if (!['XY', 'XZ', 'YZ'].includes(s.plane)) fail('support.plane : XY, XZ ou YZ.');
      return { kind: 'plane', plane: s.plane as 'XY' | 'XZ' | 'YZ', offset: typeof s.offset === 'number' ? s.offset : 0 };
    }
    if (typeof s.face_index === 'number') return { kind: 'face', ref: this.faceRefFromIndex(part, s.face_index) };
    if (s.face && typeof s.face === 'object') return { kind: 'face', ref: s.face as FaceRef };
    if (typeof s.datum === 'string') return { kind: 'datum', featureId: s.datum };
    return fail('support : { plane, offset? }, { face_index }, { face } ou { datum } attendu.');
  }

  // -------------------------------------------------------------------------
  // Esquisses

  /**
   * Ajoute des formes à une esquisse. Chaque forme peut porter un `id` (alias) : ses éléments sont
   * alors nommés `alias`, `alias.bottom`, `alias.center`… pour les contraintes qui suivent.
   */
  private addShapes(sketch: SketchParams, shapes: unknown, aliases: Record<string, string>): SketchParams {
    if (shapes === undefined) return sketch;
    if (!Array.isArray(shapes)) fail('shapes : tableau attendu.');
    let s = sketch;
    const scope = this.parameterValues();
    const name = (sh: Args, i: number) => (typeof sh.id === 'string' ? sh.id : `${String(sh.type)}${i + 1}`);
    const position = (point: string, at: { x: number; y: number }) => {
      if (Math.abs(at.x) < 1e-9 && Math.abs(at.y) < 1e-9) return void (s = addConstraint(s, { type: 'coincident', a: ORIGIN_POINT_ID, b: point }).sketch);
      s = addConstraint(s, Math.abs(at.x) < 1e-9 ? { type: 'pointOn', point, curve: AXIS_Y_ID } : at.x > 0 ? { type: 'distanceX', a: ORIGIN_POINT_ID, b: point, value: at.x } : { type: 'distanceX', a: point, b: ORIGIN_POINT_ID, value: -at.x }).sketch;
      s = addConstraint(s, Math.abs(at.y) < 1e-9 ? { type: 'pointOn', point, curve: AXIS_X_ID } : at.y > 0 ? { type: 'distanceY', a: ORIGIN_POINT_ID, b: point, value: at.y } : { type: 'distanceY', a: point, b: ORIGIN_POINT_ID, value: -at.y }).sketch;
    };
    (shapes as Args[]).forEach((sh, i) => {
      const alias = name(sh, i);
      const dims = sh.dimensions !== false;
      const markConstruction = (ids: string[]) => {
        if (sh.construction !== true) return;
        const set = new Set(ids);
        s = { ...s, entities: s.entities.map((e) => (set.has(e.id) && e.type !== 'point' ? { ...e, construction: true } : e)) };
      };
      const exact = (prims: Prim[]) => {
        const r = emitPrims(s, prims, sh.construction === true);
        s = r.sketch;
        aliases[alias] = r.curves[0]!;
        r.curves.forEach((id, k) => (aliases[`${alias}.c${k}`] = id));
      };
      const rounded = (sh.type === 'rectangle' && sh.radius !== undefined && sh.radius !== 0) || (sh.type === 'polygon' && sh.corner_radius !== undefined && sh.corner_radius !== 0);
      if (rounded || sh.type === 'slot' || sh.type === 'regular_polygon') return exact(operandOf(sh, alias).prims);
      switch (sh.type) {
        case 'boolean': {
          const r = operandOf(sh, alias);
          if (!r.prims.length) fail(`${alias} : le résultat du booléen est vide.`);
          exact(r.prims);
          break;
        }
        case 'ellipse': {
          const c = vec2(sh.center ?? [0, 0], 'ellipse.center');
          const rx = num(sh.rx, 'ellipse.rx');
          const ry = num(sh.ry, 'ellipse.ry');
          const ang = ((sh.angle === undefined ? 0 : num(sh.angle, 'ellipse.angle')) * Math.PI) / 180;
          // Grand axe le long de x (tourné de angle) si rx ≥ ry, sinon le long de y.
          const major = Math.max(rx, ry);
          const dir = rx >= ry ? ang : ang + Math.PI / 2;
          const r = addEllipse(s, c, { x: c.x + major * Math.cos(dir), y: c.y + major * Math.sin(dir) }, Math.min(rx, ry));
          s = r.sketch;
          Object.assign(aliases, { [alias]: r.ellipseId, [`${alias}.center`]: r.center });
          if (dims) position(r.center, c);
          markConstruction([r.ellipseId]);
          break;
        }
        case 'spline': {
          if (!Array.isArray(sh.points) || sh.points.length < 2) fail('spline.points : au moins 2 points [x, y].');
          const pts = (sh.points as unknown[]).map((pt, k) => vec2(pt, `spline.points[${k}]`));
          const closed = sh.closed !== false;
          if (closed && pts.length < 3) fail('spline fermée : au moins 3 points.');
          const r = addSpline(s, pts, closed);
          s = r.sketch;
          aliases[alias] = r.splineId;
          r.points.forEach((id, k) => (aliases[`${alias}.p${k}`] = id));
          markConstruction([r.splineId]);
          break;
        }
        case 'offset': {
          const ref = typeof sh.of === 'string' ? sh.of : fail('offset.of : alias ou identifiant d’une courbe du contour à décaler.');
          const found = loopOfCurve(s, aliases[ref] ?? ref);
          if ('error' in found) return fail(`offset : ${found.error}`);
          const r = addOffsetLoop(s, found.loop, num(sh.distance, 'offset.distance'), sh.construction === true);
          if ('error' in r) return fail(`offset : ${r.error}`);
          s = r.sketch;
          aliases[alias] = r.curves[0]!;
          r.curves.forEach((id, k) => (aliases[`${alias}.c${k}`] = id));
          break;
        }
        case 'rectangle': {
          const W = dimArg(sh.width, 'rectangle.width', scope);
          const H = dimArg(sh.height, 'rectangle.height', scope);
          const w = W.value;
          const h = H.value;
          const at = vec2(sh.at ?? [0, 0], 'rectangle.at');
          const centered = sh.centered === true;
          const c1 = centered ? { x: at.x - w / 2, y: at.y - h / 2 } : at;
          const r = addRectangle(s, c1, { x: c1.x + w, y: c1.y + h });
          s = r.sketch;
          const [bottom, right, top, left] = r.lines;
          const [bl, br, tr, tl] = r.corners;
          Object.assign(aliases, { [`${alias}.bottom`]: bottom, [`${alias}.right`]: right, [`${alias}.top`]: top, [`${alias}.left`]: left, [`${alias}.bl`]: bl, [`${alias}.br`]: br, [`${alias}.tr`]: tr, [`${alias}.tl`]: tl });
          if (dims) {
            const cw = addConstraint(s, { type: 'length', line: bottom, value: w });
            s = withExpression(cw.sketch, cw.id, W.expression);
            const ch = addConstraint(s, { type: 'length', line: right, value: h });
            s = withExpression(ch.sketch, ch.id, H.expression);
            aliases[`${alias}.width`] = cw.id;
            aliases[`${alias}.height`] = ch.id;
            if (centered && Math.abs(at.x) < 1e-9 && Math.abs(at.y) < 1e-9) s = addConstraint(s, { type: 'symmetric', a: bl, b: tr, about: ORIGIN_POINT_ID }).sketch;
            else position(bl, c1);
          }
          markConstruction(r.lines);
          break;
        }
        case 'circle': {
          const c = vec2(sh.center ?? [0, 0], 'circle.center');
          const D = sh.diameter !== undefined ? dimArg(sh.diameter, 'circle.diameter', scope) : (() => {
            const R = dimArg(sh.radius, 'circle.radius', scope);
            return { value: 2 * R.value, ...(R.expression ? { expression: `2*(${R.expression})` } : {}) };
          })();
          const d = D.value;
          const r = addCircle(s, c, d / 2);
          s = r.sketch;
          Object.assign(aliases, { [alias]: r.circleId, [`${alias}.center`]: r.center });
          if (dims) {
            const cd = addConstraint(s, { type: 'diameter', circle: r.circleId, value: d });
            s = withExpression(cd.sketch, cd.id, D.expression);
            aliases[`${alias}.diameter`] = cd.id;
            position(r.center, c);
          }
          markConstruction([r.circleId]);
          break;
        }
        case 'line': {
          const r = addLine(s, vec2(sh.from, 'line.from'), vec2(sh.to, 'line.to'));
          s = r.sketch;
          Object.assign(aliases, { [alias]: r.lineId, [`${alias}.start`]: r.a, [`${alias}.end`]: r.b });
          markConstruction([r.lineId]);
          break;
        }
        case 'polygon': {
          if (!Array.isArray(sh.points) || sh.points.length < 3) fail('polygon.points : au moins 3 points [x, y].');
          const pts = (sh.points as unknown[]).map((p, k) => vec2(p, `polygon.points[${k}]`));
          const r = addClosedPolyline(s, pts);
          s = r.sketch;
          r.lineIds.forEach((id, k) => {
            const line = s.entities.find((e) => e.id === id) as { a: string; b: string };
            aliases[`${alias}.l${k}`] = id;
            aliases[`${alias}.p${k}`] = line.a;
            const a = pts[k]!;
            const b = pts[(k + 1) % pts.length]!;
            if (dims && Math.abs(a.y - b.y) < 1e-9) s = addConstraint(s, { type: 'horizontal', line: id }).sketch;
            else if (dims && Math.abs(a.x - b.x) < 1e-9) s = addConstraint(s, { type: 'vertical', line: id }).sketch;
          });
          markConstruction(r.lineIds);
          break;
        }
        case 'arc': {
          const r = addArc(s, vec2(sh.center, 'arc.center'), vec2(sh.start, 'arc.start'), vec2(sh.end, 'arc.end'));
          s = r.sketch;
          Object.assign(aliases, { [alias]: r.arcId, [`${alias}.center`]: r.center, [`${alias}.start`]: r.start, [`${alias}.end`]: r.end });
          markConstruction([r.arcId]);
          break;
        }
        case 'point': {
          const at = vec2(sh.at, 'point.at');
          const r = addPoint(s, at);
          s = r.sketch;
          aliases[alias] = r.id;
          if (dims) position(r.id, at);
          break;
        }
        case 'text': {
          const r = addText(s, vec2(sh.at ?? [0, 0], 'text.at'), typeof sh.text === 'string' ? sh.text : fail('text.text attendu.'), num(sh.height ?? 10, 'text.height'), typeof sh.angle === 'number' ? sh.angle : 0);
          s = r.sketch;
          Object.assign(aliases, { [alias]: r.textId, [`${alias}.anchor`]: r.anchor });
          break;
        }
        default:
          fail(`Forme « ${String(sh.type)} » inconnue : rectangle, circle, line, polygon, regular_polygon, slot, ellipse, spline, arc, point, text, offset ou boolean.`);
      }
    });
    return s;
  }

  /** Contraintes : les champs qui désignent un élément acceptent un alias (ex. « plaque.bottom »). */
  private addConstraints(sketch: SketchParams, constraints: unknown, aliases: Record<string, string>): SketchParams {
    if (constraints === undefined) return sketch;
    if (!Array.isArray(constraints)) fail('constraints : tableau attendu.');
    let s = sketch;
    for (const raw of constraints as Args[]) {
      const c: Args = { ...raw };
      for (const key of ['a', 'b', 'line', 'circle', 'point', 'curve', 'about']) {
        const v = c[key];
        if (typeof v === 'string') c[key] = aliases[v] ?? v;
      }
      const known = new Set([...s.entities.map((e) => e.id), ORIGIN_POINT_ID, AXIS_X_ID, AXIS_Y_ID]);
      for (const key of ['a', 'b', 'line', 'circle', 'point', 'curve', 'about']) {
        const v = c[key];
        if (typeof v === 'string' && !known.has(v)) fail(`Contrainte ${String(c.type)} : élément « ${v} » inconnu.`);
      }
      const dim = c.value !== undefined ? dimArg(c.value, `${String(c.type)}.value`, this.parameterValues()) : null;
      if (dim) c.value = dim.value;
      const added = addConstraint(s, c as unknown as NewConstraint);
      s = withExpression(added.sketch, added.id, dim?.expression);
      if (typeof raw.id === 'string') aliases[raw.id] = added.id;
    }
    return s;
  }

  private sketchReport(partId: Id, featureId: Id, aliases: Record<string, string>) {
    const part = findPart(this.state.doc, partId)!;
    const f = part.features.find((x) => x.id === featureId)!;
    return { sketch: this.featureInfo(part, f), ids: aliases, part: { id: part.id, name: part.name } };
  }

  // -------------------------------------------------------------------------
  // Outils

  async call(tool: string, args: Args): Promise<ToolOutput> {
    await this.kernelReady();
    switch (tool) {
      case 'get_document':
        await this.settle();
        return { result: this.documentInfo() };

      case 'get_feature': {
        await this.settle();
        const { part, feature } = this.feature(args.feature_id);
        const out: Record<string, unknown> = { ...this.featureInfo(part, feature), partId: part.id, params: feature.params };
        if (feature.expressions) out.expressions = feature.expressions;
        if (feature.type === 'sketch') {
          const sk = this.state.display[part.id]?.result.sketches.find((x) => x.featureId === feature.id);
          if (sk) {
            out.frame = sk.frame;
            out.solvedPoints = sk.solved.entities.filter((e) => e.type === 'point');
            if (sk.freeEntities.length) out.freeEntities = sk.freeEntities;
          }
        }
        return { result: out };
      }

      case 'list_feature_types': {
        const types = (Object.keys(FEATURE_DEFINITIONS) as FeatureType[]).map((type) => {
          const def = FEATURE_DEFINITIONS[type] as unknown as FeatureDefinition;
          return { type, label: def.label, explanation: def.explanation, creatable: !!def.tool && type !== 'sketch' && type !== 'image', input: def.tool?.input, requiresSolid: def.tool?.requiresSolid ?? false };
        });
        return { result: types.filter((t) => t.creatable) };
      }

      case 'new_part': {
        this.requireModelMode();
        const r = addPart(this.state.doc, str(args, 'name'));
        await this.apply(r.doc, 'Ajouter une pièce', r.partId);
        return { result: { partId: r.partId, name: findPart(this.state.doc, r.partId)?.name } };
      }

      case 'create_sketch': {
        this.requireModelMode();
        const part = this.editablePart(str(args, 'part_id'));
        const feature = makeSketchFeature(this.state.doc, part, this.support(part, args.support));
        if (str(args, 'name')) feature.name = str(args, 'name')!;
        const aliases: Record<string, string> = {};
        let params = this.addShapes(feature.params, args.shapes, aliases);
        params = this.addConstraints(params, args.constraints, aliases);
        const sketch: SketchFeature = { ...feature, params };
        await this.apply(addFeature(this.state.doc, part.id, sketch), `Créer « ${sketch.name} »`, part.id);
        return { result: this.sketchReport(part.id, sketch.id, aliases) };
      }

      case 'update_sketch': {
        this.requireModelMode();
        const { part, feature } = this.feature(args.feature_id);
        if (feature.type !== 'sketch') fail(`« ${feature.name} » n'est pas une esquisse.`);
        this.editablePart(part.id);
        let params = (feature as SketchFeature).params;
        if (Array.isArray(args.remove) && args.remove.length) {
          const ids = new Set(args.remove as string[]);
          params = removeConstraints(params, params.constraints.filter((c) => ids.has(c.id)).map((c) => c.id));
          params = removeEntities(params, params.entities.filter((e) => ids.has(e.id)).map((e) => e.id));
        }
        if (Array.isArray(args.set_values)) {
          for (const v of args.set_values as Args[]) {
            const c = params.constraints.find((x) => x.id === v.id) ?? fail(`Cote « ${String(v.id)} » introuvable (voir get_feature : constraints).`);
            if (!('value' in c)) fail(`« ${c.id} » (${c.type}) n'est pas une cote.`);
            const ref = typeof v.id === 'string' ? v.id : '';
            const dim = dimArg(v.value, `valeur de ${ref}`, this.parameterValues());
            params = updateConstraint(params, c.id, { value: dim.value, expression: dim.expression } as never);
          }
        }
        if (args.support !== undefined) params = { ...params, support: this.support(part, args.support) };
        const aliases: Record<string, string> = {};
        params = this.addShapes(params, args.add_shapes, aliases);
        params = this.addConstraints(params, args.add_constraints, aliases);
        const updated = { ...(feature as SketchFeature), params, ...(str(args, 'name') ? { name: str(args, 'name')! } : {}) };
        await this.apply(replaceFeature(this.state.doc, updated), `Modifier « ${updated.name} »`, part.id);
        return { result: this.sketchReport(part.id, feature.id, aliases) };
      }

      case 'add_feature': {
        this.requireModelMode();
        const type = str(args, 'type') as FeatureType | undefined;
        const def = (type && (FEATURE_DEFINITIONS[type] as unknown as FeatureDefinition | undefined)) || fail(`Type « ${String(type)} » inconnu (voir list_feature_types).`);
        const tool = def.tool;
        if (!tool || type === 'sketch' || type === 'image') fail(`« ${def.label} » ne se crée pas avec add_feature.`);
        const sketchId = str(args, 'sketch_id');
        const part = this.editablePart(str(args, 'part_id') ?? (sketchId ? findFeature(this.state.doc, sketchId)?.part.id : undefined));
        const result = this.state.display[part.id]?.result;
        if (tool!.requiresSolid && !result?.analysis?.solidCount) fail(tool!.requiresSolidReason ?? `« ${part.name} » n'a pas encore de volume.`);
        let input: ToolInput;
        let sketchFrame = null;
        if (tool!.input === 'sketch') {
          const sk = sketchId ? part.features.find((f) => f.id === sketchId && f.type === 'sketch') : [...part.features].reverse().find((f) => f.type === 'sketch');
          if (!sk) fail(sketchId ? `Esquisse « ${sketchId} » introuvable dans « ${part.name} ».` : `« ${part.name} » n'a aucune esquisse.`);
          input = { kind: 'sketch', sketchId: sk!.id };
          sketchFrame = result?.sketches.find((x) => x.featureId === sk!.id)?.frame ?? null;
        } else if (tool!.input === 'edges') {
          const edges = [...(Array.isArray(args.edges) ? (args.edges as EdgeRef[]) : []), ...(Array.isArray(args.edge_indices) ? (args.edge_indices as number[]).map((i) => this.edgeRefFromIndex(part, i)) : [])];
          input = { kind: 'edges', edges };
        } else if (tool!.input === 'faces') {
          const faces = [...(Array.isArray(args.faces) ? (args.faces as FaceRef[]) : []), ...(Array.isArray(args.face_indices) ? (args.face_indices as number[]).map((i) => this.faceRefFromIndex(part, i)) : [])];
          input = { kind: 'faces', faces };
        } else input = { kind: 'part' };
        let feature = tool!.create(this.state.doc, part, input, { sketchFrame, partBounds: result?.analysis?.bbox ?? null });
        if (args.params !== undefined) feature = { ...feature, params: deepMerge(feature.params, args.params) } as Feature;
        if (str(args, 'name')) feature = { ...feature, name: str(args, 'name')! };
        feature = this.withFieldExpressions(feature, args.expressions);
        const issues = validateFeature(feature);
        if (issues.length) fail(`Paramètres invalides : ${issues.map((i) => `${i.field} — ${i.message}`).join(' ; ')}. Paramètres essayés : ${JSON.stringify(feature.params)}`);
        let doc = addFeature(this.state.doc, part.id, feature);
        // Comme dans l'interface : l'esquisse utilisée par le nouveau volume est masquée.
        for (const dep of featureDependencies(feature)) doc = updateFeature<SketchFeature>(doc, dep, (f) => (f.type === 'sketch' ? { ...f, visible: false } : f));
        const out = await this.applyChecked(doc, `Créer « ${feature.name} »`, part.id, feature.id);
        return { result: { ...out, params: feature.params } };
      }

      case 'update_feature': {
        this.requireModelMode();
        const { part, feature } = this.feature(args.feature_id);
        this.editablePart(part.id);
        let next = feature;
        if (args.params !== undefined) next = { ...next, params: deepMerge(next.params, args.params) } as Feature;
        if (str(args, 'name')) next = { ...next, name: str(args, 'name')! };
        next = this.withFieldExpressions(next, args.expressions);
        const issues = validateFeature(next);
        if (issues.length) fail(`Paramètres invalides : ${issues.map((i) => `${i.field} — ${i.message}`).join(' ; ')}`);
        const out = await this.applyChecked(replaceFeature(this.state.doc, next), `Modifier « ${next.name} »`, part.id, next.id);
        return { result: { ...out, params: next.params } };
      }

      case 'delete_feature': {
        this.requireModelMode();
        const { part } = this.feature(args.feature_id);
        this.editablePart(part.id);
        const before = new Set(part.features.map((f) => f.id));
        if (args.with_following === true) {
          // L'étape et toutes celles qui la suivent (déplacements compris), sans notification.
          const from = part.features.findIndex((f) => f.id === args.feature_id);
          const ids = part.features.slice(from).map((f) => f.id);
          const { doc } = removeFeaturesCascade(this.state.doc, part.id, ids, featureDependencies);
          await this.apply(doc, `Supprimer « ${part.features[from]!.name} » et la suite (${ids.length} étape${ids.length > 1 ? 's' : ''})`, part.id);
        } else {
          this.controller.deleteFeature(args.feature_id as string);
          await this.settle();
        }
        const after = new Set(findPart(this.state.doc, part.id)?.features.map((f) => f.id) ?? []);
        return { result: { removed: [...before].filter((id) => !after.has(id)), part: this.partInfo(findPart(this.state.doc, part.id)!) } };
      }

      case 'get_parameters':
        return { result: rounded(this.parametersInfo()) };

      case 'set_parameters': {
        this.requireModelMode();
        return { result: rounded(await this.setParameters(args)) };
      }

      case 'copy_part':
        this.requireModelMode();
        return { result: rounded(await this.copyPart(args)) };

      case 'rename_part': {
        this.requireModelMode();
        const part = this.partByIdOrName(args.part ?? args.part_id);
        const name = str(args, 'name')?.trim() || fail('name : nouveau nom attendu.');
        await this.apply(renamePart(this.state.doc, part.id, name), `Renommer la pièce « ${name} »`, part.id);
        return { result: { partId: part.id, name } };
      }

      case 'delete_part': {
        this.requireModelMode();
        const refs = Array.isArray(args.parts) ? (args.parts as unknown[]) : [args.part ?? args.part_id];
        const parts = refs.map((r) => this.partByIdOrName(r));
        let doc = this.state.doc;
        for (const p of parts) doc = removePart(doc, p.id);
        if (doc.parts.length === 0) doc = addPart(doc).doc;
        const names = parts.map((p) => `« ${p.name} »`).join(', ');
        await this.apply(doc, `Supprimer ${parts.length > 1 ? 'les pièces' : 'la pièce'} ${names}`, doc.parts[0]!.id);
        return { result: { removed: parts.map((p) => ({ id: p.id, name: p.name })), parts: this.state.doc.parts.map((p) => ({ id: p.id, name: p.name })) } };
      }

      case 'batch':
        return this.batch(args);

      case 'list_geometry': {
        await this.settle();
        const part = this.part(str(args, 'part_id'));
        const mesh = this.state.display[part.id]?.mesh;
        if (!mesh) return { result: { part: part.id, faces: [], edges: [], note: "Pas encore de volume." } };
        const max = typeof args.max === 'number' ? args.max : 200;
        const faces = mesh.faces.slice(0, max).map((f, index) => ({ index, ref: pickFaceReference(f.tags, part), surface: f.surface, area: f.area, plane: f.plane, cylinder: f.cylinder }));
        const edges = mesh.edges.slice(0, max).map((e, index) => {
          const r = edgeRefFromPick(mesh, index, part, null);
          return { index, faces: e.faces, curve: e.curve, length: e.length, line: e.line, circle: e.circle, selectable: r.kind === 'ref' };
        });
        return { result: rounded({ part: part.id, faceCount: mesh.faces.length, edgeCount: mesh.edges.length, faces, edges }) };
      }

      case 'export': {
        await this.settle();
        const format = str(args, 'format');
        if (format !== 'step' && format !== 'stl') fail('format : "step" ou "stl".');
        const ids = Array.isArray(args.part_ids) && args.part_ids.length ? (args.part_ids as string[]) : this.state.doc.parts.filter((p) => p.visible).map((p) => p.id);
        const parts = ids.map((id) => this.part(id));
        const empty = parts.filter((p) => !this.state.display[p.id]?.result.analysis?.solidCount);
        if (empty.length) fail(`Sans volume, impossible à exporter : ${empty.map((p) => `« ${p.name} »`).join(', ')}.`);
        const { bytes, warnings } = await this.controller.exportBytes(format as 'step' | 'stl', ids);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const baseName = parts.length === 1 ? parts[0]!.name : this.state.doc.name;
        return {
          result: { format, parts: parts.map((p) => ({ id: p.id, name: p.name })), suggestedName: baseName, size: bytes.length, warnings },
          file: btoa(binary),
        };
      }

      case 'get_print_plates':
        await this.settle();
        return { result: rounded(this.printPlatesInfo()) };

      case 'set_print_plate': {
        this.requireModelMode();
        await this.settle();
        return { result: rounded(await this.setPrintPlate(args)) };
      }

      case 'get_laser_layout':
        await this.settle();
        return { result: rounded(this.laserInfo()) };

      case 'set_laser': {
        this.requireModelMode();
        await this.settle();
        return { result: rounded(await this.setLaser(args)) };
      }

      case 'export_laser': {
        await this.settle();
        const format = str(args, 'format') ?? 'svg';
        if (format !== 'svg' && format !== 'dxf') fail('format : "svg" ou "dxf".');
        const groups = this.controller.laserLayout().materials.filter((g) => g.placed.length > 0);
        if (!groups.length) fail('Aucune pièce à découper : indiquez au moins un exemplaire (set_laser).');
        const group =
          args.material !== undefined
            ? groups.find((g) => g.material.id === args.material || g.material.name === args.material) ?? fail(`Aucune pièce placée sur le matériau « ${String(args.material)} ».`)
            : groups.length === 1
              ? groups[0]!
              : fail(`Plusieurs matériaux ont des pièces : précisez material (${groups.map((g) => `« ${g.material.name} »`).join(', ')}).`);
        const vector = this.controller.laserDocument(group.material.id)!;
        const text = format === 'svg' ? toSvg(vector) : toDxf(vector);
        const bytes = new TextEncoder().encode(text);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return {
          result: {
            format,
            material: group.material.name,
            sheet: group.material.sheet,
            sheets: group.sheets,
            pieces: group.placed.length,
            suggestedName: `${this.state.doc.name} - laser - ${group.material.name}`,
            size: bytes.length,
            note: 'Échelle 1:1 en millimètres ; rouge : découpe, bleu : gravure.',
          },
          file: btoa(binary),
        };
      }

      case 'undo':
      case 'redo': {
        this.requireModelMode();
        if (tool === 'undo') this.controller.undo();
        else this.controller.redo();
        await this.settle();
        return { result: { undo: nextUndoLabel(this.state.history), redo: nextRedoLabel(this.state.history) } };
      }

      case 'screenshot': {
        await this.settle();
        const view = str(args, 'view') as StandardView | undefined;
        if (view) {
          // Vue posée sans animation : l'animation de la caméra n'avance qu'aux images affichées,
          // et un onglet en arrière-plan n'en affiche plus. La vue standard est déjà cadrée sur
          // les pièces (fitAll après coup repartirait de l'ancienne direction).
          // TODO : exposer `animate` dans Viewport.setStandardView / controller.setView.
          type Rig = { setStandardView(v: StandardView, bounds: unknown, animate: boolean): void };
          const vp = (this.controller as unknown as { viewport: { rig?: Rig; contentBounds?: () => unknown } | null }).viewport;
          if (vp?.rig && vp.contentBounds) vp.rig.setStandardView(view, vp.contentBounds(), false);
          else {
            this.controller.setView(view);
            await sleep(900);
          }
        }
        const url = this.controller.viewportSnapshot() ?? fail("La vue 3D n'est pas affichée.");
        return { result: { view: view ?? 'actuelle' }, image: url!.replace(/^data:image\/png;base64,/, '') };
      }

      default:
        return fail(`Outil « ${tool} » inconnu.`);
    }
  }
}

interface CallMessage {
  id: number;
  tool: string;
  args: Args;
}

/**
 * État du pont gardé d'une version du module à l'autre (globalThis) : le contrôleur et la file des
 * appels. Chaque version du module repose ses écouteurs, car Vite retire ceux de l'ancienne version
 * quand il la remplace.
 */
interface BridgeSlot {
  controller: AppController;
  queue: Promise<void>;
  hello: () => void;
}
const SLOT_KEY = '__vibecadMcpBridge';
const slot = () => (globalThis as Record<string, unknown>)[SLOT_KEY] as BridgeSlot | undefined;

/** Écouteurs du WebSocket pour cette version du module. */
function listen(hot: NonNullable<ImportMeta['hot']>, state: BridgeSlot): void {
  const bridge = new McpBridge(state.controller);
  state.hello = () => hot.send('vibecad-mcp:hello', {});
  hot.on('vite:ws:connect', () => state.hello());
  hot.on('vibecad-mcp:call', (msg: CallMessage) => {
    // Un appel à la fois, dans l'ordre d'arrivée.
    state.queue = state.queue.then(async () => {
      try {
        const out = await bridge.call(msg.tool, msg.args ?? {});
        hot.send('vibecad-mcp:result', { id: msg.id, ok: true, result: rounded(out.result), image: out.image, file: out.file });
      } catch (err) {
        const message = err instanceof ToolError ? err.message : `Erreur interne : ${(err as Error).message}`;
        hot.send('vibecad-mcp:result', { id: msg.id, ok: false, error: message });
      }
    });
  });
  state.hello();
}

/** Branche le pont sur le WebSocket du serveur de développement. */
export function installMcpBridge(controller: AppController): void {
  const hot = import.meta.hot;
  if (!hot || slot()) return;
  const state: BridgeSlot = { controller, queue: Promise.resolve(), hello: () => {} };
  (globalThis as Record<string, unknown>)[SLOT_KEY] = state;
  // L'onglet revenu au premier plan devient celui qui reçoit les appels.
  window.addEventListener('focus', () => state.hello());
  listen(hot, state);
}

// Mise à jour à chaud : une modification de ce fichier remplace le code du pont sans recharger la
// page, donc sans perdre le projet ouvert (le module n'est importé que par main.tsx).
if (import.meta.hot) {
  const current = slot();
  if (current) {
    // Nouvelle file : un appel resté bloqué dans l'ancienne version ne bloque pas les suivants.
    current.queue = Promise.resolve();
    listen(import.meta.hot, current);
  }
  import.meta.hot.accept();
}
