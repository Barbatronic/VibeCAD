import type { RevolveFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import { TOLERANCES } from '../../domain/tolerances';
import type { KernelShape } from '../../geometry/kernel';
import { frameToWorld, signedDistanceToFrame, worldToFrame } from '../../math/frame';
import { frameFromAxis, frameMatrix4, invertRigid4, multiply4, rotationZ4 } from '../../math/mat4';
import { cross2, dot3, normalize2, normalize3, sub2, sub3, type Vec2 } from '../../math/vec';
import { resolvePatternAxis } from '../pattern/evaluate';
import { findLine, pointPosition } from '../../sketch/model';
import { sampleBeziers, sampleEllipse } from '../../sketch/curves';
import type { ProfileRegion } from '../../sketch/profiles';
import type { FeatureEvaluator } from '../evaluation';
import { resolveProfile } from '../sketch/evaluate';
import { revolveDefinition } from './definition';

/** Points caractéristiques d'une région (sommets, extrêmes des cercles et des arcs). */
function regionPoints(region: ProfileRegion, axisDir: Vec2): Vec2[] {
  const n = { x: -axisDir.y, y: axisDir.x };
  const pts: Vec2[] = [];
  for (const loop of [region.outer, ...region.holes]) {
    for (const s of loop.segments) {
      if (s.kind === 'line') pts.push(s.start, s.end);
      else if (s.kind === 'circle') pts.push({ x: s.center.x + n.x * s.radius, y: s.center.y + n.y * s.radius }, { x: s.center.x - n.x * s.radius, y: s.center.y - n.y * s.radius });
      else if (s.kind === 'spline') pts.push(...sampleBeziers(s.beziers, 16));
      else if (s.kind === 'ellipse') pts.push(...sampleEllipse({ center: s.center, a: s.a, b: s.b, angle: s.angle }, 64));
      else {
        // Arc : extrémités et quelques points intermédiaires.
        const a0 = Math.atan2(s.start.y - s.center.y, s.start.x - s.center.x);
        const a1 = Math.atan2(s.end.y - s.center.y, s.end.x - s.center.x);
        let d = a1 - a0;
        if (s.clockwise) while (d > 0) d -= Math.PI * 2;
        else while (d < 0) d += Math.PI * 2;
        for (let i = 0; i <= 16; i++) pts.push({ x: s.center.x + s.radius * Math.cos(a0 + (d * i) / 16), y: s.center.y + s.radius * Math.sin(a0 + (d * i) / 16) });
      }
    }
  }
  return pts;
}

export const evaluateRevolve: FeatureEvaluator<RevolveFeature> = (feature, ctx) => {
  const paramIssues = revolveDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const resolved = resolveProfile(feature.id, feature.params.sketchId, ctx);
  if ('status' in resolved) return resolved;
  // Axe dans le repère de l'esquisse.
  let origin: Vec2 = { x: 0, y: 0 };
  let dir: Vec2 = feature.params.axis.kind === 'sketch-x' ? { x: 1, y: 0 } : { x: 0, y: 1 };
  let height = 0;
  const custom = feature.params.axis;
  if (custom.kind === 'axis') {
    // Axe du repère, de construction ou d'arête : parallèle au plan de l'esquisse, éventuellement écarté.
    const line = resolvePatternAxis(ctx.kernel, ctx.shape, custom.axis, ctx.axes);
    if ('error' in line) {
      const related = custom.axis.kind === 'edge' ? custom.axis.edge.faces[0].featureId : custom.axis.kind === 'datum' ? custom.axis.featureId : undefined;
      return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: 'L’axe de rotation choisi n’existe plus : choisissez-en un autre.', ...(related ? { relatedFeatureId: related } : {}) }) };
    }
    const f = resolved.frame;
    if (Math.abs(dot3(line.dir, f.normal)) > 1e-6) {
      return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: 'L’axe de rotation doit être parallèle au plan de l’esquisse.' }) };
    }
    origin = worldToFrame(f, line.point);
    dir = normalize2({ x: dot3(line.dir, f.xAxis), y: dot3(line.dir, f.yAxis) });
    height = signedDistanceToFrame(f, line.point);
  } else if (feature.params.axis.kind === 'line') {
    const sketch = ctx.sketches.get(feature.params.sketchId)?.evaluation.solved;
    const line = sketch && findLine(sketch, feature.params.axis.lineId);
    const a = line && pointPosition(sketch, line.a);
    const b = line && pointPosition(sketch, line.b);
    if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < TOLERANCES.linear) {
      return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: 'Le segment choisi comme axe n’existe plus dans l’esquisse : choisissez un autre axe.' }) };
    }
    origin = a;
    dir = normalize2(sub2(b, a));
  }
  // Le profil doit rester d'un seul côté de l'axe (il peut le toucher). Un axe écarté du plan ne
  // peut pas le traverser.
  const tol = TOLERANCES.linear * 10;
  const sides = resolved.regions.flatMap((r) => regionPoints(r, dir)).map((p) => cross2(dir, sub2(p, origin)));
  const max = Math.max(...sides);
  const min = Math.min(...sides);
  if (Math.abs(height) <= tol && ((max > tol && min < -tol) || (max <= tol && min >= -tol))) {
    return { status: issue(feature.id, 'error', 'REVOLVE_CROSSES_AXIS', { relatedFeatureId: feature.params.sketchId }) };
  }
  const angle = ((Math.min(feature.params.angle, 360) * Math.PI) / 180) * (feature.params.reversed ? -1 : 1);
  let tool = ctx.kernel.makeRevolution({ featureId: feature.id, regions: resolved.regions, frame: resolved.frame, axisOrigin: origin, axisDirection: dir, ...(Math.abs(height) > tol ? { axisHeight: height } : {}), angle });
  // Décalage de départ : le volume tourné est pivoté autour de l'axe (dans le sens de rotation), faces gardées.
  const start = (((feature.params.startAngle ?? 0) * Math.PI) / 180) * (feature.params.reversed ? -1 : 1);
  if (Math.abs(start) > 1e-12) {
    const f = resolved.frame;
    const p3 = frameToWorld(f, origin, height);
    const d3 = normalize3(sub3(frameToWorld(f, { x: origin.x + dir.x, y: origin.y + dir.y }, height), p3));
    const around = frameMatrix4(frameFromAxis(p3, d3));
    const turned = ctx.kernel.transformed(tool, multiply4(multiply4(around, rotationZ4(start)), invertRigid4(around)), { keep: true });
    ctx.kernel.dispose(tool);
    tool = turned;
  }
  const op = feature.params.operation;
  // Creuser ou garder la partie commune demande une pièce déjà en volume.
  if (op !== 'add' && (!ctx.shape || !ctx.shapeAnalysis)) {
    ctx.kernel.dispose(tool);
    return { status: issue(feature.id, 'error', 'POCKET_WITHOUT_SOLID') };
  }
  let shape: KernelShape = tool;
  if (ctx.shape) {
    try {
      shape = op === 'cut' ? ctx.kernel.cut(ctx.shape, tool) : op === 'common' ? ctx.kernel.common(ctx.shape, tool) : ctx.kernel.fuse(ctx.shape, tool);
    } catch (err) {
      ctx.kernel.dispose(tool);
      throw err;
    }
  }
  const analysis = ctx.kernel.analyze(shape);
  if (op !== 'add' && analysis.solidCount === 0) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', op === 'cut' ? 'POCKET_REMOVES_EVERYTHING' : 'COMMON_EMPTY'), tool };
  }
  if (!analysis.valid || analysis.solidCount === 0) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID'), tool };
  }
  const before = ctx.shapeAnalysis?.volume ?? 0;
  const tiny = Math.max(1e-9, before * 1e-9);
  let status = okStatus(feature.id);
  if (op === 'cut' && before - analysis.volume <= tiny) status = issue(feature.id, 'warning', 'POCKET_REMOVES_NOTHING');
  else if (op === 'add' && ctx.shapeAnalysis && analysis.solidCount > ctx.shapeAnalysis.solidCount) status = issue(feature.id, 'warning', 'DISJOINT_SOLID');
  return { status, shape, analysis, tool, ...(op === 'common' ? {} : { toolMode: op === 'cut' ? ('cut' as const) : ('add' as const) }) };
};
