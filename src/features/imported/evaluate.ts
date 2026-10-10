import type { ImportedSolidFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { FeatureEvaluator } from '../evaluation';
import { importedSolidDefinition } from './definition';

export const evaluateImportedSolid: FeatureEvaluator<ImportedSolidFeature> = (feature, ctx) => {
  const paramIssues = importedSolidDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const read = ctx.readStepSolids(feature.params.resourceId);
  if ('error' in read) return { status: issue(feature.id, 'error', read.error, read.detail ? { detail: read.detail } : {}) };
  const solid = read.solids[feature.params.solidIndex];
  if (!solid) {
    return { status: issue(feature.id, 'error', 'IMPORT_FAILED', { detail: `Solide n° ${feature.params.solidIndex + 1} absent du fichier.` }) };
  }
  const tool = ctx.kernel.tagImported(solid, feature.id);
  let shape = tool;
  if (ctx.shape) {
    try {
      shape = ctx.kernel.fuse(ctx.shape, tool);
    } catch (err) {
      ctx.kernel.dispose(tool);
      throw err;
    }
  }
  const analysis = ctx.kernel.analyze(shape);
  if (analysis.solidCount === 0) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'IMPORT_FAILED'), tool };
  }
  let status = okStatus(feature.id);
  if (!analysis.valid) {
    status = issue(feature.id, 'warning', 'INVALID_SOLID', {
      message: "Le solide importé présente des défauts géométriques : les opérations suivantes pourraient échouer.",
    });
  } else if (ctx.shapeAnalysis && analysis.solidCount > ctx.shapeAnalysis.solidCount) {
    status = issue(feature.id, 'warning', 'DISJOINT_SOLID');
  }
  return { status, shape, analysis, tool };
};
