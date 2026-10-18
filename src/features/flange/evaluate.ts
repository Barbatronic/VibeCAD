import type { FaceRef, FlangeFeature } from '../../domain/model';
import { kFactorFor, sheetMaterial } from '../../domain/sheet-metal';
import { issue, okStatus } from '../../domain/status';
import type { KernelShape } from '../../geometry/kernel';
import { cross3, dot3, length3, normalize3, scale3, sub3, type Vec3 } from '../../math/vec';
import type { FeatureEvaluator } from '../evaluation';
import { FoldCrossingError, foldAllowance, foldSheet, type FoldSpec, type SheetState } from '../sheet/fold';
import { bendWarning } from '../sheet/limits';
import { flangeDefinition } from './definition';

/**
 * Bord plié : pour chaque arête choisie (bord de la tôle à plat), une languette de la longueur
 * développée du pli plus celle du rebord est ajoutée au plat, puis pliée sur la ligne du bord.
 */
export const evaluateFlange: FeatureEvaluator<FlangeFeature> = (feature, ctx) => {
  const paramIssues = flangeDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const sheet = ctx.sheet;
  if (!sheet) return { status: issue(feature.id, 'error', 'SHEET_REQUIRED') };
  if (sheet.later.length) return { status: issue(feature.id, 'error', 'SHEET_AFTER_FOLD', { relatedFeatureId: sheet.later[0]! }) };
  const { kernel } = ctx;
  const { frame, thickness: t } = sheet;
  const n = frame.normal;
  const material = sheetMaterial(sheet.materialId);
  const radius = feature.params.radius ?? sheet.radius;
  const k = kFactorFor(material, radius, t);
  const angle = ((feature.params.angle * Math.PI) / 180) * (feature.params.direction === 'down' ? -1 : 1);
  const tabs: KernelShape[] = [];
  const folds: FoldSpec[] = [];
  const height = (p: Vec3) => dot3(sub3(p, frame.origin), n);
  try {
    for (const picked of feature.params.edges) {
      // Arête cliquée sur la pièce pliée : ses faces sont retrouvées sur la tôle à plat.
      const edge = { ...picked, faces: picked.faces.map((f) => flatFaceRef(f, sheet)) as typeof picked.faces };
      const curves = kernel.edgeCurves(sheet.flat, edge);
      const line = curves.length === 1 && curves[0]!.kind === 'line' ? curves[0]! : null;
      if (!line || line.kind !== 'line') return fail('SHEET_FLANGE_EDGE');
      // Arête du dessus ou du dessous, pas de l'épaisseur.
      const ha = height(line.start);
      const hb = height(line.end);
      const onFace = (h: number) => Math.abs(h) < 1e-5 || Math.abs(h - t) < 1e-5;
      if (!onFace(ha) || !onFace(hb) || Math.abs(ha - hb) > 1e-5) return fail('SHEET_FLANGE_EDGE');
      // Côté de la tôle (face perpendiculaire) : sa normale sortante donne le sens du rebord.
      let outward: Vec3 | null = null;
      for (const face of edge.faces) {
        const found = kernel.findFacePlane(sheet.flat, face);
        if (found.status === 'found' && Math.abs(dot3(found.normal, n)) < 1e-6) outward = normalize3(found.normal);
      }
      if (!outward) return fail('SHEET_FLANGE_EDGE');
      // Ligne du bord ramenée sur le dessous de la tôle ; repère (d, côté, normale) direct.
      let a = sub3(line.start, scale3(n, ha));
      let b = sub3(line.end, scale3(n, hb));
      if (dot3(cross3(normalize3(sub3(b, a)), outward), n) < 0) [a, b] = [b, a];
      const d = normalize3(sub3(b, a));
      const spec: FoldSpec = { featureId: feature.id, point: toSheet(sheet, a), dir: { x: dot3(d, frame.xAxis), y: dot3(d, frame.yAxis) }, side: 1, angle, radius, k };
      const reach = foldAllowance(spec, t) + feature.params.length;
      const box = kernel.makePrimitive({ featureId: feature.id, shape: 'box', position: { x: 0, y: 0, z: 0 }, width: length3(sub3(b, a)), depth: reach, height: t, diameter: 1, thickness: 1 });
      try {
        // Étiquettes propres à chaque rebord de l'étape (rang du bord) : une esquisse posée sur
        // l'un d'eux le retrouve sans ambiguïté.
        tabs.push(kernel.transformed(box, [d.x, d.y, d.z, 0, outward.x, outward.y, outward.z, 0, n.x, n.y, n.z, 0, a.x, a.y, a.z, 1], { featureId: feature.id, index: folds.length }));
      } finally {
        kernel.dispose(box);
      }
      folds.push(spec);
    }
    const flat = kernel.fuseMany(sheet.flat, tabs);
    const next: SheetState = { ...sheet, flat, folds: [...sheet.folds, ...folds] };
    let shape: KernelShape;
    try {
      shape = foldSheet(kernel, next);
    } catch (err) {
      kernel.dispose(flat);
      if (err instanceof FoldCrossingError) return { status: issue(feature.id, 'error', 'SHEET_FOLD_CROSSING', { relatedFeatureId: err.crossed }) };
      throw err;
    }
    const analysis = kernel.analyze(shape);
    if (!analysis.valid || analysis.solidCount !== 1) {
      kernel.dispose(shape);
      kernel.dispose(flat);
      return { status: issue(feature.id, 'error', 'SHEET_FOLD_FAILED') };
    }
    const warning = bendWarning(sheet.materialId, t, radius, feature.params.angle);
    return { status: warning ? issue(feature.id, 'warning', 'SHEET_BEND_LIMIT', { message: warning }) : okStatus(feature.id), shape, analysis, sheet: next, owned: [flat] };
  } finally {
    for (const s of tabs) kernel.dispose(s);
  }

  function fail(code: 'SHEET_FLANGE_EDGE') {
    return { status: issue(feature.id, 'error', code) };
  }
};

/**
 * Référence d'une face de la pièce pliée ramenée à la tôle à plat : un morceau déplacé par un pli
 * porte l'étiquette du pli (« <étape d'origine>/<élément> ») ; on retrouve l'étiquette d'origine.
 */
export function flatFaceRef(ref: FaceRef, sheet: SheetState): FaceRef {
  const folds = new Set(sheet.folds.map((f) => f.featureId));
  let r = ref;
  while (folds.has(r.featureId) && r.entityId?.includes('/')) {
    const k = r.entityId.indexOf('/');
    const entity = r.entityId.slice(k + 1);
    r = { featureId: r.entityId.slice(0, k), role: r.role, ...(entity ? { entityId: entity } : {}), ...(r.index !== undefined ? { index: r.index } : {}) };
  }
  return r;
}

function toSheet(sheet: SheetState, p: Vec3) {
  const d = sub3(p, sheet.frame.origin);
  return { x: dot3(d, sheet.frame.xAxis), y: dot3(d, sheet.frame.yAxis) };
}

