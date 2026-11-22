import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { edgeRefFromPick } from '../../src/app/edges';
import { addFeature, findPart, makePlaneFeature } from '../../src/domain/document';
import type { CadDocument, DatumPlaneParams, EdgeRef } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import { featureDependencies } from '../../src/features/registry';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, topFrontEdge } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Plaque 60 × 30 × 5 percée d'un trou Ø 6 en (15, 15) ; arête du bord haut du trou. */
function plate() {
  const { doc, ids } = buildPlateDocument();
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const [res] = engine.evaluateDocument(doc);
  const mesh = engine.meshOf(res!, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
  const holeTop = mesh.edges.findIndex((e) => e.circle && Math.abs(e.circle.center.z - 5) < 1e-6);
  const r = edgeRefFromPick(mesh, holeTop, findPart(doc, ids.partId)!, null);
  if (r.kind !== 'ref') throw new Error('arête du trou introuvable');
  return { doc, ids, holeTop: r.ref as EdgeRef, front: topFrontEdge(doc, ids.sketch1, ids.extrude) };
}

/** Repère du plan obtenu avec ces réglages (et son état). */
function planeWith(doc: CadDocument, partId: string, params: Partial<DatumPlaneParams>) {
  const base = makePlaneFeature(doc, findPart(doc, partId)!);
  const feature = { ...base, params: { ...base.params, base: { kind: 'plane' as const, plane: 'XY' as const }, offset: 0, ...params } };
  const d = addFeature(doc, partId, feature);
  const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(d);
  return { status: res!.statuses.at(-1)!, frame: res!.datums.find((p) => p.featureId === feature.id)?.frame, feature, doc: d };
}

const parallel = (n: { x: number; y: number; z: number }, x: number, y: number, z: number) => Math.abs(n.x * x + n.y * y + n.z * z);

describe('plans de construction : autres façons de les construire', () => {
  it('au milieu de deux faces parallèles (dessus et dessous) : à mi-épaisseur', () => {
    const { doc, ids } = plate();
    const r = planeWith(doc, ids.partId, { mode: 'midplane', base: { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } }, second: { kind: 'face', ref: { featureId: ids.extrude, role: 'start' } } });
    expect(r.status.state).toBe('ok');
    expect(parallel(r.frame!.normal, 0, 0, 1)).toBeCloseTo(1, 6);
    expect(r.frame!.origin.z).toBeCloseTo(2.5, 6);
  });

  it('au milieu de deux plans sécants (XY et YZ) : le bissecteur, qui contient l’axe Y', () => {
    const { doc, ids } = plate();
    const r = planeWith(doc, ids.partId, { mode: 'midplane', base: { kind: 'plane', plane: 'XY' }, second: { kind: 'plane', plane: 'YZ' } });
    expect(r.status.state).toBe('ok');
    expect(parallel(r.frame!.normal, Math.SQRT1_2, 0, Math.SQRT1_2)).toBeCloseTo(1, 6);
    expect(parallel(r.frame!.normal, 0, 1, 0)).toBeCloseTo(0, 6);
  });

  it('par trois points (origine et les deux bouts de l’arête avant du dessus) : le plan de face y = 0', () => {
    const { doc, ids, front } = plate();
    const r = planeWith(doc, ids.partId, { mode: 'threePoints', points: [{ kind: 'origin' }, { kind: 'edge', edge: front, at: 'start' }, { kind: 'edge', edge: front, at: 'end' }] });
    expect(r.status.state).toBe('ok');
    expect(parallel(r.frame!.normal, 0, 1, 0)).toBeCloseTo(1, 6);
    expect(r.frame!.origin.y).toBeCloseTo(0, 6);
    // Points alignés : signalé.
    const bad = planeWith(doc, ids.partId, { mode: 'threePoints', points: [{ kind: 'edge', edge: front, at: 'start' }, { kind: 'edge', edge: front, at: 'mid' }, { kind: 'edge', edge: front, at: 'end' }] });
    expect(bad.status).toMatchObject({ state: 'error', code: 'INVALID_PARAMETER' });
    expect(bad.status.message).toMatch(/alignés/);
  });

  it('perpendiculaire à une arête, au milieu : normale le long de l’arête, au point (30, 0, 5)', () => {
    const { doc, ids, front } = plate();
    const r = planeWith(doc, ids.partId, { mode: 'normalToEdge', edge: front, along: 0.5 });
    expect(r.status.state).toBe('ok');
    expect(parallel(r.frame!.normal, 1, 0, 0)).toBeCloseTo(1, 6);
    // Le plan passe par le milieu de l'arête (30, 0, 5).
    const f = r.frame!;
    expect(f.normal.x * (30 - f.origin.x) + f.normal.y * (0 - f.origin.y) + f.normal.z * (5 - f.origin.z)).toBeCloseTo(0, 6);
  });

  it('tangent au trou (bord rond), à 0° puis 90° : touche le cylindre, contient son axe', () => {
    const { doc, ids, holeTop } = plate();
    const at0 = planeWith(doc, ids.partId, { mode: 'tangent', edge: holeTop, angle: 0 });
    expect(at0.status.state).toBe('ok');
    expect(parallel(at0.frame!.normal, 1, 0, 0)).toBeCloseTo(1, 6);
    expect(at0.frame!.origin.x).toBeCloseTo(18, 4);
    const at90 = planeWith(doc, ids.partId, { mode: 'tangent', edge: holeTop, angle: 90 });
    expect(parallel(at90.frame!.normal, 0, 1, 0)).toBeCloseTo(1, 6);
    expect(at90.frame!.origin.y).toBeCloseTo(18, 4);
    // Une arête droite ne convient pas.
    expect(planeWith(doc, ids.partId, { mode: 'tangent', edge: topFrontEdge(doc, ids.sketch1, ids.extrude), angle: 0 }).status.state).toBe('error');
  });

  it('parallèle à XY par le centre du trou (en haut) : à z = 5', () => {
    const { doc, ids, holeTop } = plate();
    const r = planeWith(doc, ids.partId, { mode: 'parallelPoint', base: { kind: 'plane', plane: 'XY' }, points: [{ kind: 'edge', edge: holeTop, at: 'center' }] });
    expect(r.status.state).toBe('ok');
    expect(parallel(r.frame!.normal, 0, 0, 1)).toBeCloseTo(1, 6);
    expect(r.frame!.origin.z).toBeCloseTo(5, 6);
  });

  it('par une arête et un point : l’arête avant du dessus et le centre du trou donnent le dessus', () => {
    const { doc, ids, front, holeTop } = plate();
    const r = planeWith(doc, ids.partId, { mode: 'edgePoint', edge: front, points: [{ kind: 'edge', edge: holeTop, at: 'center' }], offset: 2 });
    expect(r.status.state).toBe('ok');
    expect(parallel(r.frame!.normal, 0, 0, 1)).toBeCloseTo(1, 6);
    // Décalage de 2 mm le long de la normale, d'un côté ou de l'autre du dessus.
    expect(Math.abs(r.frame!.origin.z - 5)).toBeCloseTo(2, 6);
    // Dépendances : l'extrusion (arête) et la poche (trou).
    expect(featureDependencies(r.feature)).toEqual(expect.arrayContaining([ids.extrude, ids.pocket]));
    // Aller-retour du fichier et schéma.
    const text = serializeDocument(r.doc);
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc.parts[0]!.features.at(-1)).toEqual(r.feature);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
  });
});
