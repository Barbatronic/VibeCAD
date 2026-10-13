import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { applyParameters, resolveParameters } from '../../src/features/parameters';
import { evaluateExpression, expressionNames, parseLength, readNumber, setParameterScope } from '../../src/domain/units';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { buildPlateDocument } from '../helpers/plate';

describe('équations dans les champs numériques', () => {
  it('opérations, parenthèses, virgule, π et paramètres', () => {
    const scope = new Map([['largeur', 60], ['marge', 5]]);
    expect(evaluateExpression('60/4 + 2', scope)).toEqual({ ok: true, value: 17 });
    expect(evaluateExpression('(largeur - 2*marge) / 2', scope)).toEqual({ ok: true, value: 25 });
    expect(evaluateExpression('Largeur × 1,5', scope)).toEqual({ ok: true, value: 90 });
    expect((evaluateExpression('2*pi', scope) as { value: number }).value).toBeCloseTo(2 * Math.PI, 12);
    expect(evaluateExpression('hauteur + 1', scope)).toMatchObject({ ok: false, unknown: 'hauteur' });
    expect(expressionNames('(Largeur - 2*marge)/2 + pi')).toEqual(['largeur', 'marge']);
  });

  it('tous les champs les acceptent (longueurs, nombres), avec un message clair pour un nom inconnu', () => {
    setParameterScope(new Map([['ep', 3]]));
    expect(parseLength('ep*2')).toEqual({ ok: true, value: 6 });
    expect(readNumber('ep + 0,5')).toBe(3.5);
    const bad = parseLength('epaisseur', { label: 'L’épaisseur' });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/« epaisseur » n’est pas un paramètre du projet/);
    setParameterScope(new Map());
  });
});

describe('paramètres du projet', () => {
  it('valeurs dans l’ordre des dépendances, quel que soit l’ordre de la liste', () => {
    const r = resolveParameters([
      { name: 'entraxe', expression: 'largeur - 2*marge' },
      { name: 'largeur', expression: '60' },
      { name: 'marge', expression: 'largeur/12' },
    ]);
    expect(r.errors.size).toBe(0);
    expect(r.values.get('entraxe')).toBe(50);
  });

  it('nom inconnu, nom en double et boucle sont signalés', () => {
    const r = resolveParameters([
      { name: 'a', expression: 'b + 1' },
      { name: 'b', expression: 'a * 2' },
      { name: 'c', expression: 'z' },
      { name: 'C', expression: '4' },
    ]);
    expect(r.errors.get('a')).toMatch(/boucle/);
    expect(r.errors.get('b')).toMatch(/boucle/);
    expect(r.errors.get('c')).toMatch(/« z »/);
    expect(r.errors.get('C')).toMatch(/déjà utilisé/);
  });

  it('report dans une étape (épaisseur de l’extrusion) et dans une cote d’esquisse', () => {
    const { doc, ids } = buildPlateDocument();
    const part = doc.parts[0]!;
    const features = part.features.map((f) => {
      if (f.id === ids.extrude) return { ...f, expressions: { distance: 'ep' } };
      if (f.id === ids.sketch1 && f.type === 'sketch') {
        return { ...f, params: { ...f.params, constraints: f.params.constraints.map((c) => (c.id === ids.widthConstraint ? { ...c, expression: 'largeur' } : c)) } };
      }
      return f;
    });
    const linked = { ...doc, parts: [{ ...part, features }], parameters: [{ name: 'ep', expression: '8' }, { name: 'largeur', expression: '75' }] };
    const out = applyParameters(linked);
    const ex = out.parts[0]!.features.find((f) => f.id === ids.extrude)!;
    expect(ex.type === 'extrude' && ex.params.distance).toBe(8);
    const sk = out.parts[0]!.features.find((f) => f.id === ids.sketch1)!;
    expect(sk.type === 'sketch' && sk.params.constraints.find((c) => c.id === ids.widthConstraint)).toMatchObject({ value: 75, expression: 'largeur' });
    // Rien à changer : même document.
    expect(applyParameters(out)).toBe(out);
  });

  it('sont conservés dans le fichier, avec les équations des étapes et des cotes (schéma respecté)', () => {
    const { doc, ids } = buildPlateDocument();
    const part = doc.parts[0]!;
    const features = part.features.map((f) => {
      if (f.id === ids.extrude) return { ...f, expressions: { distance: 'ep*2' } };
      if (f.id === ids.sketch1 && f.type === 'sketch') {
        return { ...f, params: { ...f.params, constraints: f.params.constraints.map((c) => (c.id === ids.widthConstraint ? { ...c, expression: 'largeur/2' } : c)) } };
      }
      return f;
    });
    const linked = applyParameters({ ...doc, parts: [{ ...part, features }], parameters: [{ name: 'ep', expression: '4' }, { name: 'largeur', expression: '120', comment: 'Plateau' }] });
    const text = serializeDocument(linked);
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc.parameters).toEqual(linked.parameters);
    expect(parsed.ok && parsed.doc.parts).toEqual(linked.parts);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
  });
});
