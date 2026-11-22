import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeAxisFeature, makePlaneFeature } from '../../src/domain/document';
import { ORIGIN_POINT_ID, type AxisFeature, type CadDocument, type DatumPlaneParams, type SketchFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import { featureDependencies } from '../../src/features/registry';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { pointPosition } from '../../src/sketch/model';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;
const sketchOf = (doc: CadDocument, id: string) => doc.parts[0]!.features.find((f): f is SketchFeature => f.id === id)!;
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const parallel = (n: { x: number; y: number; z: number }, x: number, y: number, z: number) => Math.abs(n.x * x + n.y * y + n.z * z);

/** Plaque 60 × 30 × 5 (esquisse 1 : rectangle sur XY) percée d'un trou Ø 6 en (15, 15) (esquisse 2 sur le dessus). */
function plate() {
  const { doc, ids } = buildPlateDocument();
  const rect = sketchOf(doc, ids.sketch1);
  const line = rect.params.entities.find((e) => e.type === 'line')!;
  if (line.type !== 'line') throw new Error();
  const [a, b] = [pointPosition(rect.params, line.a)!, pointPosition(rect.params, line.b)!];
  const circle = sketchOf(doc, ids.sketch2).params.entities.find((e) => e.type === 'circle')!;
  const point = rect.params.entities.filter((e) => e.type === 'point' && e.id !== ORIGIN_POINT_ID);
  return { doc, ids, line: { id: line.id, a, b }, circleId: circle.id, points: point.map((p) => p.id) };
}

function axisWith(doc: CadDocument, partId: string, params: Partial<AxisFeature['params']>) {
  const base = makeAxisFeature(doc, findPart(doc, partId)!);
  const feature: AxisFeature = { ...base, params: { ...base.params, ...params } };
  const d = addFeature(doc, partId, feature);
  const res = evaluate(d);
  return { status: res.statuses.at(-1)!, axis: res.axes.find((x) => x.featureId === feature.id), feature, doc: d };
}

function planeWith(doc: CadDocument, partId: string, params: Partial<DatumPlaneParams>) {
  const base = makePlaneFeature(doc, findPart(doc, partId)!);
  const feature = { ...base, params: { ...base.params, base: { kind: 'plane' as const, plane: 'XY' as const }, offset: 0, ...params } };
  const d = addFeature(doc, partId, feature);
  const res = evaluate(d);
  return { status: res.statuses.at(-1)!, frame: res.datums.find((p) => p.featureId === feature.id)?.frame, feature, doc: d };
}

describe('axes de construction repris d’une esquisse', () => {
  it('segment : la droite du segment ; suit l’esquisse, dépend d’elle', () => {
    const { doc, ids, line } = plate();
    const r = axisWith(doc, ids.partId, { kind: 'sketch', sketch: { sketchId: ids.sketch1, entityId: line.id } });
    expect(r.status.state).toBe('ok');
    const d = { x: line.b.x - line.a.x, y: line.b.y - line.a.y, z: 0 };
    const len = Math.hypot(d.x, d.y);
    expect(parallel(r.axis!.dir, d.x / len, d.y / len, 0)).toBeCloseTo(1, 6);
    expect(dist(r.axis!.point, { x: line.a.x, y: line.a.y, z: 0 })).toBeCloseTo(0, 6);
    expect(featureDependencies(r.feature)).toEqual([ids.sketch1]);
  });

  it('cercle : axe perpendiculaire à l’esquisse, par le centre (le trou, sur le dessus)', () => {
    const { doc, ids, circleId } = plate();
    const r = axisWith(doc, ids.partId, { kind: 'sketch', sketch: { sketchId: ids.sketch2, entityId: circleId } });
    expect(r.status.state).toBe('ok');
    expect(parallel(r.axis!.dir, 0, 0, 1)).toBeCloseTo(1, 6);
    expect(r.axis!.point.z).toBeCloseTo(5, 6);
    expect(Math.hypot(r.axis!.point.x - 15, r.axis!.point.y - 15)).toBeCloseTo(0, 6);
  });

  it('élément supprimé : erreur qui désigne l’esquisse', () => {
    const { doc, ids } = plate();
    const r = axisWith(doc, ids.partId, { kind: 'sketch', sketch: { sketchId: ids.sketch1, entityId: 'absent' } });
    expect(r.status.state).toBe('error');
    expect(r.status.message).toBeTruthy();
    expect(axisWith(doc, ids.partId, { kind: 'sketch', sketch: { sketchId: 'disparue', entityId: 'x' } }).status.state).toBe('error');
  });
});

describe('plans de construction repris d’une esquisse', () => {
  it('par une ligne d’esquisse : contient le segment, perpendiculaire à l’esquisse', () => {
    const { doc, ids, line } = plate();
    const r = planeWith(doc, ids.partId, { mode: 'sketchLine', sketchElement: { sketchId: ids.sketch1, entityId: line.id } });
    expect(r.status.state).toBe('ok');
    const f = r.frame!;
    expect(parallel(f.normal, 0, 0, 1)).toBeCloseTo(0, 6);
    for (const p of [line.a, line.b]) expect(f.normal.x * (p.x - f.origin.x) + f.normal.y * (p.y - f.origin.y) + f.normal.z * (0 - f.origin.z)).toBeCloseTo(0, 6);
    expect(featureDependencies(r.feature)).toEqual([ids.sketch1]);
  });

  it('par trois points d’esquisse (coins du rectangle) : le plan XY', () => {
    const { doc, ids, points } = plate();
    const r = planeWith(doc, ids.partId, { mode: 'threePoints', points: [points[0]!, points[1]!, points[3]!].map((entityId) => ({ kind: 'sketch' as const, sketchId: ids.sketch1, entityId })) });
    expect(r.status.state, r.status.message).toBe('ok');
    expect(parallel(r.frame!.normal, 0, 0, 1)).toBeCloseTo(1, 6);
    expect(r.frame!.origin.z).toBeCloseTo(0, 6);
  });

  it('parallèle à XY par le centre du cercle d’esquisse : à z = 5', () => {
    const { doc, ids, circleId } = plate();
    const r = planeWith(doc, ids.partId, { mode: 'parallelPoint', points: [{ kind: 'sketch', sketchId: ids.sketch2, entityId: circleId }] });
    expect(r.status.state).toBe('ok');
    expect(r.frame!.origin.z).toBeCloseTo(5, 6);
  });

  it('tangent au cercle d’esquisse, à 0° : x = 18 ; perpendiculaire au segment, au milieu', () => {
    const { doc, ids, circleId, line } = plate();
    const t = planeWith(doc, ids.partId, { mode: 'tangent', sketchElement: { sketchId: ids.sketch2, entityId: circleId }, angle: 0 });
    expect(t.status.state).toBe('ok');
    expect(parallel(t.frame!.normal, 1, 0, 0)).toBeCloseTo(1, 6);
    expect(t.frame!.origin.x).toBeCloseTo(18, 6);
    const n = planeWith(doc, ids.partId, { mode: 'normalToEdge', sketchElement: { sketchId: ids.sketch1, entityId: line.id }, along: 0.5 });
    expect(n.status.state).toBe('ok');
    const mid = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2, z: 0 };
    const f = n.frame!;
    expect(f.normal.x * (mid.x - f.origin.x) + f.normal.y * (mid.y - f.origin.y) + f.normal.z * (mid.z - f.origin.z)).toBeCloseTo(0, 6);
  });

  it('aller-retour du fichier et schéma (plan et axe)', () => {
    const { doc, ids, line, points } = plate();
    const p = planeWith(doc, ids.partId, { mode: 'edgePoint', sketchElement: { sketchId: ids.sketch1, entityId: line.id }, points: [{ kind: 'sketch', sketchId: ids.sketch1, entityId: points[2]! }] });
    const a = axisWith(p.doc, ids.partId, { kind: 'sketch', sketch: { sketchId: ids.sketch2, entityId: 'c' } });
    const text = serializeDocument(a.doc);
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc.parts[0]!.features.slice(-2)).toEqual([p.feature, a.feature]);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
  });
});
