/**
 * Tampons : chaque forme de la galerie donne un vrai solide, au volume attendu, y compris après
 * un aller-retour par le format natif.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, SketchParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addRectangle, addStamp } from '../../src/sketch/model';
import { extractProfiles, profileArea } from '../../src/sketch/profiles';
import { solveSketch } from '../../src/sketch/solver';
import { stampGallery } from '../../src/stamps';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

function extruded(draw: (s: SketchParams) => SketchParams, depth: number): CadDocument {
  let doc = createDocument('Tampon');
  const partId = doc.parts[0]!.id;
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
  doc = addFeature(doc, partId, { ...sk, params: solveSketch(draw(sk.params)).sketch });
  return addFeature(doc, partId, makeExtrudeFeature(doc, findPart(doc, partId)!, sk.id, depth));
}

const evaluate = (doc: CadDocument) => {
  const res = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;
  expect(res.statuses.at(-1)!.state).toBe('ok');
  return res.analysis!;
};

describe('tampons extrudés', () => {
  it.each(stampGallery().map((s) => [s.name, s] as const))('%s donne un solide au bon volume', async (_name, shape) => {
    const doc = extruded((s) => addStamp(s, { x: 0, y: 0 }, shape, 30).sketch, 4);
    const area = profileArea(extractProfiles(doc.parts[0]!.features[0]!.params as SketchParams));
    expect(evaluate(doc).volume).toBeCloseTo(area * 4, -1);
  }, 60000);

  it('un tampon troue une plaque, et survit à l’enregistrement', async () => {
    const heart = stampGallery().find((s) => s.name === 'Cœur')!;
    const doc = extruded((s) => addStamp(addRectangle(s, { x: -30, y: -30 }, { x: 30, y: 30 }).sketch, { x: 0, y: 0 }, heart, 30, 45).sketch, 5);
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const volume = evaluate(doc).volume;
    expect(evaluate(parsed.doc).volume).toBeCloseTo(volume, 6);
    expect(volume).toBeLessThan(60 * 60 * 5);
  }, 60000);
});
