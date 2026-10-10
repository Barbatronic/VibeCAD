import { beforeAll, describe, expect, it } from 'vitest';
import { updateFeature } from '../../src/domain/document';
import type { SketchFeature } from '../../src/domain/model';
import { TOLERANCES } from '../../src/domain/tolerances';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, setDimension } from '../helpers/plate';

const HOLE = Math.PI * 3 * 3 * 5;
const noResources = { get: () => undefined };

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

function expectVolume(actual: number, expected: number) {
  expect(Math.abs(actual - expected) / expected).toBeLessThan(TOLERANCES.volumeRelative);
}

describe('plaque percée (critère d’acceptation)', () => {
  it('construit une plaque 60 × 30 × 5 percée Ø 6 et vérifie volume, boîte et validité', () => {
    const { doc } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, noResources);
    const [part] = engine.evaluateDocument(doc);
    expect(part!.statuses.map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(part!.failedFeatureId).toBeNull();
    const a = part!.analysis!;
    expect(a.valid).toBe(true);
    expect(a.solidCount).toBe(1);
    expectVolume(a.volume, 60 * 30 * 5 - HOLE);
    expect(a.bbox!.min.x).toBeCloseTo(0, 6);
    expect(a.bbox!.min.z).toBeCloseTo(0, 6);
    expect(a.bbox!.max.x).toBeCloseTo(60, 6);
    expect(a.bbox!.max.y).toBeCloseTo(30, 6);
    expect(a.bbox!.max.z).toBeCloseTo(5, 6);
  });

  it('place l’esquisse du trou sur la face supérieure avec un repère canonique', () => {
    const { doc, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, noResources);
    const [part] = engine.evaluateDocument(doc);
    const sk2 = part!.sketches.find((s) => s.featureId === ids.sketch2)!;
    expect(sk2.frame!.origin).toEqual({ x: 0, y: 0, z: 5 });
    expect(sk2.frame!.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(sk2.frame!.xAxis).toEqual({ x: 1, y: 0, z: 0 });
    expect(sk2.dof).toBe(0);
  });

  it('passe la largeur à 80 mm : la pièce suit et le trou reste coté depuis l’origine', () => {
    const { doc, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, noResources);
    engine.evaluateDocument(doc);
    const wider = setDimension(doc, ids.sketch1, ids.widthConstraint, 80);
    const [part] = engine.evaluateDocument(wider);
    expect(part!.statuses.every((s) => s.state === 'ok')).toBe(true);
    expectVolume(part!.analysis!.volume, 80 * 30 * 5 - HOLE);
    expect(part!.analysis!.bbox!.max.x).toBeCloseTo(80, 6);
    const mesh = engine.meshOf(part!, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    const holes = mesh.faces.filter((f) => f.surface === 'cylinder');
    expect(holes).toHaveLength(1);
    expect(holes[0]!.cylinder!.radius).toBeCloseTo(3, 9);
    expect(holes[0]!.cylinder!.origin.x).toBeCloseTo(15, 9);
    expect(holes[0]!.cylinder!.origin.y).toBeCloseTo(15, 9);
    // La face du trou est étiquetée par la poche et le cercle de l'esquisse.
    expect(holes[0]!.tags).toContainEqual(expect.objectContaining({ featureId: ids.pocket, role: 'side' }));
  });

  it('étiquette les faces avec des références sémantiques persistantes', () => {
    const { doc, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, noResources);
    const [part] = engine.evaluateDocument(doc);
    const mesh = engine.meshOf(part!, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    expect(mesh.faces).toHaveLength(7);
    const top = mesh.faces.find((f) => f.tags.some((t) => t.featureId === ids.extrude && t.role === 'end'))!;
    expect(top.surface).toBe('plane');
    expect(top.plane!.normal.z).toBeCloseTo(1, 12);
    const bottom = mesh.faces.find((f) => f.tags.some((t) => t.featureId === ids.extrude && t.role === 'start'))!;
    expect(bottom.plane!.normal.z).toBeCloseTo(-1, 12);
    const sides = mesh.faces.filter((f) => f.tags.some((t) => t.featureId === ids.extrude && t.role === 'side'));
    expect(sides).toHaveLength(4);
    expect(new Set(sides.map((f) => f.tags[0]!.entityId)).size).toBe(4);
    for (const f of mesh.faces) expect(f.tags.length).toBeGreaterThan(0);
  });

  it('reprend les étapes inchangées du cache et donne le même résultat sans cache', () => {
    const { doc, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, noResources);
    engine.evaluateDocument(doc);
    const t0 = performance.now();
    const [again] = engine.evaluateDocument(doc);
    const cachedMs = performance.now() - t0;
    expect(cachedMs).toBeLessThan(50);
    const fresh = new RecomputeEngine(kernel, noResources);
    const [ref] = fresh.evaluateDocument(doc);
    expect(again!.analysis!.volume).toBeCloseTo(ref!.analysis!.volume, 9);
    // Une modification de la poche ne recalcule pas l'extrusion.
    const deeper = updateFeature(doc, ids.pocket, (f) => (f.type === 'pocket' ? { ...f, params: { ...f.params, extent: { kind: 'distance', distance: 2 } } } : f));
    const before = engine.cacheSize();
    const [partial] = engine.evaluateDocument(deeper);
    expect(engine.cacheSize()).toBe(before + 1);
    expect(partial!.analysis!.volume).toBeCloseTo(9000 - Math.PI * 9 * 2, 6);
    fresh.clear();
  });

  it('perce aussi depuis le plan XY en poche symétrique traversante', () => {
    const { doc } = buildPlateDocument({ holeOnFace: false });
    const engine = new RecomputeEngine(kernel, noResources);
    const [part] = engine.evaluateDocument(doc);
    expect(part!.statuses.every((s) => s.state === 'ok')).toBe(true);
    expectVolume(part!.analysis!.volume, 9000 - HOLE);
  });

  it('signale un contour ouvert et bloque les étapes suivantes, sans perdre le dernier solide', () => {
    const { doc, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, noResources);
    // Supprime une coïncidence du rectangle et déplace un sommet : le contour est ouvert.
    const broken = updateFeature<SketchFeature>(doc, ids.sketch1, (f) => {
      const coincident = f.params.constraints.find((c) => c.type === 'coincident' && c.a !== 'origin')!;
      const constraints = f.params.constraints.filter((c) => c.id !== coincident.id);
      const moved = coincident.type === 'coincident' ? coincident.b : '';
      const entities = f.params.entities.map((e) => (e.id === moved && e.type === 'point' ? { ...e, x: e.x + 3, y: e.y + 4 } : e));
      return { ...f, params: { ...f.params, constraints, entities } };
    });
    const [part] = engine.evaluateDocument(broken);
    const [s1, ex, s2, po] = part!.statuses;
    expect(s1!.state).toBe('ok');
    expect(ex!.state).toBe('error');
    expect(ex!.code).toBe('PROFILE_OPEN');
    expect(ex!.message).toMatch(/n’est pas fermé/);
    expect(ex!.highlightPoints).toHaveLength(2);
    expect(ex!.relatedFeatureId).toBe(ids.sketch1);
    expect(s2!.state).toBe('blocked');
    expect(po!.state).toBe('blocked');
    expect(po!.blockedBy).toBe(ids.extrude);
    expect(part!.failedFeatureId).toBe(ids.extrude);
    expect(part!.shape).toBeNull();
  });

  it('signale une référence de face perdue de façon récupérable', () => {
    const { doc, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, noResources);
    const lost = updateFeature<SketchFeature>(doc, ids.sketch2, (f) => ({
      ...f,
      params: { ...f.params, support: { kind: 'face', ref: { featureId: ids.extrude, role: 'side', entityId: 'l99' } } },
    }));
    const [part] = engine.evaluateDocument(lost);
    const s2 = part!.statuses[2]!;
    expect(s2.state).toBe('error');
    expect(s2.code).toBe('SUPPORT_LOST');
    expect(part!.statuses[3]!.state).toBe('blocked');
    expect(part!.statuses[3]!.code).toBe('SKETCH_FAILED');
    // Le solide valide avant l'erreur reste disponible (plaque sans trou).
    expectVolume(part!.analysis!.volume, 9000);
    // Réparation : on repose l'esquisse sur la face supérieure.
    const repaired = updateFeature<SketchFeature>(lost, ids.sketch2, (f) => ({
      ...f,
      params: { ...f.params, support: { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } } },
    }));
    const [fixed] = engine.evaluateDocument(repaired);
    expect(fixed!.statuses.every((s) => s.state === 'ok')).toBe(true);
  });
});
