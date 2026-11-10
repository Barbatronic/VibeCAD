import type { GearFeature } from '../../domain/model';
import { issue } from '../../domain/status';
import type { GeometryKernel, KernelShape } from '../../geometry/kernel';
import type { Frame3D } from '../../math/frame';
import type { ProfileRegion } from '../../sketch/profiles';
import type { FeatureEvaluator } from '../evaluation';
import { combineVolume } from '../volume-tool';
import { beltSetup, gearDefinition } from './definition';
import { beltProfile, pulleyOutsideDiameter, pulleyProfile, rackProfile, spurGearProfile } from './profiles';

/** Joue de poulie : disque percé, 1,5 mm plus large que la poulie de chaque côté. */
function flangeRegion(radius: number, bore: number): ProfileRegion {
  const outer = { segments: [{ kind: 'circle' as const, entityId: 'flange', center: { x: 0, y: 0 }, radius, clockwise: false }], signedArea: Math.PI * radius * radius };
  const holes = bore > 0 ? [{ segments: [{ kind: 'circle' as const, entityId: 'bore', center: { x: 0, y: 0 }, radius: bore / 2, clockwise: true }], signedArea: -Math.PI * (bore / 2) ** 2 }] : [];
  return { outer, holes, area: outer.signedArea + holes.reduce((s, h) => s + h.signedArea, 0) };
}

/** Volume généré (roue, crémaillère, poulie avec ses joues, ou courroie fermée). */
export function gearShape(kernel: GeometryKernel, feature: GearFeature): KernelShape {
  const p = feature.params;
  const frame: Frame3D = { origin: p.position, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
  const belt = p.kind === 'belt' ? beltSetup(p) : null;
  const region =
    p.kind === 'spur'
      ? spurGearProfile(p.module, p.teeth, p.pressureAngle, p.bore)
      : p.kind === 'rack'
        ? rackProfile(p.module, p.teeth, p.pressureAngle, p.rackHeight)
        : belt
          ? beltProfile(p.belt, p.teeth, belt.teeth2, belt.centerDistance)
          : pulleyProfile(p.belt, p.teeth, p.bore);
  const body = kernel.makePrism({ featureId: feature.id, regions: [region], frame, from: 0, to: p.thickness });
  if (p.kind !== 'pulley' || !p.flanges) return body;
  const radius = pulleyOutsideDiameter(p.belt, p.teeth) / 2 + 1.5;
  const flanges = [kernel.makePrism({ featureId: feature.id, regions: [flangeRegion(radius, p.bore)], frame, from: -1, to: 0 }), kernel.makePrism({ featureId: feature.id, regions: [flangeRegion(radius, p.bore)], frame, from: p.thickness, to: p.thickness + 1 })];
  try {
    return kernel.fuseMany(body, flanges);
  } finally {
    kernel.dispose(body);
    for (const f of flanges) kernel.dispose(f);
  }
}

export const evaluateGear: FeatureEvaluator<GearFeature> = (feature, ctx) => {
  const paramIssues = gearDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  return combineVolume(feature.id, feature.params.operation, ctx, () => gearShape(ctx.kernel, feature));
};
