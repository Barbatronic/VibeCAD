import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeFlangeFeature, makeFoldFeature, makeSheetFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, EdgeRef, Id } from '../../src/domain/model';
import { kFactorFor, sheetMaterial } from '../../src/domain/sheet-metal';
import { RecomputeEngine } from '../../src/features/engine';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { addLine, addRectangle } from '../../src/sketch/model';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Tôle d'aluminium 100 × 40 × 2 (x 0 → 100, y 0 → 40, z 0 → 2), rayon 3. */
function sheetDoc(): { doc: CadDocument; partId: Id; sheetId: Id; lines: string[] } {
  let doc = createDocument('Tôle');
  const partId = doc.parts[0]!.id;
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
  const r = addRectangle(sk.params, { x: 0, y: 0 }, { x: 100, y: 40 });
  doc = addFeature(doc, partId, { ...sk, params: r.sketch });
  const sheet = makeSheetFeature(doc, findPart(doc, partId)!, sk.id, 'aluminium');
  doc = addFeature(doc, partId, { ...sheet, params: { ...sheet.params, thickness: 2, radius: 3 } });
  return { doc, partId, sheetId: sheet.id, lines: r.lines };
}

function evaluate(doc: CadDocument) {
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  return engine.evaluateDocument(doc)[0]!;
}

/** Arête du dessus (rôle `end`) le long du côté `line` du rectangle. */
const topEdge = (sheetId: Id, line: string): EdgeRef => ({ faces: [{ featureId: sheetId, role: 'end' }, { featureId: sheetId, role: 'side', entityId: line }] });

