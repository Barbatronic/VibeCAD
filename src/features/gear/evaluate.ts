import type { GearFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { GeometryKernel, KernelShape } from '../../geometry/kernel';
import type { Frame3D } from '../../math/frame';
import type { ProfileRegion } from '../../sketch/profiles';
import type { FeatureEvaluator } from '../evaluation';
import { gearDefinition } from './definition';
import { pulleyOutsideDiameter, pulleyProfile, rackProfile, spurGearProfile } from './profiles';

/** Joue de poulie : disque percé, 1,5 mm plus large que la poulie de chaque côté. */
function flangeRegion(radius: number, bore: number): ProfileRegion {
  const outer = { segments: [{ kind: 'circle' as const, entityId: 'flange', center: { x: 0, y: 0 }, radius, clockwise: false }], signedArea: Math.PI * radius * radius };
  const holes = bore > 0 ? [{ segments: [{ kind: 'circle' as const, entityId: 'bore', center: { x: 0, y: 0 }, radius: bore / 2, clockwise: true }], signedArea: -Math.PI * (bore / 2) ** 2 }] : [];
  return { outer, holes, area: outer.signedArea + holes.reduce((s, h) => s + h.signedArea, 0) };
}

/** Volume généré (roue, crémaillère ou poulie avec ses joues). */
export function gearShape(kernel: GeometryKernel, feature: GearFeature): KernelShape {
  const p = feature.params;
  const frame: Frame3D = { origin: p.position, xAxis: { x: 1, y: 0, z: 0 }, yAxis: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
  const region = p.kind === 'spur' ? spurGearProfile(p.module, p.teeth, p.pressureAngle, p.bore) : p.kind === 'rack' ? rackProfile(p.module, p.teeth, p.pressureAngle, p.rackHeight) : pulleyProfile(p.belt, p.teeth, p.bore);
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
  const p = feature.params;
  if (p.operation !== 'add' && !ctx.shape) return { status: issue(feature.id, 'error', 'POCKET_WITHOUT_SOLID') };
  const tool = gearShape(ctx.kernel, feature);
  let shape: KernelShape = tool;
  if (ctx.shape) {
    try {
      shape = p.operation === 'cut' ? ctx.kernel.cut(ctx.shape, tool) : p.operation === 'common' ? ctx.kernel.common(ctx.shape, tool) : ctx.kernel.fuse(ctx.shape, tool);
    } catch (err) {
      ctx.kernel.dispose(tool);
      throw err;
    }
  }
  const analysis = ctx.kernel.analyze(shape);
  if (p.operation === 'common' && analysis.solidCount === 0) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'COMMON_EMPTY'), tool };
  }
  if (!analysis.valid || (p.operation === 'add' && analysis.solidCount === 0)) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID'), tool };
  }
  const before = ctx.shapeAnalysis?.volume ?? 0;
  const tiny = Math.max(1e-9, before * 1e-9);
  if (p.operation === 'cut' && (analysis.solidCount === 0 || analysis.volume <= tiny)) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'POCKET_REMOVES_EVERYTHING'), tool };
  }
  let status = okStatus(feature.id);
  if (p.operation === 'cut' && before - analysis.volume <= tiny) status = issue(feature.id, 'warning', 'POCKET_REMOVES_NOTHING');
  else if (p.operation === 'add' && ctx.shapeAnalysis && analysis.solidCount > ctx.shapeAnalysis.solidCount) status = issue(feature.id, 'warning', 'DISJOINT_SOLID');
  return { status, shape, analysis, tool, ...(p.operation === 'common' ? {} : { toolMode: p.operation === 'cut' ? ('cut' as const) : ('add' as const) }) };
};
