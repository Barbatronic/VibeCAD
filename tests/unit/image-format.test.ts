import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addFeature, addResource, createDocument, findPart, makeImageFeature } from '../../src/domain/document';
import { bytesToBase64 } from '../../src/io/resources';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';

describe('format natif : image de référence', () => {
  it('l’image (ressource) et son calque, redressé, sont relus à l’identique et conformes au schéma', () => {
    let doc = createDocument('Photo');
    const partId = doc.parts[0]!.id;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    doc = addResource(doc, { id: 'res-1', kind: 'image', mime: 'image/png', fileName: 'photo.png', encoding: 'base64', data: bytesToBase64(bytes), byteLength: bytes.length, sha256: 'a'.repeat(64), importedAt: '2026-10-18T10:00:00.000Z' });
    const img = makeImageFeature(doc, findPart(doc, partId)!, 'res-1', { w: 400, h: 300 }, { kind: 'plane', plane: 'XZ', offset: 0 });
    doc = addFeature(doc, partId, {
      ...img,
      params: { ...img.params, center: { x: 5, y: -2 }, rotation: 12, mirror: true, opacity: 0.4, perspective: { corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.2 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.8 }], aspect: 210 / 297 } },
    });
    const text = serializeDocument(doc, '2026-10-18T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
