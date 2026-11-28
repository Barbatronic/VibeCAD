import type { ServoFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { GeometryKernel, KernelShape } from '../../geometry/kernel';
import { canonicalFrame, type Frame3D } from '../../math/frame';
import { cross3, dot3, normalize3, scale3, sub3, type Vec2, type Vec3 } from '../../math/vec';
import type { ProfileRegion, ProfileSegment } from '../../sketch/profiles';
import type { EvaluationContext, FeatureEvaluator } from '../evaluation';
import { placeSketchElement } from '../sketch/elements';
import { servoDefinition } from './definition';

/**
 * Empreinte en étoile : `teeth` pointes vers l'extérieur (Ø `tip`, où entrent les dents de l'axe)
 * alternées avec autant de pointes vers l'intérieur (Ø `root`). Pointes vives : l'impression les
 * arrondit d'elle-même, ce qui donne le serrage.
 */
export function splineOutline(teeth: number, tip: number, root: number): Vec2[] {
  const out: Vec2[] = [];
  const step = (2 * Math.PI) / teeth;
  for (let k = 0; k < teeth; k++) {
    const a = k * step;
    out.push({ x: (tip / 2) * Math.cos(a), y: (tip / 2) * Math.sin(a) });
    out.push({ x: (root / 2) * Math.cos(a + step / 2), y: (root / 2) * Math.sin(a + step / 2) });
  }
  return out;
}

function polygonRegion(points: Vec2[], tag: string): ProfileRegion {
  const segments: ProfileSegment[] = points.map((start, i) => ({ kind: 'line', entityId: `${tag}:${i}`, start, end: points[(i + 1) % points.length]! }));
  let area = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  });
  return { outer: { segments, signedArea: area / 2 }, holes: [], area: Math.abs(area / 2) };
}

function circleRegion(radius: number, tag: string): ProfileRegion {
  const area = Math.PI * radius * radius;
  return { outer: { segments: [{ kind: 'circle', entityId: tag, center: { x: 0, y: 0 }, radius, clockwise: false }], signedArea: area }, holes: [], area };
}

/** Centre de l'entrée, direction vers l'intérieur de la matière et repère de l'empreinte. */
type Placement = { center: Vec3; into: Vec3; xAxis?: Vec3 };

/**
 * Bord rond : son centre et son axe. La cannelure entre dans la matière, à l'opposé de la normale
 * extérieure de la face plane que borde l'arête (dessus d'un bossage, face autour d'un trou).
 */
function edgePlacement(kernel: GeometryKernel, shape: KernelShape, p: ServoFeature['params']): Placement | 'lost' | 'not-round' {
  const t = p.target;
  if (t?.kind !== 'edge') return 'lost';
  const c = kernel.edgeCurves(shape, t.edge)[0];
  if (!c) return 'lost';
  if (c.kind !== 'circle') return 'not-round';
  const axis = normalize3(c.axis);
  let into = scale3(axis, -1);
  for (const face of t.edge.faces) {
    const found = kernel.findFacePlane(shape, face);
    if (found.status === 'found' && Math.abs(dot3(found.normal, axis)) > 0.999) {
      into = scale3(found.normal, -1);
      break;
    }
  }
  const start = c.start ?? c.samples?.[0];
  const radial = start ? sub3(start, c.center) : null;
  return { center: c.center, into, ...(radial && Math.hypot(radial.x, radial.y, radial.z) > 1e-6 ? { xAxis: normalize3(radial) } : {}) };
}

/** Point ou centre de cercle d'esquisse : entre dans la matière contre la normale de l'esquisse (comme une poche). */
function sketchPlacement(ctx: Pick<EvaluationContext, 'sketches'>, p: ServoFeature['params']): Placement | 'lost' {
  const t = p.target;
  if (t?.kind !== 'sketch') return 'lost';
  const el = placeSketchElement(t, ctx);
  if (!el || el.kind === 'line') return 'lost';
  return { center: el.kind === 'circle' ? el.center : el.point, into: scale3(el.frame.normal, -1), xAxis: el.frame.xAxis };
}

