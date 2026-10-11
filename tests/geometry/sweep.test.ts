import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeSketchFeature, makeSweepFeature } from '../../src/domain/document';
import type { CadDocument, SketchParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addArc, addCircle, addConstraint, addLine } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Profil : cercle Ø 6 sur le plan XY à l'origine ; chemin dessiné sur le plan XZ. */
function tube(path: (s: SketchParams) => SketchParams): CadDocument {
  let doc = createDocument('Tube');
  const partId = doc.parts[0]!.id;
  const pathSk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XZ', offset: 0 });
  doc = addFeature(doc, partId, { ...pathSk, params: solveSketch(path(pathSk.params)).sketch });
  const prof = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
  doc = addFeature(doc, partId, { ...prof, params: solveSketch(addCircle(prof.params, { x: 0, y: 0 }, 3).sketch).sketch });
  return addFeature(doc, partId, makeSweepFeature(doc, findPart(doc, partId)!, prof.id, pathSk.id));
}

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;

describe('balayage', () => {
  it('chemin droit vers le haut : un cylindre', () => {
    const res = evaluate(tube((s) => addLine(s, { x: 0, y: 0 }, { x: 0, y: 30 }).sketch));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo(Math.PI * 9 * 30, 2);
    expect(res.analysis!.bbox!.max.z).toBeCloseTo(30, 6);
  });

  it('tube coudé : segment, quart de cercle, segment (volume = section × longueur du chemin)', () => {
    const res = evaluate(
      tube((s) => {
        const a = addLine(s, { x: 0, y: 0 }, { x: 0, y: 20 });
        // Quart de cercle de (0, 20) à (10, 30), centre (10, 20).
        const arc = addArc(a.sketch, { x: 10, y: 20 }, { x: 10, y: 30 }, { x: 0, y: 20 });
        const b = addLine(arc.sketch, { x: 10, y: 30 }, { x: 30, y: 30 });
        let r = addConstraint(b.sketch, { type: 'coincident', a: a.b, b: arc.end }).sketch;
        r = addConstraint(r, { type: 'coincident', a: arc.start, b: b.a }).sketch;
        return r;
      }),
    );
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo(Math.PI * 9 * (20 + (Math.PI / 2) * 10 + 20), 0);
  });

  it('chemin en plusieurs morceaux : erreur expliquée', () => {
    const res = evaluate(
      tube((s) => {
        const a = addLine(s, { x: 0, y: 0 }, { x: 0, y: 10 }).sketch;
        return addLine(a, { x: 5, y: 20 }, { x: 5, y: 30 }).sketch;
      }),
    );
    expect(res.statuses.at(-1)).toMatchObject({ state: 'error', code: 'INVALID_PARAMETER' });
    expect(res.statuses.at(-1)!.message).toContain('plusieurs morceaux');
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const doc = tube((s) => addLine(s, { x: 0, y: 0 }, { x: 0, y: 30 }).sketch);
    const text = serializeDocument(doc, '2026-10-11T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc).toEqual(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
