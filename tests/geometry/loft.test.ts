import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeLoftFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, LoftFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addCircle, addRectangle } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Carré de côté `a` centré sur l'axe Z, sur le plan XY décalé de `z`. */
function squareAt(doc: CadDocument, a: number, z: number): { doc: CadDocument; id: string } {
  const part = doc.parts[0]!;
  const sk = makeSketchFeature(doc, findPart(doc, part.id)!, { kind: 'plane', plane: 'XY', offset: z });
  const params = solveSketch(addRectangle(sk.params, { x: -a / 2, y: -a / 2 }, { x: a / 2, y: a / 2 }).sketch).sketch;
  return { doc: addFeature(doc, part.id, { ...sk, params }), id: sk.id };
}

function circleAt(doc: CadDocument, d: number, z: number): { doc: CadDocument; id: string } {
  const part = doc.parts[0]!;
  const sk = makeSketchFeature(doc, findPart(doc, part.id)!, { kind: 'plane', plane: 'XY', offset: z });
  const params = solveSketch(addCircle(sk.params, { x: 0, y: 0 }, d / 2).sketch).sketch;
  return { doc: addFeature(doc, part.id, { ...sk, params }), id: sk.id };
}

function loft(doc: CadDocument, ids: string[], ruled: boolean): CadDocument {
  const base = makeLoftFeature(doc, doc.parts[0]!, ids);
  const f: LoftFeature = { ...base, params: { ...base.params, ruled } };
  return addFeature(doc, doc.parts[0]!.id, f);
}

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;

describe('lissage', () => {
  it('raccords droits entre deux carrés : tronc de pyramide au volume exact', () => {
    let doc = createDocument('Tronc');
    const a = squareAt(doc, 20, 0);
    const b = squareAt(a.doc, 10, 20);
    doc = loft(b.doc, [a.id, b.id], true);
    const res = evaluate(doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo((20 / 3) * (400 + 100 + 200), 3);
  });

  it('d’un carré à un rond, surface lisse', () => {
    let doc = createDocument('Transition');
    const a = squareAt(doc, 20, 0);
    const b = circleAt(a.doc, 20, 30);
    doc = loft(b.doc, [a.id, b.id], false);
    const res = evaluate(doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.bbox!.min.z).toBeCloseTo(0, 6);
    expect(res.analysis!.bbox!.max.z).toBeCloseTo(30, 6);
    expect(res.analysis!.volume).toBeGreaterThan(Math.PI * 100 * 30);
    expect(res.analysis!.volume).toBeLessThan(400 * 30);
  });

  it('esquisse avec deux contours : erreur expliquée', () => {
    let doc = createDocument('Erreur');
    const a = squareAt(doc, 20, 0);
    const part = a.doc.parts[0]!;
    const sk = makeSketchFeature(a.doc, findPart(a.doc, part.id)!, { kind: 'plane', plane: 'XY', offset: 10 });
    let p = addCircle(sk.params, { x: -5, y: 0 }, 2).sketch;
    p = solveSketch(addCircle(p, { x: 5, y: 0 }, 2).sketch).sketch;
    doc = addFeature(a.doc, part.id, { ...sk, params: p });
    expect(evaluate(loft(doc, [a.id, sk.id], false)).statuses.at(-1)).toMatchObject({ state: 'error', code: 'LOFT_PROFILE' });
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const a = squareAt(createDocument('F'), 20, 0);
    const b = circleAt(a.doc, 20, 30);
    const doc = loft(b.doc, [a.id, b.id], true);
    const text = serializeDocument(doc, '2026-10-11T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc).toEqual(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
