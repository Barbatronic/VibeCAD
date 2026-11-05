import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makePocketFeature, makeSketchFeature } from '../../src/domain/document';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { addText } from '../../src/sketch/model';
import { extractProfiles, profileArea } from '../../src/sketch/profiles';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

const noResources = { get: () => undefined };

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

describe('texte d’esquisse dans le noyau', () => {
  it('extrude des lettres en relief : volume = aire des lettres × épaisseur', () => {
    let doc = createDocument('Lettres');
    const partId = doc.parts[0]!.id;
    const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
    const params = addText(sk.params, { x: 0, y: 0 }, 'Léa 8', 12).sketch;
    doc = addFeature(doc, partId, { ...sk, params });
    doc = addFeature(doc, partId, makeExtrudeFeature(doc, findPart(doc, partId)!, sk.id, 3));
    const [part] = new RecomputeEngine(kernel, noResources).evaluateDocument(doc);
    expect(part!.statuses.map((s) => s.state)).toEqual(['ok', 'ok']);
    const a = part!.analysis!;
    expect(a.valid).toBe(true);
    // L, é (lettre + accent), a, 8 : un solide par contour extérieur.
    expect(a.solidCount).toBe(5);
    const area = profileArea(extractProfiles(params));
    expect(Math.abs(a.volume - area * 3) / (area * 3)).toBeLessThan(1e-4);
    // Les lettres rondes descendent un peu sous la ligne de base (dépassement typographique).
    expect(a.bbox!.min.y).toBeLessThan(0);
    expect(a.bbox!.min.y).toBeGreaterThan(-0.3);
  });

  it('grave un texte dans la plaque avec une poche', () => {
    let { doc, ids } = buildPlateDocument();
    const part0 = findPart(doc, ids.partId)!;
    const sk = makeSketchFeature(doc, part0, { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } });
    const params = addText(sk.params, { x: 25, y: 10 }, 'Bob', 8).sketch;
    doc = addFeature(doc, ids.partId, { ...sk, params });
    doc = addFeature(doc, ids.partId, makePocketFeature(doc, findPart(doc, ids.partId)!, sk.id, { kind: 'distance', distance: 1 }, 'default'));
    const [part] = new RecomputeEngine(kernel, noResources).evaluateDocument(doc);
    expect(part!.statuses.every((s) => s.state === 'ok')).toBe(true);
    const a = part!.analysis!;
    expect(a.valid).toBe(true);
    expect(a.solidCount).toBe(1);
    const engraved = profileArea(extractProfiles(params));
    const plate = 60 * 30 * 5 - Math.PI * 9 * 5;
    expect(Math.abs(a.volume - (plate - engraved)) / plate).toBeLessThan(1e-4);
  });
});
