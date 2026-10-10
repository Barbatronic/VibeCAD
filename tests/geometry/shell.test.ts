import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makePrimitiveFeature, makeShellFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, FaceRef, ShellFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Boîte 40 × 30 × 20 (forme toute faite) puis coque. */
function boxShell(open: (boxId: string) => FaceRef[], thickness = 2, outward = false): { doc: CadDocument; boxId: string; shellId: string } {
  let doc = createDocument('Pot');
  const partId = doc.parts[0]!.id;
  const box = makePrimitiveFeature(doc, findPart(doc, partId)!, 'box');
  doc = addFeature(doc, partId, { ...box, params: { ...box.params, width: 40, depth: 30, height: 20 } });
  const shell = makeShellFeature(doc, findPart(doc, partId)!, open(box.id), thickness);
  const s: ShellFeature = { ...shell, params: { ...shell.params, outward } };
  return { doc: addFeature(doc, partId, s), boxId: box.id, shellId: s.id };
}

function evaluate(doc: CadDocument) {
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const [res] = engine.evaluateDocument(doc);
  return { res: res!, engine };
}

describe('coque', () => {
  it('boîte ouverte par le dessus, paroi de 2 mm vers l’intérieur', () => {
    const { doc } = boxShell((id) => [{ featureId: id, role: 'end' }]);
    const { res } = evaluate(doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo(24000 - 36 * 26 * 18, 1);
    expect(res.analysis!.bbox).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 40, y: 30, z: 20 } });
  });

  it('deux faces ouvertes (tube carré), et paroi vers l’extérieur', () => {
    const tube = evaluate(boxShell((id) => [{ featureId: id, role: 'end' }, { featureId: id, role: 'start' }]).doc).res;
    expect(tube.analysis!.volume).toBeCloseTo(24000 - 36 * 26 * 20, 1);
    const out = evaluate(boxShell((id) => [{ featureId: id, role: 'end' }], 2, true).doc).res;
    expect(out.analysis!.volume).toBeCloseTo(44 * 34 * 22 - 24000, 0);
  });

  it('sans face ouverte : pièce creuse et fermée', () => {
    const { res } = evaluate(boxShell(() => []).doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo(24000 - 36 * 26 * 16, 1);
  });

  it('une esquisse se pose sur le fond intérieur', () => {
    const { doc, shellId } = boxShell((id) => [{ featureId: id, role: 'end' }]);
    const { res, engine } = evaluate(doc);
    const mesh = engine.meshOf(res, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    const bottom = mesh.faces.find((f) => f.plane && Math.abs(f.plane.origin.z - 2) < 1e-6 && f.plane.normal.z > 0.99)!;
    const tag = bottom.tags.find((t) => t.featureId === shellId)!;
    expect(tag).toMatchObject({ role: 'side', entityId: 'inner' });
    const sk = makeSketchFeature(doc, doc.parts[0]!, { kind: 'face', ref: tag });
    const r2 = evaluate(addFeature(doc, doc.parts[0]!.id, sk)).res;
    expect(r2.sketches.find((s) => s.featureId === sk.id)!.frame!.origin.z).toBeCloseTo(2, 9);
  });

  it('face disparue ou épaisseur trop grande : erreurs expliquées', () => {
    const lost = evaluate(boxShell(() => [{ featureId: 'absent', role: 'end' }]).doc).res;
    expect(lost.statuses.at(-1)).toMatchObject({ state: 'error', code: 'SHELL_FACE_LOST' });
    const thick = evaluate(boxShell((id) => [{ featureId: id, role: 'end' }], 20).doc).res;
    expect(thick.statuses.at(-1)!.state).toBe('error');
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const { doc } = boxShell((id) => [{ featureId: id, role: 'end' }], 1.5, true);
    const text = serializeDocument(doc, '2026-10-10T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc).toEqual(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
