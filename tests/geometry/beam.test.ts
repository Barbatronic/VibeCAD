import { beforeAll, describe, expect, it } from 'vitest';
import { createDocument, findPart, addFeature, makeBeamFeature } from '../../src/domain/document';
import type { BeamSize } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import { beamModules, beamProfile, BEAM_BORE } from '../../src/features/beam/profiles';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

function beam(size: BeamSize, system: 'vslot' | 'tslot', length: number, axis: 'X' | 'Y' | 'Z' = 'Z') {
  const doc = createDocument('Profilé');
  const part = findPart(doc, doc.parts[0]!.id)!;
  const f = makeBeamFeature(doc, part);
  const next = addFeature(doc, part.id, { ...f, params: { ...f.params, size, system, length, axis } });
  return new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(next)[0]!;
}

describe('profilé aluminium série 20', () => {
  it.each(['2020', '2040', '2060', '2080', '4040', '4080'] as BeamSize[])('section %s : un solide valide, volume = aire × longueur', (size) => {
    for (const system of ['vslot', 'tslot'] as const) {
      const ev = beam(size, system, 100);
      expect(ev.failedFeatureId).toBeNull();
      expect(ev.analysis!.solidCount).toBe(1);
      const area = beamProfile(system, size).area;
      expect(ev.analysis!.volume).toBeCloseTo(area * 100, 0);
      // Rainures et alésages : moins de matière que la section pleine (2020 réel : ≈ 160 mm²).
      const { cols, rows } = beamModules(size);
      const full = cols * rows * 400;
      expect(area).toBeLessThan(full - cols * rows * Math.PI * (BEAM_BORE / 2) ** 2);
      expect(area).toBeGreaterThan(full * 0.35);
    }
  });

  it('encombrement : 20 × 40 × longueur, le long de l’axe choisi', () => {
    const ev = beam('2040', 'vslot', 250, 'X');
    const b = ev.analysis!.bbox!;
    expect(b.max.x - b.min.x).toBeCloseTo(250, 3);
    expect(b.max.y - b.min.y).toBeCloseTo(20, 3);
    expect(b.max.z - b.min.z).toBeCloseTo(40, 3);
  });

  it('se sauvegarde et se rouvre à l’identique', () => {
    const doc = createDocument('Profilé');
    const part = findPart(doc, doc.parts[0]!.id)!;
    const f = makeBeamFeature(doc, part);
    const saved = addFeature(doc, part.id, { ...f, params: { ...f.params, size: '4080', system: 'tslot', axis: 'Y', length: 420 } });
    const parsed = parseNativeFile(serializeDocument(saved));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc.parts[0]!.features[0]).toEqual(saved.parts[0]!.features[0]);
  });
});
