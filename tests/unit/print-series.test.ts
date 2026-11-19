import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { formatSeriesValue, SERIES_MAX, seriesValues, variantKey } from '../../src/app/fabrication';
import { DEFAULT_FABRICATION, fabricationSettings, newPlate, selectedPlate } from '../../src/app/fabrication';
import type { CadDocument } from '../../src/domain/model';
import { applyParameters, variantDocument } from '../../src/features/parameters';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { buildPlateDocument } from '../helpers/plate';

/** Plaque dont l'épaisseur suit le paramètre `ep`. */
function linkedPlate(): { doc: CadDocument; extrude: string; partId: string } {
  const { doc, ids } = buildPlateDocument();
  const part = doc.parts[0]!;
  const features = part.features.map((f) => (f.id === ids.extrude ? { ...f, expressions: { distance: 'ep' } } : f));
  return { doc: applyParameters({ ...doc, parts: [{ ...part, features }], parameters: [{ name: 'ep', expression: '5' }, { name: 'double', expression: 'ep*2' }] }), extrude: ids.extrude, partId: ids.partId };
}

describe('série d’essais : valeurs', () => {
  it('entre deux valeurs, en n essais', () => {
    expect(seriesValues({ parameter: 'jeu', mode: 'range', from: 0.1, to: 0.4, count: 4 }).values).toEqual([0.1, 0.2, 0.3, 0.4]);
    // Dans l'ordre croissant même si on la saisit à l'envers.
    expect(seriesValues({ parameter: 'jeu', mode: 'range', from: 0.4, to: 0.1, count: 4 }).values).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(seriesValues({ parameter: 'jeu', mode: 'range', from: 0.2, to: 0.4, count: 1 }).values).toEqual([0.2]);
  });

  it('autour d’une valeur, ± écart par pas (symétrique)', () => {
    expect(seriesValues({ parameter: 'd', mode: 'around', center: 5, delta: 0.2, step: 0.1 }).values).toEqual([4.8, 4.9, 5, 5.1, 5.2]);
    // Écart qui ne tombe pas sur un pas : on s'arrête au dernier pas compris dedans.
    expect(seriesValues({ parameter: 'd', mode: 'around', center: 5, delta: 0.25, step: 0.1 }).values).toEqual([4.8, 4.9, 5, 5.1, 5.2]);
    expect(seriesValues({ parameter: 'd', mode: 'around', center: 5, delta: 0, step: 0.1 }).values).toEqual([5]);
  });

  it('liste : triée, sans doublon', () => {
    expect(seriesValues({ parameter: 'd', mode: 'list', values: [0.3, 0.1, 0.3, 0.15] }).values).toEqual([0.1, 0.15, 0.3]);
  });

  it('explique une saisie incomplète ou une série trop longue', () => {
    expect(seriesValues({ parameter: 'd', mode: 'range', from: 0 }).error).toBeTruthy();
    expect(seriesValues({ parameter: 'd', mode: 'around', center: 5, delta: 1, step: 0 }).error).toMatch(/pas/);
    expect(seriesValues({ parameter: 'd', mode: 'around', center: 5, delta: 1, step: 0.01 }).error).toMatch(String(SERIES_MAX));
    expect(seriesValues({ parameter: 'd', mode: 'range', from: 0, to: 1, count: SERIES_MAX + 1 }).error).toBeTruthy();
    expect(seriesValues({ parameter: 'd', mode: 'list', values: [] }).error).toBeTruthy();
  });

  it('valeurs écrites à la française, clé insensible à la casse du paramètre', () => {
    expect(formatSeriesValue(0.15)).toBe('0,15');
    expect(formatSeriesValue(1234.5)).toBe('1234,5');
    expect(variantKey('p', { parameter: 'Jeu' }, 0.1 + 0.2)).toBe(variantKey('p', { parameter: 'jeu' }, 0.3));
  });
});

