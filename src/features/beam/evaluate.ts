import type { BeamFeature } from '../../domain/model';
import { issue } from '../../domain/status';
import type { GeometryKernel, KernelShape } from '../../geometry/kernel';
import type { Frame3D } from '../../math/frame';
import type { FeatureEvaluator } from '../evaluation';
import { combineVolume } from '../volume-tool';
import { beamDefinition } from './definition';
import { beamProfile } from './profiles';

/** Repère de la section : normale = axe du profilé (repère direct). */
const AXES: Record<BeamFeature['params']['axis'], Pick<Frame3D, 'xAxis' | 'yAxis' | 'normal'>> = {
  X: { xAxis: { x: 0, y: 1, z: 0 }, yAxis: { x: 0, y: 0, z: 1 }, normal: { x: 1, y: 0, z: 0 } },
  Y: { xAxis: { x: 0, y: 0, z: 1 }, yAxis: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
  Z: { xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } },
};

/** Profilé seul : sa section extrudée de sa longueur, depuis le centre de sa face de départ. */
export function beamShape(kernel: GeometryKernel, feature: BeamFeature): KernelShape {
  const p = feature.params;
  const frame: Frame3D = { origin: p.position, ...AXES[p.axis] };
  return kernel.makePrism({ featureId: feature.id, regions: [beamProfile(p.system, p.size)], frame, from: 0, to: p.length });
}

export const evaluateBeam: FeatureEvaluator<BeamFeature> = (feature, ctx) => {
  const paramIssues = beamDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  return combineVolume(feature.id, feature.params.operation, ctx, () => beamShape(ctx.kernel, feature));
};
