/**
 * Code commun aux congés et chanfreins : dépendances, validation et évaluation. Les arêtes sont
 * désignées par des références persistantes (paire de faces), résolues à chaque recalcul.
 */
import type { ChamferFeature, ChamferParams, EdgeRef, FilletFeature, Id } from '../domain/model';
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

/** Réglages d'un chanfrein dissymétrique pour le noyau (rien s'il est symétrique), ou l'erreur. */
export function chamferShape(p: ChamferParams): { size2?: number; angle?: number; flip?: boolean } | { error: string } {
  const flip = p.flip ? { flip: true } : {};
  if (p.mode === 'twoDistances') {
    const err = validateDistance(p.distance2 ?? 0, 'La seconde longueur');
    return err ? { error: err } : { size2: p.distance2!, ...flip };
  }
  if (p.mode === 'distanceAngle') {
    const err = validateChamferAngle(p.angle ?? 0);
    return err ? { error: err } : { angle: p.angle!, ...flip };
  }
  return {};
}

export function validateChamferAngle(angle: number): string | null {
  if (!Number.isFinite(angle)) return 'L’angle doit être un nombre de degrés.';
  if (angle <= 0 || angle >= 90) return 'L’angle doit être compris entre 0 et 90° (45° : chanfrein symétrique).';
  return null;
}

/** Résumé d'un chanfrein : « 2 mm », « 2 × 3 mm » ou « 2 mm × 30° ». */
export function chamferSizeText(p: ChamferParams): string {
  if (p.mode === 'twoDistances') return `${formatLength(p.distance, 3, false)} × ${formatLength(p.distance2 ?? 0)}`;
  if (p.mode === 'distanceAngle') return `${formatLength(p.distance)} × ${String(p.angle ?? 45).replace('.', ',')}°`;
  return formatLength(p.distance);
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
  const asym = feature.type === 'chamfer' ? chamferShape(feature.params) : {};
  if ('error' in asym) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: asym.error }) };
  const result = ctx.kernel.blend(ctx.shape, { featureId: feature.id, kind, edges: feature.params.edges, size, ...asym });
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