describe('tôlerie : tôle, bord plié, pli', () => {
  it('tôle : plaque de l’épaisseur choisie, développé = la plaque', () => {
    const { doc } = sheetDoc();
    const res = evaluate(doc);
    expect(res.statuses.map((s) => s.state)).toEqual(['ok', 'ok']);
    expect(res.analysis!.volume).toBeCloseTo(8000, 3);
    expect(res.sheet?.thickness).toBe(2);
    expect(kernel.volumeOf(res.sheet!.flat).volume).toBeCloseTo(8000, 3);
  });

  it('bord plié de 30 mm à 90° sur le côté droit : rebord vertical, développé allongé de la longueur du pli', () => {
    const { doc: d0, partId, sheetId, lines } = sheetDoc();
    const fl = makeFlangeFeature(d0, findPart(d0, partId)!, [topEdge(sheetId, lines[1]!)]);
    const doc = addFeature(d0, partId, { ...fl, params: { ...fl.params, length: 30 } });
    const res = evaluate(doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    // Aluminium, r = 3, t = 2 : K selon r / t ; pli de 90°.
    const k = kFactorFor(sheetMaterial('aluminium'), 3, 2);
    const allowance = (Math.PI / 2) * (3 + k * 2);
    const flatVolume = (100 + allowance + 30) * 40 * 2;
    expect(kernel.volumeOf(res.sheet!.flat).volume).toBeCloseTo(flatVolume, 1);
    const a = res.analysis!;
    expect(a.solidCount).toBe(1);
    // Rebord : de x = 100 + r à 100 + r + t, jusqu'à z = t + r + 30.
    expect(a.bbox!.max.x).toBeCloseTo(105, 3);
    expect(a.bbox!.max.z).toBeCloseTo(2 + 3 + 30, 3);
    // Volume plié : celui du plat, à l'écart de fibre neutre près (K < 0,5).
    expect(a.volume).toBeGreaterThan(0.97 * flatVolume);
    expect(a.volume).toBeLessThan(1.01 * flatVolume);
  });

  it('boîte : bords pliés sur les quatre côtés en une étape', () => {
    const { doc: d0, partId, sheetId, lines } = sheetDoc();
    const fl = makeFlangeFeature(d0, findPart(d0, partId)!, lines.map((l) => topEdge(sheetId, l)));
    const res = evaluate(addFeature(d0, partId, { ...fl, params: { ...fl.params, length: 15 } }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.solidCount).toBe(1);
    expect(res.analysis!.bbox!.max.z).toBeCloseTo(20, 3);
    expect(res.analysis!.bbox!.min.x).toBeCloseTo(-5, 3);
    expect(res.analysis!.bbox!.max.y).toBeCloseTo(45, 3);
    expect(res.sheet!.folds).toHaveLength(4);
  });

  it('pli sur un trait à x = 60, vers le bas, côté droit du trait', () => {
    const { doc: d0, partId } = sheetDoc();
    const sk = makeSketchFeature(d0, findPart(d0, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
    // Trait de (60, −5) à (60, 45) : sa droite est le côté x > 60.
    const line = addLine(sk.params, { x: 60, y: -5 }, { x: 60, y: 45 });
    let doc = addFeature(d0, partId, { ...sk, params: line.sketch });
    const fo = makeFoldFeature(doc, findPart(doc, partId)!, sk.id);
    doc = addFeature(doc, partId, { ...fo, params: { ...fo.params, direction: 'down', side: 'right', angle: 90 } });
    const res = evaluate(doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.bbox!.max.z).toBeCloseTo(2, 6);
    expect(res.analysis!.bbox!.min.z).toBeLessThan(-30);
    expect(res.analysis!.bbox!.max.x).toBeCloseTo(60 + 3 + 2, 3);
    // Le développé reste la plaque de départ.
    expect(kernel.volumeOf(res.sheet!.flat).volume).toBeCloseTo(8000, 3);
  });

  it('limites du matériau : rayon trop petit pour l’aluminium → avertissement', () => {
    const { doc: d0, partId, sheetId, lines } = sheetDoc();
    const fl = makeFlangeFeature(d0, findPart(d0, partId)!, [topEdge(sheetId, lines[1]!)]);
    const res = evaluate(addFeature(d0, partId, { ...fl, params: { ...fl.params, radius: 1 } }));
    expect(res.statuses.at(-1)!.state).toBe('warning');
    expect(res.statuses.at(-1)!.message).toContain('au moins 3 mm');
  });

  it('pli sans tôle : erreur expliquée', () => {
    let doc = createDocument('Sans tôle');
    const partId = doc.parts[0]!.id;
    const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
    doc = addFeature(doc, partId, { ...sk, params: addLine(sk.params, { x: 0, y: 0 }, { x: 10, y: 0 }).sketch });
    const fo = makeFoldFeature(doc, findPart(doc, partId)!, sk.id);
    const res = evaluate(addFeature(doc, partId, fo));
    expect(res.statuses.at(-1)!.code).toBe('SHEET_REQUIRED');
  });

  it('format natif : tôle, bord plié et pli relus à l’identique, conformes au schéma', () => {
    const { doc: d0, partId, sheetId, lines } = sheetDoc();
    const fl = makeFlangeFeature(d0, findPart(d0, partId)!, [topEdge(sheetId, lines[1]!)]);
    let doc = addFeature(d0, partId, { ...fl, params: { ...fl.params, radius: 4, direction: 'down' } });
    const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
    doc = addFeature(doc, partId, { ...sk, params: addLine(sk.params, { x: 60, y: -5 }, { x: 60, y: 45 }).sketch });
    const fo = makeFoldFeature(doc, findPart(doc, partId)!, sk.id);
    doc = addFeature(doc, partId, { ...fo, params: { ...fo.params, lineId: 'l1', side: 'left' } });
    const text = serializeDocument(doc, '2026-10-18T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });

  it('un pli qui traverse l’arrondi d’un bord plié est refusé, avec l’étape en cause', () => {
    const { doc: d0, partId, sheetId, lines } = sheetDoc();
    const fl = makeFlangeFeature(d0, findPart(d0, partId)!, [topEdge(sheetId, lines[0]!)]);
    let doc = addFeature(d0, partId, fl);
    const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
    doc = addFeature(doc, partId, { ...sk, params: addLine(sk.params, { x: 60, y: -40 }, { x: 60, y: 45 }).sketch });
    const fo = makeFoldFeature(doc, findPart(doc, partId)!, sk.id);
    const res = evaluate(addFeature(doc, partId, fo));
    expect(res.statuses.at(-1)!.code).toBe('SHEET_FOLD_CROSSING');
    expect(res.statuses.at(-1)!.relatedFeatureId).toBe(fl.id);
  });
});
