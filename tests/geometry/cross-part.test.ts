import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, addPart, createDocument, findPart, makeExtrudeFeature, makePrimitiveFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, Id, SketchFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addLine, addRectangle } from '../../src/sketch/model';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Pièce A : boîte 40 × 30 × `height` ; pièce B : rectangle sur le dessus de A, extrudé de 5. */
function project(height: number): { doc: CadDocument; a: Id; b: Id; box: Id; sketch: Id } {
  let doc = createDocument('Deux pièces');
  const a = doc.parts[0]!.id;
  const box = makePrimitiveFeature(doc, findPart(doc, a)!, 'box');
  doc = addFeature(doc, a, { ...box, params: { ...box.params, width: 40, depth: 30, height } });
  const added = addPart(doc, 'B');
  doc = added.doc;
  const b = added.partId;
  const sk = makeSketchFeature(doc, findPart(doc, b)!, { kind: 'face', ref: { featureId: box.id, role: 'end' }, partId: a });
  doc = addFeature(doc, b, { ...sk, params: addRectangle(sk.params, { x: 5, y: 5 }, { x: 15, y: 15 }).sketch });
  doc = addFeature(doc, b, makeExtrudeFeature(doc, findPart(doc, b)!, sk.id, 5));
  return { doc, a, b, box: box.id, sketch: sk.id };
}

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);

describe('références entre pièces d’un même projet', () => {
  it('esquisse de B posée sur le dessus de A : B commence sur A, et le suit quand A change', () => {
    const r1 = evaluate(project(10).doc);
    expect(r1[1]!.statuses.map((s) => s.state)).toEqual(['ok', 'ok']);
    expect(r1[1]!.analysis!.bbox!.min.z).toBeCloseTo(10, 6);
    expect(r1[1]!.analysis!.bbox!.max.z).toBeCloseTo(15, 6);
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    engine.evaluateDocument(project(10).doc);
    const r2 = engine.evaluateDocument(project(25).doc);
    expect(r2[1]!.analysis!.bbox!.min.z).toBeCloseTo(25, 6);
  });

  it('pièce B placée avant A dans le projet : A est calculée d’abord', () => {
    const { doc } = project(10);
    const swapped = { ...doc, parts: [doc.parts[1]!, doc.parts[0]!] };
    const r = evaluate(swapped);
    expect(r[0]!.statuses.every((s) => s.state === 'ok')).toBe(true);
    expect(r[0]!.analysis!.bbox!.min.z).toBeCloseTo(10, 6);
  });

  it('arête de A reprise dans une esquisse de B : elle suit A', () => {
    const p = project(10);
    let doc = p.doc;
    const sk = makeSketchFeature(doc, findPart(doc, p.b)!, { kind: 'plane', plane: 'XY', offset: 0 });
    // Arête avant du dessus de A (y = 0), reprise ; position enregistrée volontairement fausse.
    const line = addLine(sk.params, { x: 1, y: 1 }, { x: 2, y: 1 });
    const params = {
      ...line.sketch,
      entities: line.sketch.entities.map((e) => (e.id === line.lineId ? { ...e, reference: { edge: { faces: [{ featureId: p.box, role: 'end' as const }, { featureId: p.box, role: 'side' as const, entityId: 'y-' }] as [any, any] }, partId: p.a } } : e)),
    };
    doc = addFeature(doc, p.b, { ...sk, params });
    const r = evaluate(doc);
    expect(r[1]!.statuses.at(-1)!.state).not.toBe('error');
    const solved = r[1]!.sketches.find((s) => s.featureId === sk.id)!.solved;
    const pts = solved.entities.filter((e) => e.type === 'point' && e.id !== 'o') as { x: number; y: number }[];
    const xs = pts.map((q) => q.x).sort((u, v) => u - v);
    expect(xs[0]).toBeCloseTo(0, 6);
    expect(xs.at(-1)).toBeCloseTo(40, 6);
  });

  it('boucle entre pièces (A s’appuie sur B qui s’appuie sur A) : erreur expliquée', () => {
    const p = project(10);
    let doc = p.doc;
    const bExtrude = findPart(doc, p.b)!.features[1]!.id;
    const sk = makeSketchFeature(doc, findPart(doc, p.a)!, { kind: 'face', ref: { featureId: bExtrude, role: 'end' }, partId: p.b });
    doc = addFeature(doc, p.a, sk as SketchFeature);
    const r = evaluate(doc);
    expect(r[0]!.statuses.at(-1)!.code).toBe('PART_CYCLE');
    expect(r[1]!.statuses[0]!.code).toBe('PART_CYCLE');
  });

  it('format natif : références vers une autre pièce relues à l’identique, conformes au schéma', () => {
    const { doc } = project(10);
    const text = serializeDocument(doc, '2026-10-18T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });

  it('contexte d’assemblage : la face et l’arête de l’autre pièce sont placées par la matrice', () => {
    const p = project(10);
    // A placée 50 mm plus haut et 100 mm plus loin en X que B dans l'assemblage.
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 0, 50, 1];
    const context = { instanceId: 'in-b', otherInstanceId: 'in-a', matrix };
    let doc = p.doc;
    doc = {
      ...doc,
      parts: doc.parts.map((part) =>
        part.id !== p.b ? part : { ...part, features: part.features.map((f) => (f.id === p.sketch && f.type === 'sketch' ? { ...f, params: { ...f.params, support: { ...f.params.support, context } as never } } : f)) },
      ),
    };
    const r = evaluate(doc);
    expect(r[1]!.statuses.map((s) => s.message ?? s.detail ?? s.code ?? s.state)).toEqual(['ok', 'ok']);
    // Dessus de A à z = 10 + 50 ; le rectangle de B (5 → 15) n'est pas déplacé en X par le repère
    // de la face, qui suit seulement son plan.
    expect(r[1]!.analysis!.bbox!.min.z).toBeCloseTo(60, 6);
    expect(r[1]!.analysis!.bbox!.max.z).toBeCloseTo(65, 6);

    // Arête reprise à travers l'assemblage : elle est décalée de 100 en X.
    const sk = makeSketchFeature(doc, findPart(doc, p.b)!, { kind: 'plane', plane: 'XY', offset: 0 });
    const line = addLine(sk.params, { x: 1, y: 1 }, { x: 2, y: 1 });
    const params = {
      ...line.sketch,
      entities: line.sketch.entities.map((e) =>
        e.id === line.lineId ? { ...e, reference: { edge: { faces: [{ featureId: p.box, role: 'end' as const }, { featureId: p.box, role: 'side' as const, entityId: 'y-' }] as [any, any] }, partId: p.a, context } } : e,
      ),
    };
    doc = addFeature(doc, p.b, { ...sk, params });
    const r2 = evaluate(doc);
    const solved = r2[1]!.sketches.find((s) => s.featureId === sk.id)!.solved;
    const xs = (solved.entities.filter((e) => e.type === 'point' && e.id !== 'o') as { x: number }[]).map((q) => q.x).sort((u, v) => u - v);
    expect(xs[0]).toBeCloseTo(100, 6);
    expect(xs.at(-1)).toBeCloseTo(140, 6);

    // Format : contexte relu à l'identique, conforme au schéma ; une matrice incomplète est refusée.
    const text = serializeDocument(doc, '2026-10-25T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc).toEqual(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
    const broken = text.replace('"matrix": [\n', '"matrix": [\n 1,\n');
    expect(parseNativeFile(broken).ok).toBe(false);
  });
});
