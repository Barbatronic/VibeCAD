/**
 * Code commun aux congés et chanfreins : dépendances, validation et évaluation. Les arêtes sont
 * désignées par des références persistantes (paire de faces), résolues à chaque recalcul.
 */
import type { ChamferFeature, EdgeRef, FilletFeature, Id } from '../domain/model';
import { issue, okStatus } from '../domain/status';
import { formatLength } from '../domain/units';
import type { ParamIssue } from './definition';
import type { EvaluationContext, FeatureOutcome } from './evaluation';
import { validateDistance } from './extrude/definition';

export function edgeDependencies(edges: readonly EdgeRef[]): Id[] {
  return Array.from(new Set(edges.flatMap((e) => e.faces.map((f) => f.featureId))));
}

export function validateBlend(edges: readonly EdgeRef[], size: number, label: string): ParamIssue[] {
  const issues: ParamIssue[] = [];
  const d = validateDistance(size, label);
  if (d) issues.push({ field: 'size', message: d });
  if (edges.length === 0) issues.push({ field: 'edges', message: 'Choisissez au moins une arête : cliquez-la dans la vue 3D.' });
  return issues;
}

export function blendSummary(edges: readonly EdgeRef[], size: number, prefix: string): string {
  return `${prefix} ${formatLength(size)} — ${edges.length} arête${edges.length > 1 ? 's' : ''}`;
}

export function evaluateBlend(feature: FilletFeature | ChamferFeature, ctx: EvaluationContext): FeatureOutcome {
  const kind = feature.type;
  const size = feature.type === 'fillet' ? feature.params.radius : feature.params.distance;
  if (!ctx.shape) {
    return {
      status: issue(feature.id, 'error', 'INVALID_PARAMETER', {
        message: 'Il faut d’abord un volume pour arrondir ou chanfreiner ses arêtes.',
      }),
    };
  }
  if (feature.params.edges.length === 0) return { status: issue(feature.id, 'error', 'EDGES_EMPTY') };
  const sizeError = validateDistance(size, kind === 'fillet' ? 'Le rayon' : 'La longueur');
  if (sizeError) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: sizeError }) };
  const result = ctx.kernel.blend(ctx.shape, { featureId: feature.id, kind, edges: feature.params.edges, size });
  if (result.status === 'edges-lost') {
    return {
      status: issue(feature.id, 'error', 'EDGE_LOST', {
        detail: `Arête(s) introuvable(s) : n° ${result.missing.map((i) => i + 1).join(', ')}.`,
      }),
    };
  }
  if (result.status === 'failed') return { status: issue(feature.id, 'error', 'BLEND_FAILED', { detail: result.detail }) };
  const analysis = ctx.kernel.analyze(result.shape);
  if (!analysis.valid || analysis.solidCount === 0) {
    ctx.kernel.dispose(result.shape);
    return { status: issue(feature.id, 'error', 'BLEND_FAILED', { detail: 'Le solide obtenu n’est pas valide.' }) };
  }
  return { status: okStatus(feature.id), shape: result.shape, analysis };
}
