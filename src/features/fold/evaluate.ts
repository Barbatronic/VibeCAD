import type { FoldFeature } from '../../domain/model';
import { kFactorFor, sheetMaterial } from '../../domain/sheet-metal';
import { issue, okStatus } from '../../domain/status';
import { frameToWorld } from '../../math/frame';
import { cross3, dot3, normalize3, sub3, type Vec3 } from '../../math/vec';
import type { FeatureEvaluator } from '../evaluation';
import { FoldCrossingError, foldSheet, type FoldSpec, type SheetState } from '../sheet/fold';
import { bendWarning } from '../sheet/limits';
import { foldDefinition } from './definition';

/** Pli sur une ligne : le trait de l'esquisse, posé sur la tôle, devient une ligne de pli. */
export const evaluateFold: FeatureEvaluator<FoldFeature> = (feature, ctx) => {
  const paramIssues = foldDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const sheet = ctx.sheet;
  if (!sheet) return { status: issue(feature.id, 'error', 'SHEET_REQUIRED') };
  if (sheet.later.length) return { status: issue(feature.id, 'error', 'SHEET_AFTER_FOLD', { relatedFeatureId: sheet.later[0]! }) };
  const entry = ctx.sketches.get(feature.params.sketchId);
  if (!entry) return { status: issue(feature.id, 'error', 'SKETCH_MISSING') };
  const frame = entry.evaluation.frame;
  if (entry.status.state === 'error' || entry.status.state === 'blocked' || !frame) return { status: issue(feature.id, 'blocked', 'SKETCH_FAILED', { blockedBy: feature.params.sketchId, relatedFeatureId: feature.params.sketchId }) };
  const sk = entry.evaluation.solved;
  const lines = sk.entities.filter((e) => e.type === 'line');
  const line = (feature.params.lineId ? lines.find((l) => l.id === feature.params.lineId) : (lines.find((l) => !l.construction) ?? lines[0])) as { a: string; b: string } | undefined;
  const point = (id: string) => sk.entities.find((e) => e.id === id && e.type === 'point') as { x: number; y: number } | undefined;
  const a = line ? point(line.a) : undefined;
  const b = line ? point(line.b) : undefined;
  if (!a || !b) return { status: issue(feature.id, 'error', 'SHEET_FOLD_LINE', { relatedFeatureId: feature.params.sketchId }) };
  const spec = foldSpecFromLine(feature, sheet, frameToWorld(frame, a), frameToWorld(frame, b), frame.normal);
  if (!spec) return { status: issue(feature.id, 'error', 'SHEET_FOLD_LINE', { relatedFeatureId: feature.params.sketchId }) };
  const next: SheetState = { ...sheet, folds: [...sheet.folds, spec] };
  let shape;
  try {
    shape = foldSheet(ctx.kernel, next);
  } catch (err) {
    if (err instanceof FoldCrossingError) return { status: issue(feature.id, 'error', 'SHEET_FOLD_CROSSING', { relatedFeatureId: err.crossed }) };
    throw err;
  }
  const analysis = ctx.kernel.analyze(shape);
  if (!analysis.valid || analysis.solidCount !== 1) {
    ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'SHEET_FOLD_FAILED') };
  }
  const warning = bendWarning(sheet.materialId, sheet.thickness, spec.radius, feature.params.angle);
  return { status: warning ? issue(feature.id, 'warning', 'SHEET_BEND_LIMIT', { message: warning }) : okStatus(feature.id), shape, analysis, sheet: next };
};

/** Pli du segment (a, b) (monde), dessiné sur un plan de normale `sketchNormal` ; null s'il n'est pas sur la tôle. */
function foldSpecFromLine(feature: FoldFeature, sheet: SheetState, a: Vec3, b: Vec3, sketchNormal: Vec3): FoldSpec | null {
  const n = sheet.frame.normal;
  // Le trait doit être dans le plan du dessus ou du dessous de la tôle (ou sur son plan d'esquisse).
  if (Math.abs(Math.abs(dot3(normalize3(sketchNormal), n)) - 1) > 1e-6) return null;
  const h = dot3(sub3(a, sheet.frame.origin), n);
  if (h < -1e-6 || h > sheet.thickness + 1e-6) return null;
  const toSheet = (p: Vec3) => ({ x: dot3(sub3(p, sheet.frame.origin), sheet.frame.xAxis), y: dot3(sub3(p, sheet.frame.origin), sheet.frame.yAxis) });
  const pa = toSheet(a);
  const pb = toSheet(b);
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
  if (len < 1e-6) return null;
  const dir = { x: (pb.x - pa.x) / len, y: (pb.y - pa.y) / len };
  // « Gauche » du trait vu depuis l'esquisse (sa normale) ; dans la tôle, la gauche est n × d.
  const dWorld = normalize3(sub3(b, a));
  const leftSketch = cross3(sketchNormal, dWorld);
  const leftSheet = cross3(n, dWorld);
  const sameSide = dot3(leftSketch, leftSheet) > 0;
  const wantLeft = feature.params.side === 'left';
  const side: 1 | -1 = wantLeft === sameSide ? 1 : -1;
  const material = sheetMaterial(sheet.materialId);
  const radius = feature.params.radius ?? sheet.radius;
  const angle = (feature.params.angle * Math.PI) / 180;
  return { featureId: feature.id, point: pa, dir, side, angle: feature.params.direction === 'down' ? -angle : angle, radius, k: kFactorFor(material, radius, sheet.thickness) };
}
