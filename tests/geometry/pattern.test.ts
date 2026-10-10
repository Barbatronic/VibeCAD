import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makePatternFeature, makePocketFeature, makeSketchFeature, updateFeature } from '../../src/domain/document';
import { ORIGIN_POINT_ID, type CadDocument, type Id, type PatternFeature, type PatternParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addCircle, addConstraint } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, topFrontEdge } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const HOLE = Math.PI * 9 * 5;
const PLATE = 60 * 30 * 5;

function withPattern(doc: CadDocument, partId: Id, sourceId: Id, params: Partial<PatternParams>): { doc: CadDocument; patternId: Id } {
  const base = makePatternFeature(doc, findPart(doc, partId)!, sourceId);
  const feature: PatternFeature = { ...base, params: { ...base.params, ...params } };
  return { doc: addFeature(doc, partId, feature), patternId: feature.id };
}

function evaluate(doc: CadDocument) {
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const [res] = engine.evaluateDocument(doc);
  return { res: res!, engine };
}

describe('répétition', () => {
  it('linéaire : trois trous espacés de 15 mm le long de X', () => {
    const { doc, ids } = buildPlateDocument();
    const { doc: d2 } = withPattern(doc, ids.partId, ids.pocket, { count: 3, spacing: 15 });
    const { res } = evaluate(d2);
    expect(res.statuses.map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo(PLATE - 3 * HOLE, 3);
  });

  it('grille 3 × 2 : six trous', () => {
    const { doc, ids } = buildPlateDocument();
    const { doc: d2 } = withPattern(doc, ids.partId, ids.pocket, { count: 3, spacing: 15, second: { axis: { kind: 'axis', axis: 'Y' }, count: 2, spacing: 10, reversed: false } });
    const { res } = evaluate(d2);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(PLATE - 6 * HOLE, 3);
  });

  it('le long d’une arête droite de la pièce (sens stable vers +X)', () => {
    const { doc, ids } = buildPlateDocument();
    const edge = topFrontEdge(doc, ids.sketch1, ids.extrude);
    const { doc: d2 } = withPattern(doc, ids.partId, ids.pocket, { count: 3, spacing: 15, axis: { kind: 'edge', edge } });
    const { res } = evaluate(d2);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(PLATE - 3 * HOLE, 3);
  });

  it('exemplaires hors de la pièce : avertissement, le solide reste valide', () => {
    const { doc, ids } = buildPlateDocument();
    const { doc: d2 } = withPattern(doc, ids.partId, ids.pocket, { count: 3, spacing: 15, reversed: true });
    const { res } = evaluate(d2);
    // Vers −X : la copie en x = 0 coupe un demi-trou dans le bord, celle en x = −15 tombe dehors.
    expect(res.statuses.at(-1)).toMatchObject({ state: 'warning', code: 'PATTERN_COPIES_OUTSIDE' });
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo(PLATE - 1.5 * HOLE, 3);
  });

  it('circulaire : six trous répartis sur un disque, puis trois sur 120°', () => {
    let doc = createDocument('Disque');
    const partId = doc.parts[0]!.id;
    const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
    const disc = addCircle(sk.params, { x: 0.5, y: 0.2 }, 25);
    let s = addConstraint(disc.sketch, { type: 'coincident', a: ORIGIN_POINT_ID, b: disc.center }).sketch;
    s = addConstraint(s, { type: 'diameter', circle: disc.circleId, value: 60 }).sketch;
    doc = addFeature(doc, partId, { ...sk, params: solveSketch(s).sketch });
    const ex = makeExtrudeFeature(doc, findPart(doc, partId)!, sk.id, 5);
    doc = addFeature(doc, partId, ex);
    const sk2 = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
    const hole = addCircle(sk2.params, { x: 20, y: 1 }, 2);
    let h = addConstraint(hole.sketch, { type: 'diameter', circle: hole.circleId, value: 6 }).sketch;
    h = addConstraint(h, { type: 'distanceX', a: ORIGIN_POINT_ID, b: hole.center, value: 20 }).sketch;
    h = addConstraint(h, { type: 'distanceY', a: ORIGIN_POINT_ID, b: hole.center, value: 0 }).sketch;
    doc = addFeature(doc, partId, { ...sk2, params: solveSketch(h).sketch });
    const po = makePocketFeature(doc, findPart(doc, partId)!, sk2.id, { kind: 'throughAll' }, 'symmetric');
    doc = addFeature(doc, partId, po);
    const { doc: d2, patternId } = withPattern(doc, partId, po.id, { kind: 'circular', axis: { kind: 'axis', axis: 'Z' }, count: 6, angle: 360 });
    const discVolume = Math.PI * 900 * 5;
    const { res } = evaluate(d2);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(discVolume - 6 * HOLE, 2);
    // Angle partiel : le premier et le dernier exemplaire séparés de 120° (3 trous).
    const d3 = updateFeature<PatternFeature>(d2, patternId, (f) => ({ ...f, params: { ...f.params, count: 3, angle: 120 } }));
    expect(evaluate(d3).res.analysis!.volume).toBeCloseTo(discVolume - 3 * HOLE, 2);
  });

  it('répète un volume ajouté et étiquette les faces des copies', () => {
    const { doc, ids } = buildPlateDocument();
    // Un plot Ø 6 × 5 mm sur le dessus, à la place du trou.
    const part = findPart(doc, ids.partId)!;
    const sketch = part.features.find((f) => f.id === ids.sketch2)!;
    const boss = makeExtrudeFeature(doc, part, ids.sketch2, 5);
    let d = addFeature(doc, ids.partId, { ...sketch, id: 'sk-boss', name: 'Plot' } as typeof sketch);
    d = addFeature(d, ids.partId, { ...boss, params: { ...boss.params, sketchId: 'sk-boss' } });
    const bossId = boss.id;
    const { doc: d2, patternId } = withPattern(d, ids.partId, bossId, { count: 2, spacing: 20 });
    const { res, engine } = evaluate(d2);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    const before = evaluate(d).res.analysis!.volume;
    expect(res.analysis!.volume - before).toBeCloseTo(HOLE, 3);
    const mesh = engine.meshOf(res, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    const copyTop = mesh.faces.filter((f) => f.tags.some((t) => t.featureId === patternId && t.role === 'end' && t.index === 1));
    expect(copyTop).toHaveLength(1);
    expect(copyTop[0]!.plane!.origin.z).toBeCloseTo(10, 6);
  });

  it('étape à répéter absente ou placée après : erreur expliquée', () => {
    const { doc, ids } = buildPlateDocument();
    const { doc: d2 } = withPattern(doc, ids.partId, 'introuvable', {});
    expect(evaluate(d2).res.statuses.at(-1)).toMatchObject({ state: 'error', code: 'PATTERN_SOURCE_MISSING' });
  });

  it('aller-retour du format natif', () => {
    const { doc, ids } = buildPlateDocument();
    const edge = topFrontEdge(doc, ids.sketch1, ids.extrude);
    const { doc: d2 } = withPattern(doc, ids.partId, ids.pocket, { count: 3, spacing: 15, axis: { kind: 'edge', edge }, second: { axis: { kind: 'axis', axis: 'Y' }, count: 2, spacing: 10, reversed: true } });
    const text = serializeDocument(d2, '2026-10-10T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(d2);
    // Le schéma JSON publié accepte la répétition.
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
