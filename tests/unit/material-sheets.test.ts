import { describe, expect, it } from 'vitest';
import { assignSheet, catalogueText, displayLook, readCatalogue, removeSheet, sheetOf, sheetProblems, STARTER_MATERIALS, updateSheet, type MaterialSheet } from '../../src/domain/material-sheets';
import { addPart, removePart } from '../../src/domain/document';
import { massOf, partMaterial, partMaterialId } from '../../src/domain/part-material';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { buildPlateDocument } from '../helpers/plate';

const red = STARTER_MATERIALS.find((m) => m.id === 'std-acrylic-red-3')!;
const pla = STARTER_MATERIALS.find((m) => m.id === 'std-pla-white')!;

describe('fiches matière', () => {
  it('les fiches livrées sont toutes valides et d’identifiant unique', () => {
    for (const m of STARTER_MATERIALS) expect(sheetProblems(m)).toEqual([]);
    expect(new Set(STARTER_MATERIALS.map((m) => m.id)).size).toBe(STARTER_MATERIALS.length);
    expect(STARTER_MATERIALS.some((m) => m.process === 'bought')).toBe(true);
  });

  it('signale une fiche mal remplie', () => {
    expect(sheetProblems({ ...pla, name: ' ', base: 'bois', color: 'rouge', opacity: 0 })).toHaveLength(4);
  });

  it('attribuer une fiche la copie dans le projet et donne sa base à la pièce (masse)', () => {
    const { doc, ids } = buildPlateDocument();
    const next = assignSheet(doc, ids.partId, red);
    const part = next.parts[0]!;
    expect(next.materials).toEqual([red]);
    expect(part.make).toBe(red.id);
    expect(part.material).toBe('acrylic');
    expect(sheetOf(next, part)?.name).toBe('Acrylique rouge 3 mm');
    expect(massOf(1000, partMaterial(partMaterialId(part)))).toBeCloseTo(1.18, 6);
    // Une seconde attribution ne recopie pas la fiche.
    expect(assignSheet(next, ids.partId, red).materials).toHaveLength(1);
    // Retour à « non choisie » : plus aucune pièce ne l'utilise, elle quitte le projet.
    const none = assignSheet(next, ids.partId, null);
    expect(none.parts[0]!.make).toBeUndefined();
    expect(none.materials).toBeUndefined();
  });

  it('les matières du projet suivent les pièces : changer ou supprimer une pièce retire l’inutile', () => {
    let { doc } = buildPlateDocument();
    doc = addPart(doc).doc;
    const [a, b] = doc.parts.map((p) => p.id);
    doc = assignSheet(assignSheet(doc, a!, red), b!, red);
    doc = assignSheet(doc, a!, pla);
    // Rouge encore utilisé par la seconde pièce : il reste.
    expect(doc.materials!.map((m) => m.id).sort()).toEqual([pla.id, red.id].sort());
    doc = assignSheet(doc, b!, pla);
    expect(doc.materials!.map((m) => m.id)).toEqual([pla.id]);
    doc = removePart(doc, a!);
    expect(doc.materials!.map((m) => m.id)).toEqual([pla.id]);
    doc = removePart(doc, b!);
    expect(doc.materials).toBeUndefined();
  });

  it('modifier une fiche fait suivre les pièces ; la retirer les laisse sans matière', () => {
    const { doc, ids } = buildPlateDocument();
    let next = assignSheet(doc, ids.partId, red);
    next = updateSheet(next, { ...red, base: 'plywood', name: 'Contreplaqué' });
    expect(next.parts[0]!.material).toBe('plywood');
    next = removeSheet(next, red.id);
    expect(next.materials).toBeUndefined();
    expect(next.parts[0]!.make).toBeUndefined();
  });

  it('rendu : couleur de conception, ou couleur et transparence de la fiche', () => {
    const { doc, ids } = buildPlateDocument();
    const clear = STARTER_MATERIALS.find((m) => m.id === 'std-acrylic-clear-3')!;
    const next = assignSheet(doc, ids.partId, clear);
    const part = next.parts[0]!;
    expect(displayLook(next, part, 'design')).toEqual({ color: part.color, opacity: 1 });
    expect(displayLook(next, part, 'materials')).toEqual({ color: clear.color, opacity: 0.35 });
    // Sans fiche, la couleur de conception reste.
    expect(displayLook(doc, doc.parts[0]!, 'materials')).toEqual({ color: doc.parts[0]!.color, opacity: 1 });
  });

  it('catalogue : export puis import, fiches invalides écartées', () => {
    const mine: MaterialSheet[] = [{ ...pla, id: 'my-1', name: 'Mon PLA', brand: 'Bambu' }];
    expect(readCatalogue(catalogueText(mine))).toEqual({ sheets: mine, rejected: 0 });
    const mixed = JSON.stringify([mine[0], { id: 'x', name: 'Cassée', base: 'pla', process: 'print', color: 'bleu' }, 'n’importe quoi']);
    expect(readCatalogue(mixed)).toEqual({ sheets: mine, rejected: 2 });
    expect(readCatalogue('pas du JSON')).toBeNull();
  });
});

describe('format natif : fiches matière', () => {
  it('garde les fiches du projet et la fiche de chaque pièce', () => {
    const { doc, ids } = buildPlateDocument();
    const next = assignSheet(doc, ids.partId, red);
    const r = parseNativeFile(serializeDocument(next));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.materials).toEqual([red]);
    expect(r.doc.parts[0]!.make).toBe(red.id);
    expect(r.warnings).toEqual([]);
  });

  it('refuse une pièce qui désigne une fiche absente, ou une fiche invalide', () => {
    const { doc, ids } = buildPlateDocument();
    const raw = JSON.parse(serializeDocument(assignSheet(doc, ids.partId, red)));
    raw.document.parts[0].make = 'std-inconnue';
    expect(parseNativeFile(JSON.stringify(raw)).ok).toBe(false);
    raw.document.parts[0].make = red.id;
    raw.document.materials[0].color = 'rouge';
    expect(parseNativeFile(JSON.stringify(raw)).ok).toBe(false);
  });

  it('une version plus ancienne garde la bonne masse : « material » reste écrit', () => {
    const { doc, ids } = buildPlateDocument();
    const raw = JSON.parse(serializeDocument(assignSheet(doc, ids.partId, red)));
    expect(raw.document.parts[0].material).toBe('acrylic');
  });
});
