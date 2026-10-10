import type { ExtentDirection, PocketFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { BoundingBox } from '../../geometry/kernel';
import { signedDistanceToFrame, type Frame3D } from '../../math/frame';
import type { FeatureEvaluator } from '../evaluation';
import { resolveProfile } from '../sketch/evaluate';
import { pocketDefinition } from './definition';

/** Intervalle d'une poche de profondeur `d` : par défaut contre la normale (dans la matière). */
export function pocketRange(direction: ExtentDirection, d: number): [number, number] {
  if (direction === 'reversed') return [0, d];
  if (direction === 'symmetric') return [-d / 2, d / 2];
  return [-d, 0];
}

/** Intervalle « traversant » : couvre toute la boîte englobante de la pièce, avec une marge. */
export function throughAllRange(direction: ExtentDirection, frame: Frame3D, bbox: BoundingBox): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const x of [bbox.min.x, bbox.max.x]) {
    for (const y of [bbox.min.y, bbox.max.y]) {
      for (const z of [bbox.min.z, bbox.max.z]) {
        const d = signedDistanceToFrame(frame, { x, y, z });
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
    }
  }
  const diag = Math.hypot(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z);
  const margin = 1 + diag * 0.05;
  const low = Math.min(min, 0) - margin;
  const high = Math.max(max, 0) + margin;
  if (direction === 'reversed') return [0, high];
  if (direction === 'symmetric') return [low, high];
  return [low, 0];
}

export const evaluatePocket: FeatureEvaluator<PocketFeature> = (feature, ctx) => {
  const paramIssues = pocketDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis) return { status: issue(feature.id, 'error', 'POCKET_WITHOUT_SOLID') };
  const resolved = resolveProfile(feature.id, feature.params.sketchId, ctx);
  if ('status' in resolved) return resolved;
  const { extent, direction } = feature.params;
  let range: [number, number];
  if (extent.kind === 'distance') range = pocketRange(direction, extent.distance);
  else if (ctx.shapeAnalysis.bbox) range = throughAllRange(direction, resolved.frame, ctx.shapeAnalysis.bbox);
  else return { status: issue(feature.id, 'error', 'POCKET_WITHOUT_SOLID') };
  const tool = ctx.kernel.makePrism({ featureId: feature.id, regions: resolved.regions, frame: resolved.frame, from: range[0], to: range[1] });
  let shape;
  try {
    shape = ctx.kernel.cut(ctx.shape, tool);
  } catch (err) {
    ctx.kernel.dispose(tool);
    throw err;
  }
  const analysis = ctx.kernel.analyze(shape);
  const before = ctx.shapeAnalysis.volume;
  const tiny = Math.max(1e-9, before * 1e-9);
  if (analysis.solidCount === 0 || analysis.volume <= tiny) {
    ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'POCKET_REMOVES_EVERYTHING'), tool };
  }
  if (!analysis.valid) {
    ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID'), tool };
  }
  const removed = before - analysis.volume;
  const status = removed <= tiny ? issue(feature.id, 'warning', 'POCKET_REMOVES_NOTHING') : okStatus(feature.id);
  return { status, shape, analysis, tool };
};
