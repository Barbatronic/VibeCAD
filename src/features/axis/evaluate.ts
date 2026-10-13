import type { AxisFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { FeatureEvaluator } from '../evaluation';
import { resolvePatternAxis } from '../pattern/evaluate';
import { axisDefinition } from './definition';

const WORLD = { X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 }, Z: { x: 0, y: 0, z: 1 } } as const;

export const evaluateAxis: FeatureEvaluator<AxisFeature> = (feature, ctx) => {
  const paramIssues = axisDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const p = feature.params;
  if (p.kind === 'line') return { status: okStatus(feature.id), datumAxis: { point: { ...p.position }, dir: WORLD[p.direction] } };
  const line = resolvePatternAxis(ctx.kernel, ctx.shape, { kind: 'edge', edge: p.edge! });
  if ('error' in line) return { status: issue(feature.id, 'error', 'AXIS_EDGE_LOST', { relatedFeatureId: p.edge!.faces[0].featureId }) };
  return { status: okStatus(feature.id), datumAxis: line };
};