describe('série d’essais : version du projet', () => {
  it('le paramètre prend la valeur, les paramètres et les champs qui en dépendent suivent', () => {
    const { doc, extrude, partId } = linkedPlate();
    const v = variantDocument(doc, 'EP', 3.5);
    const ex = v.parts.find((p) => p.id === partId)!.features.find((f) => f.id === extrude)!;
    expect(ex.type === 'extrude' && ex.params.distance).toBe(3.5);
    expect(v.parameters?.find((p) => p.name === 'ep')?.expression).toBe('3.5');
    // Le projet ouvert n'est pas touché.
    const orig = doc.parts[0]!.features.find((f) => f.id === extrude)!;
    expect(orig.type === 'extrude' && orig.params.distance).toBe(5);
    // Paramètre inconnu, ou sans effet sur la pièce : même pièce.
    expect(variantDocument(doc, 'absent', 1)).toBe(doc);
    expect(variantDocument(doc, 'double', 40).parts[0]).toBe(doc.parts[0]);
  });

  it('la série est conservée dans le fichier (schéma respecté)', () => {
    const { doc, partId } = linkedPlate();
    const withSeries: CadDocument = {
      ...doc,
      fabrication: { ...DEFAULT_FABRICATION, print: { ...DEFAULT_FABRICATION.print, items: [{ partId, copies: 1, scale: 100, series: { parameter: 'ep', mode: 'around', center: 5, delta: 0.2, step: 0.1 } }] } },
    };
    const text = serializeDocument(withSeries);
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc.fabrication?.print.items[0]?.series).toEqual({ parameter: 'ep', mode: 'around', center: 5, delta: 0.2, step: 0.1 });
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
  });
});

describe('plateaux d’impression', () => {
  it('ancien format : les pièces qui avaient des exemplaires passent sur « Plateau 1 »', () => {
    const { doc, partId } = linkedPlate();
    const old: CadDocument = { ...doc, fabrication: { ...DEFAULT_FABRICATION, print: { ...DEFAULT_FABRICATION.print, items: [{ partId, copies: 2, scale: 100 }, { partId: 'disparue', copies: 1, scale: 100 }] } } };
    const f = fabricationSettings(old, () => true);
    expect(f.print.plates).toEqual([{ id: 'plate-1', name: 'Plateau 1', items: [{ partId, copies: 2, scale: 100 }] }]);
    // Pièce à 0 exemplaire, ou projet jamais préparé : plateau vide.
    const zero: CadDocument = { ...doc, fabrication: { ...DEFAULT_FABRICATION, print: { ...DEFAULT_FABRICATION.print, items: [{ partId, copies: 0, scale: 100 }] } } };
    expect(fabricationSettings(zero, () => true).print.plates![0]!.items).toEqual([]);
    expect(fabricationSettings(doc, () => true).print.plates).toEqual([{ id: 'plate-1', name: 'Plateau 1', items: [] }]);
  });

  it('nouveau plateau au premier nom libre ; plateau choisi, ou le premier', () => {
    const plates = [{ id: 'plate-1', name: 'Plateau 1', items: [] }, { id: 'plate-3', name: 'Plateau 3', items: [] }];
    expect(newPlate(plates)).toEqual({ id: 'plate-4', name: 'Plateau 4', items: [] });
    const print = { ...DEFAULT_FABRICATION.print, plates };
    expect(selectedPlate(print, 'plate-3').name).toBe('Plateau 3');
    expect(selectedPlate(print, 'absent').name).toBe('Plateau 1');
  });

  it('plateaux conservés dans le fichier (schéma respecté)', () => {
    const { doc, partId } = linkedPlate();
    const plates = [
      { id: 'plate-1', name: 'Essais', items: [{ partId, copies: 1, scale: 100, series: { parameter: 'ep', mode: 'list' as const, values: [4, 5] } }] },
      { id: 'plate-2', name: 'Série', items: [{ partId, copies: 3, scale: 110, downFace: { featureId: 'f', role: 'end' as const } }] },
    ];
    const withPlates: CadDocument = { ...doc, fabrication: { ...DEFAULT_FABRICATION, print: { ...DEFAULT_FABRICATION.print, items: [], plates } } };
    const text = serializeDocument(withPlates);
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc.fabrication?.print.plates).toEqual(plates);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
  });
});
