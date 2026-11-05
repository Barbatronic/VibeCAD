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
import { importSvgShape } from '../../src/io/svg-import';
import { otsuThreshold, traceBitmap } from '../../src/io/trace-bitmap';
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

  it.each(['fill', 'lines'] as const)('un dessin à la main vectorisé (%s) donne un solide valide', (mode) => {
    // Fleur au trait tremblé et d'épaisseur variable, comme un feutre tenu à la main.
    const size = 400;
    const data = new Uint8Array(size * size).fill(230);
    const dot = (cx: number, cy: number, r: number) => {
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r) data[y * size + x] = 30;
      }
    };
    for (let t = 0; t < Math.PI * 2; t += 0.002) {
      const r = 120 + 40 * Math.cos(7 * t) + 2.5 * Math.sin(t * 13) + 1.2 * Math.sin(t * 37);
      dot(200 + r * Math.cos(t), 200 + r * Math.sin(t), 3 + 0.6 * Math.sin(t * 5));
    }
    const image = { width: size, height: size, data };
    const r = importSvgShape(traceBitmap(image, { threshold: otsuThreshold(image), invert: false, mode, thicken: 0, despeckle: 20, smoothing: 0.4 }), 'dessin');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = extruded((s) => addStamp(s, { x: 0, y: 0 }, r.shape, 60).sketch, 3);
    const area = profileArea(extractProfiles(doc.parts[0]!.features[0]!.params as SketchParams));
    expect(evaluate(doc).volume).toBeCloseTo(area * 3, -1);
  }, 60000);
});
