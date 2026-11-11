import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { addPart, createDocument } from '../../src/domain/document';
import { addFolder, removeFolder, setFolderVisible, setPartFolder } from '../../src/domain/folders';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';

/** Projet neuf (une pièce d'office) plus deux pièces, la première des deux rangée dans un dossier. */
function sample() {
  let doc = createDocument('Dossiers');
  const a = addPart(doc);
  const b = addPart(a.doc);
  const f = addFolder(b.doc, 'Visserie');
  doc = setPartFolder(f.doc, a.partId, f.folderId);
  return { doc, a: a.partId, b: b.partId, folder: f.folderId };
}

describe('dossiers de la liste des pièces', () => {
  it('range, masque et libère les pièces', () => {
    const { doc, a, b, folder } = sample();
    expect(doc.parts.map((p) => p.folder)).toEqual([undefined, folder, undefined]);
    expect(setPartFolder(doc, b, 'inconnu')).toBe(doc);
    expect(setFolderVisible(doc, folder, false).parts.map((p) => p.visible)).toEqual([true, false, true]);
    const out = setPartFolder(doc, a, null);
    expect(out.parts.some((p) => 'folder' in p)).toBe(false);
    const removed = removeFolder(doc, folder);
    expect(removed.folders).toBeUndefined();
    expect(removed.parts.every((p) => p.folder === undefined)).toBe(true);
  });

  it('est relu à l’identique et conforme au schéma', () => {
    const { doc, folder } = sample();
    const text = serializeDocument(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toEqual([]);
    expect(parsed.doc.folders).toEqual([{ id: folder, name: 'Visserie' }]);
    expect(parsed.doc.parts.map((p) => p.folder)).toEqual([undefined, folder, undefined]);
  });

  it('remet hors dossier une pièce dont le dossier a disparu du fichier', () => {
    const { doc } = sample();
    const file = JSON.parse(serializeDocument(doc));
    delete file.document.folders;
    const parsed = parseNativeFile(JSON.stringify(file));
    expect(parsed.ok && parsed.doc.parts.every((p) => p.folder === undefined)).toBe(true);
  });
});
