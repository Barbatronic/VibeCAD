/**
 * Volume généré (engrenage, profilé…) ajouté à la pièce, creusé dedans ou gardé en commun avec
 * elle, avec les mêmes contrôles (solide valide, rien d'enlevé, morceau détaché…).
 */
import type { VolumeOperation } from '../domain/model';
import { issue, okStatus } from '../domain/status';
import type { KernelShape } from '../geometry/kernel';
import type { EvaluationContext, FeatureOutcome } from './evaluation';

export function combineVolume(featureId: string, operation: VolumeOperation, ctx: EvaluationContext, makeTool: () => KernelShape): FeatureOutcome {
  if (operation !== 'add' && !ctx.shape) return { status: issue(featureId, 'error', 'POCKET_WITHOUT_SOLID') };
  const tool = makeTool();
  let shape: KernelShape = tool;
  if (ctx.shape) {
    try {
      shape = operation === 'cut' ? ctx.kernel.cut(ctx.shape, tool) : operation === 'common' ? ctx.kernel.common(ctx.shape, tool) : ctx.kernel.fuse(ctx.shape, tool);
    } catch (err) {
      ctx.kernel.dispose(tool);
      throw err;
    }
  }
  const analysis = ctx.kernel.analyze(shape);
  if (operation === 'common' && analysis.solidCount === 0) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(featureId, 'error', 'COMMON_EMPTY'), tool };
  }
  if (!analysis.valid || (operation === 'add' && analysis.solidCount === 0)) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(featureId, 'error', 'INVALID_SOLID'), tool };
  }
  const before = ctx.shapeAnalysis?.volume ?? 0;
  const tiny = Math.max(1e-9, before * 1e-9);
  if (operation === 'cut' && (analysis.solidCount === 0 || analysis.volume <= tiny)) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(featureId, 'error', 'POCKET_REMOVES_EVERYTHING'), tool };
  }
  let status = okStatus(featureId);
  if (operation === 'cut' && before - analysis.volume <= tiny) status = issue(featureId, 'warning', 'POCKET_REMOVES_NOTHING');
  else if (operation === 'add' && ctx.shapeAnalysis && analysis.solidCount > ctx.shapeAnalysis.solidCount) status = issue(featureId, 'warning', 'DISJOINT_SOLID');
  return { status, shape, analysis, tool, ...(operation === 'common' ? {} : { toolMode: operation === 'cut' ? ('cut' as const) : ('add' as const) }) };
}