/** Repère de l'outil : origine au centre de l'entrée, normale vers la matière. */
function toolFrame(place: Placement, reversed: boolean): Frame3D {
  const normal = reversed ? scale3(place.into, -1) : place.into;
  const base = canonicalFrame(place.center, normal);
  const x0 = place.xAxis && Math.abs(dot3(place.xAxis, normal)) < 1e-6 ? place.xAxis : base.xAxis;
  const xAxis = normalize3(sub3(x0, scale3(normal, dot3(x0, normal))));
  return { origin: place.center, xAxis, yAxis: cross3(normal, xAxis), normal };
}

/** Volume retiré : l'empreinte cannelée sur `depth`, et le trou de vis jusqu'au bout de la pièce. */
export function servoTool(kernel: GeometryKernel, feature: ServoFeature, frame: Frame3D, through: number): KernelShape {
  const p = feature.params;
  const spline = kernel.makePrism({ featureId: feature.id, regions: [polygonRegion(splineOutline(p.teeth, p.tipDiameter, p.rootDiameter), 'spline')], frame, from: 0, to: p.depth });
  if (!(p.screwDiameter > 0) || through <= p.depth) return spline;
  let screw: KernelShape;
  try {
    screw = kernel.makePrism({ featureId: feature.id, regions: [circleRegion(p.screwDiameter / 2, 'screw')], frame, from: 0, to: through });
  } catch (err) {
    kernel.dispose(spline);
    throw err;
  }
  try {
    return kernel.fuse(spline, screw);
  } finally {
    kernel.dispose(spline);
    kernel.dispose(screw);
  }
}

export const evaluateServo: FeatureEvaluator<ServoFeature> = (feature, ctx) => {
  const paramIssues = servoDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis?.bbox) return { status: issue(feature.id, 'error', 'SERVO_WITHOUT_SOLID') };
  const p = feature.params;
  const target = p.target!;
  const place = target.kind === 'edge' ? edgePlacement(ctx.kernel, ctx.shape, p) : sketchPlacement(ctx, p);
  if (place === 'not-round') return { status: issue(feature.id, 'error', 'SERVO_NOT_ROUND', { relatedFeatureId: target.kind === 'edge' ? target.edge.faces[0].featureId : target.sketchId }) };
  if (place === 'lost') return { status: issue(feature.id, 'error', 'SERVO_TARGET_LOST', { relatedFeatureId: target.kind === 'edge' ? target.edge.faces[0].featureId : target.sketchId }) };
  const frame = toolFrame(place, p.reversed);
  // Trou de vis : jusqu'au coin de la pièce le plus éloigné dans la direction de la cannelure.
  const { min, max } = ctx.shapeAnalysis.bbox;
  let through = 0;
  for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) through = Math.max(through, dot3(sub3({ x, y, z }, frame.origin), frame.normal));
  through += 1;
  const kernel = ctx.kernel;
  const tool = servoTool(kernel, feature, frame, through);
  let shape: KernelShape;
  try {
    shape = kernel.cut(ctx.shape, tool);
  } catch (err) {
    kernel.dispose(tool);
    throw err;
  }
  const analysis = kernel.analyze(shape);
  const before = ctx.shapeAnalysis.volume;
  const tiny = Math.max(1e-9, before * 1e-9);
  if (analysis.solidCount === 0 || analysis.volume <= tiny) {
    kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'POCKET_REMOVES_EVERYTHING'), tool };
  }
  if (!analysis.valid) {
    kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID'), tool };
  }
  const status = before - analysis.volume <= tiny ? issue(feature.id, 'warning', 'SERVO_REMOVES_NOTHING') : okStatus(feature.id);
  return { status, shape, analysis, tool, toolMode: 'cut' };
};
