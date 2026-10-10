import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeRevolveFeature, makeSketchFeature, updateFeature } from '../../src/domain/document';
import type { CadDocument, Id, RevolveFeature, SketchParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addConstraint, addRectangle, emptySketch } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

/** Rectangle de 10 × 20 entre x = 10 et x = 20 (un anneau une fois tourné autour de l'axe Y). */
function ringProfile(): { sketch: SketchParams; width: string } {
  const r = addRectangle(emptySketch(XY), { x: 10, y: 0 }, { x: 20, y: 20 });
  const w = addConstraint(r.sketch, { type: 'length', line: r.lines[0], value: 10 });
  return { sketch: solveSketch(w.sketch).sketch, width: w.id };
}

function revolveDoc(angle = 360): { doc: CadDocument; partId: Id; sketchId: Id; revolveId: Id; width: string } {
  let doc = createDocument('Révolution');
  const part = doc.parts[0]!;
  const sk = makeSketchFeature(doc, part, XY);
  const { sketch, width } = ringProfile();
  doc = addFeature(doc, part.id, { ...sk, params: { ...sketch, support: XY } });
  const rev = makeRevolveFeature(doc, findPart(doc, part.id)!, sk.id, { kind: 'sketch-y' }, angle);
  doc = addFeature(doc, part.id, rev);
  return { doc, partId: part.id, sketchId: sk.id, revolveId: rev.id, width };
}

const ringVolume = (angleDeg: number, outer = 20) => Math.PI * (outer * outer - 100) * 20 * (angleDeg / 360);

describe('révolution', () => {
  it('tour complet et révolution partielle : solides valides aux volumes exacts', () => {
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const full = revolveDoc(360);
    const [res] = engine.evaluateDocument(full.doc);
    expect(res!.statuses.map((s) => s.state)).toEqual(['ok', 'ok']);
    expect(res!.analysis!.valid).toBe(true);
    expect(res!.analysis!.volume).toBeCloseTo(ringVolume(360), 3);
    expect(res!.analysis!.bbox!.max.x).toBeCloseTo(20, 6);
    expect(res!.analysis!.bbox!.min.z).toBeCloseTo(-20, 6);

    const quarter = revolveDoc(90);
    const [q] = engine.evaluateDocument(quarter.doc);
    expect(q!.analysis!.valid).toBe(true);
    expect(q!.analysis!.volume).toBeCloseTo(ringVolume(90), 3);
    // Sens inverse : même volume, de l'autre côté.
    const flipped = updateFeature<RevolveFeature>(quarter.doc, quarter.revolveId, (f) => ({ ...f, params: { ...f.params, reversed: true } }));
    const [qf] = engine.evaluateDocument(flipped);
    expect(qf!.analysis!.volume).toBeCloseTo(ringVolume(90), 3);
    expect(Math.sign(qf!.analysis!.bbox!.max.z + qf!.analysis!.bbox!.min.z)).toBe(-Math.sign(q!.analysis!.bbox!.max.z + q!.analysis!.bbox!.min.z));
  });

  it('suit une cote modifiée et se relit dans le format natif', () => {
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const { doc, sketchId, width } = revolveDoc(360);
    const wider = updateFeature(doc, sketchId, (f) =>
      f.type === 'sketch' ? { ...f, params: solveSketch({ ...f.params, constraints: f.params.constraints.map((c) => (c.id === width ? { ...c, value: 15 } : c)) }).sketch } : f,
    );
    const [res] = engine.evaluateDocument(wider);
    expect(res!.analysis!.bbox!.max.x).toBeGreaterThan(20);
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok && parsed.doc).toEqual(doc);
  });

  it('refuse un profil qui traverse l’axe, avec une explication', () => {
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const { doc, revolveId } = revolveDoc(360);
    const crossing = updateFeature<RevolveFeature>(doc, revolveId, (f) => ({ ...f, params: { ...f.params, axis: { kind: 'sketch-x' } } }));
    // Le rectangle touche l'axe X (y = 0) sans le traverser : accepté.
    expect(engine.evaluateDocument(crossing)[0]!.statuses[1]!.state).toBe('ok');
    const moved = updateFeature(doc, doc.parts[0]!.features[0]!.id, (f) =>
      f.type === 'sketch' ? { ...f, params: { ...f.params, entities: f.params.entities.map((e) => (e.type === 'point' ? { ...e, x: e.x - 15 } : e)), constraints: [] } } : f,
    );
    const [res] = engine.evaluateDocument(moved);
    expect(res!.statuses[1]).toMatchObject({ state: 'error', code: 'REVOLVE_CROSSES_AXIS' });
  });
});
