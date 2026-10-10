import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makeMirrorFeature, makePocketFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, Id, MirrorParams, SketchFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addCircle, addRectangle } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const HOLE = Math.PI * 9 * 5;
const PLATE = 9000 - HOLE;

function withMirror(doc: CadDocument, partId: Id, params: MirrorParams): CadDocument {
  const base = makeMirrorFeature(doc, findPart(doc, partId)!);
  return addFeature(doc, partId, { ...base, params });
}

function evaluate(doc: CadDocument) {
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const [res] = engine.evaluateDocument(doc);
  return { res: res!, engine };
}

/** Plaque 60 × 30 × 5 centrée sur l'origine, percée d'un trou Ø 6 en (15, 5). */
function centeredPlate(): { doc: CadDocument; partId: Id; pocketId: Id } {
  let doc = createDocument('Plaque centrée');
  const partId = doc.parts[0]!.id;
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
  doc = addFeature(doc, partId, { ...sk, params: solveSketch(addRectangle(sk.params, { x: -30, y: -15 }, { x: 30, y: 15 }).sketch).sketch });
  doc = addFeature(doc, partId, makeExtrudeFeature(doc, findPart(doc, partId)!, sk.id, 5));
  const sk2 = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
  doc = addFeature(doc, partId, { ...sk2, params: solveSketch(addCircle(sk2.params, { x: 15, y: 5 }, 3).sketch).sketch });
  const po = makePocketFeature(doc, findPart(doc, partId)!, sk2.id, { kind: 'throughAll' }, 'symmetric');
  doc = addFeature(doc, partId, po);
  return { doc, partId, pocketId: po.id };
}

describe('symétrie', () => {
  it('toute la pièce par rapport au plan YZ : pièce doublée d’un seul tenant', () => {
    const { doc, ids } = buildPlateDocument();
    const { res, engine } = evaluate(withMirror(doc, ids.partId, { source: { kind: 'part' }, plane: { kind: 'plane', plane: 'YZ' } }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.solidCount).toBe(1);
    expect(res.analysis!.volume).toBeCloseTo(2 * PLATE, 3);
    expect(res.analysis!.bbox!.min.x).toBeCloseTo(-60, 6);
    // Faces de la copie : étiquetées au nom de la symétrie, avec l'étape d'origine dans l'élément.
    const mesh = engine.meshOf(res, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    const mirrored = mesh.faces.filter((f) => f.tags.some((t) => t.featureId === res.statuses.at(-1)!.featureId));
    expect(mirrored.length).toBeGreaterThan(4);
    expect(mirrored.some((f) => f.tags.some((t) => t.role === 'end' && t.entityId === `${ids.extrude}/`))).toBe(true);
  });

  it('par rapport à une face de la pièce (côté droit) : la pièce se prolonge', () => {
    const { doc, ids } = buildPlateDocument();
    const sketch = findPart(doc, ids.partId)!.features.find((f) => f.id === ids.sketch1) as SketchFeature;
    const right = sketch.params.entities.filter((e) => e.type === 'line')[1]!.id;
    const d2 = withMirror(doc, ids.partId, { source: { kind: 'part' }, plane: { kind: 'face', ref: { featureId: ids.extrude, role: 'side', entityId: right } } });
    const { res } = evaluate(d2);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(2 * PLATE, 3);
    expect(res.analysis!.bbox!.max.x).toBeCloseTo(120, 6);
  });

  it('symétrie d’une étape : le trou reproduit de l’autre côté', () => {
    const { doc, partId, pocketId } = centeredPlate();
    const { res } = evaluate(withMirror(doc, partId, { source: { kind: 'feature', featureId: pocketId }, plane: { kind: 'plane', plane: 'YZ' } }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(9000 - 2 * HOLE, 3);
  });

  it('pièce déjà symétrique : avertissement, rien ne change', () => {
    const { doc, partId } = centeredPlate();
    // Sans le trou (étape 2 seule) : la plaque centrée est sa propre image par YZ.
    const plain = { ...doc, parts: doc.parts.map((p) => ({ ...p, features: p.features.slice(0, 2) })) };
    const { res } = evaluate(withMirror(plain, partId, { source: { kind: 'part' }, plane: { kind: 'plane', plane: 'YZ' } }));
    expect(res.statuses.at(-1)).toMatchObject({ state: 'warning', code: 'MIRROR_NOTHING_ADDED' });
    expect(res.analysis!.volume).toBeCloseTo(9000, 3);
  });

  it('face disparue : erreur expliquée', () => {
    const { doc, ids } = buildPlateDocument();
    const d2 = withMirror(doc, ids.partId, { source: { kind: 'part' }, plane: { kind: 'face', ref: { featureId: ids.extrude, role: 'side', entityId: 'absent' } } });
    expect(evaluate(d2).res.statuses.at(-1)).toMatchObject({ state: 'error', code: 'MIRROR_PLANE_LOST' });
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const { doc, partId, pocketId } = centeredPlate();
    const d2 = withMirror(doc, partId, { source: { kind: 'feature', featureId: pocketId }, plane: { kind: 'plane', plane: 'XZ' } });
    const text = serializeDocument(d2, '2026-10-10T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(d2);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
