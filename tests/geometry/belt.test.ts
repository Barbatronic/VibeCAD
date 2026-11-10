import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeGearFeature } from '../../src/domain/document';
import { RecomputeEngine } from '../../src/features/engine';
import { beltSetup } from '../../src/features/gear/definition';
import { beltCenterDistance, beltLength, beltProfile, pitchRadius } from '../../src/features/gear/profiles';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

function beltDoc(teeth: number, teeth2: number, centerDistance: number, width = 6) {
  const doc = createDocument('Courroie');
  const part = findPart(doc, doc.parts[0]!.id)!;
  const f = makeGearFeature(doc, part, 'belt');
  return addFeature(doc, part.id, { ...f, params: { ...f.params, belt: 'GT2-2', teeth, teeth2, centerDistance, thickness: width } });
}

describe('courroie fermée entre deux poulies', () => {
  it('longueur : 2 × entraxe + un tour de poulie pour deux poulies égales', () => {
    const r = pitchRadius('GT2-2', 20);
    expect(beltLength(r, r, 100)).toBeCloseTo(200 + 20 * 2, 6);
  });

  it('entraxe exact pour un nombre entier de dents (GT2 200 dents = 400 mm)', () => {
    const c = beltCenterDistance('GT2-2', 20, 40, 200)!;
    expect(beltLength(pitchRadius('GT2-2', 20), pitchRadius('GT2-2', 40), c)).toBeCloseTo(400, 6);
  });

  it('un solide valide : aire de la bande × largeur, poulies 20 et 40 dents', () => {
    const ev = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(beltDoc(20, 40, 150))[0]!;
    expect(ev.failedFeatureId).toBeNull();
    expect(ev.analysis!.solidCount).toBe(1);
    expect(ev.analysis!.volume).toBeCloseTo(beltProfile('GT2-2', 20, 40, 150).area * 6, 0);
    // Encombrement : de la poulie 1 (centrée sur l'origine) à la poulie 2 (en x = 150).
    const b = ev.analysis!.bbox!;
    expect(b.max.x).toBeGreaterThan(150 + pitchRadius('GT2-2', 40));
    expect(b.min.x).toBeLessThan(-pitchRadius('GT2-2', 20));
  });

  it('des poulies qui se touchent sont refusées', () => {
    const ev = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(beltDoc(40, 40, 20))[0]!;
    expect(ev.failedFeatureId).not.toBeNull();
  });

  it('se sauvegarde et se rouvre ; un ancien fichier sans ces champs garde ses valeurs par défaut', () => {
    const doc = beltDoc(16, 36, 120);
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc.parts[0]!.features[0]).toEqual(doc.parts[0]!.features[0]);
    const p = { ...makeGearFeature(doc, doc.parts[0]!, 'pulley').params, teeth: 20 };
    expect(beltSetup(p).teeth2).toBe(20);
  });
});
