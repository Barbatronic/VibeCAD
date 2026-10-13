import type { MoveFeature } from '../../domain/model';
import { issue, okStatus, type FeatureStatus } from '../../domain/status';
import { multiply4, translation4, type Mat4 } from '../../math/mat4';
import type { FeatureEvaluator } from '../evaluation';
import { isIdentityMove, moveDefinition } from './definition';

/** Matrice du déplacement : rotation autour de l'axe passant par le centre, puis décalage. */
export function moveMatrix(p: MoveFeature['params']): Mat4 {
  const a = (p.angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Matrices 4 × 4 par colonnes.
  const rotation: Mat4 =
    p.axis === 'X'
      ? [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
      : p.axis === 'Y'
        ? [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
        : [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const around = multiply4(translation4(p.center), multiply4(rotation, translation4({ x: -p.center.x, y: -p.center.y, z: -p.center.z })));
  return multiply4(translation4(p.translation), around);
}

export const evaluateMove: FeatureEvaluator<MoveFeature> = (feature, ctx) => {
  const paramIssues = moveDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis) return { status: issue(feature.id, 'error', 'MOVE_WITHOUT_SOLID') };
  const p = feature.params;
  if (isIdentityMove(p)) return { status: issue(feature.id, 'warning', 'MOVE_NOTHING'), shape: ctx.kernel.transformed(ctx.shape, moveMatrix(p), { keep: true }), analysis: ctx.shapeAnalysis };
  const kernel = ctx.kernel;
  const matrix = moveMatrix(p);
  let shape;
  if (p.copy) {
    // Copie déplacée ajoutée à la pièce ; ses faces sont étiquetées au nom de cette étape.
    const copy = kernel.transformed(ctx.shape, matrix, { featureId: feature.id, whole: true });
    try {
      shape = kernel.fuse(ctx.shape, copy);
    } finally {
      kernel.dispose(copy);
    }
  } else {
    // La pièce elle-même se déplace : ses faces gardent leurs références (congés, esquisses…).
    shape = kernel.transformed(ctx.shape, matrix, { keep: true });
  }
  const analysis = kernel.analyze(shape);
  if (!analysis.valid || analysis.solidCount === 0) {
    kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID') };
  }
  let status: FeatureStatus = okStatus(feature.id);
  if (p.copy && analysis.solidCount > ctx.shapeAnalysis.solidCount) status = issue(feature.id, 'warning', 'DISJOINT_SOLID');
  return { status, shape, analysis };
};
