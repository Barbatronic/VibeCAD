import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeChamferFeature, makeFilletFeature, updateFeature } from '../../src/domain/document';
import type { SketchFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { removeEntities } from '../../src/sketch/model';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, cornerEdge, setDimension, topFrontEdge } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const PLATE = 9000 - Math.PI * 9 * 5;

describe('congés et chanfreins', () => {
  it('arrondit l’arête supérieure avant : volume exact retiré', () => {
    const { doc: base, ids } = buildPlateDocument();
    const part = findPart(base, ids.partId)!;
    const fillet = makeFilletFeature(base, part, [topFrontEdge(base, ids.sketch1, ids.extrude)], 2);
    const doc = addFeature(base, ids.partId, fillet);
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const [res] = engine.evaluateDocument(doc);
    expect(res!.statuses.map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    const removed = 60 * (4 - Math.PI);
    expect(res!.analysis!.volume).toBeCloseTo(PLATE - removed, 4);
    expect(res!.analysis!.valid).toBe(true);
    // Les faces arrondies sont étiquetées par le congé.
    const mesh = engine.meshOf(res!, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    const blendFaces = mesh.faces.filter((f) => f.tags.some((t) => t.featureId === fillet.id && t.role === 'blend'));
    expect(blendFaces.length).toBeGreaterThan(0);
    expect(blendFaces[0]!.surface).toBe('cylinder');
    // Chaque arête du maillage connaît ses faces voisines.
    expect(mesh.edges.filter((e) => e.faces.length === 2).length).toBeGreaterThan(10);
  });

  it('chanfreine une arête verticale : volume exact, conservé quand la plaque s’élargit', () => {
    const { doc: base, ids } = buildPlateDocument();
    const part = findPart(base, ids.partId)!;
    const chamfer = makeChamferFeature(base, part, [cornerEdge(base, ids.sketch1, ids.extrude)], 3);
    const doc = addFeature(base, ids.partId, chamfer);
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const [res] = engine.evaluateDocument(doc);
    expect(res!.statuses.every((s) => s.state === 'ok')).toBe(true);
    expect(res!.analysis!.volume).toBeCloseTo(PLATE - 5 * (3 * 3) / 2, 4);
    // La largeur passe à 80 : la référence d'arête (faces droite + haut) reste valable.
    const wider = setDimension(doc, ids.sketch1, ids.widthConstraint, 80);
    const [res2] = engine.evaluateDocument(wider);
    expect(res2!.statuses.every((s) => s.state === 'ok')).toBe(true);
    expect(res2!.analysis!.volume).toBeCloseTo(12000 - Math.PI * 45 - 22.5, 4);
    expect(res2!.analysis!.bbox!.max.x).toBeCloseTo(80, 6);
  });

  it('signale une arête disparue et indique une valeur trop grande', () => {
    const { doc: base, ids } = buildPlateDocument();
    const part = findPart(base, ids.partId)!;
    const fillet = makeFilletFeature(base, part, [cornerEdge(base, ids.sketch1, ids.extrude)], 1);
    let doc = addFeature(base, ids.partId, fillet);
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    // Rayon plus grand que la plaque : le congé est impossible.
    const tooBig = updateFeature(doc, fillet.id, (f) => (f.type === 'fillet' ? { ...f, params: { ...f.params, radius: 40 } } : f));
    const [big] = engine.evaluateDocument(tooBig);
    expect(big!.statuses[4]!.state).toBe('error');
    expect(big!.statuses[4]!.code).toBe('BLEND_FAILED');
    // Référence vers deux faces qui ne se touchent pas (dessus et dessous) : arête introuvable.
    const apart = updateFeature(doc, fillet.id, (f) =>
      f.type === 'fillet' ? { ...f, params: { ...f.params, edges: [{ faces: [{ featureId: ids.extrude, role: 'start' }, { featureId: ids.extrude, role: 'end' }] }] } } : f,
    );
    const [missing] = engine.evaluateDocument(apart);
    expect(missing!.statuses[4]!.state).toBe('error');
    expect(missing!.statuses[4]!.code).toBe('EDGE_LOST');
    // Suppression du segment droit de l'esquisse : l'arête n'existe plus.
    doc = updateFeature<SketchFeature>(doc, ids.sketch1, (f) => {
      const lines = f.params.entities.filter((e) => e.type === 'line').map((e) => e.id);
      return { ...f, params: removeEntities(f.params, [lines[1]!]) };
    });
    const [lost] = engine.evaluateDocument(doc);
    expect(lost!.statuses[1]!.code).toBe('PROFILE_OPEN');
    expect(lost!.statuses[4]!.state).toBe('blocked');
  });

  it('enregistre et relit congés et chanfreins dans le format natif', () => {
    const { doc: base, ids } = buildPlateDocument();
    const part = findPart(base, ids.partId)!;
    let doc = addFeature(base, ids.partId, makeFilletFeature(base, part, [topFrontEdge(base, ids.sketch1, ids.extrude)], 1.5));
    doc = addFeature(doc, ids.partId, makeChamferFeature(doc, findPart(doc, ids.partId)!, [cornerEdge(doc, ids.sketch1, ids.extrude)], 2));
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc).toEqual(doc);
    const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(parsed.doc);
    expect(res!.statuses.every((s) => s.state === 'ok')).toBe(true);
  });
});
