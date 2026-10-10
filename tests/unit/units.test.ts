import { describe, expect, it } from 'vitest';
import { formatLength, parseLength, stepNumberText } from '../../src/domain/units';

describe('saisie et affichage des longueurs', () => {
  it('accepte la virgule et le point décimal, avec ou sans unité', () => {
    expect(parseLength('12,5')).toEqual({ ok: true, value: 12.5 });
    expect(parseLength(' 12.5 mm ')).toEqual({ ok: true, value: 12.5 });
    expect(parseLength('60')).toEqual({ ok: true, value: 60 });
  });

  it('calcule les opérations simples', () => {
    expect(parseLength('60/2')).toEqual({ ok: true, value: 30 });
    expect(parseLength('(10 + 2,5) * 2')).toEqual({ ok: true, value: 25 });
  });

  it('explique les saisies invalides', () => {
    const empty = parseLength('');
    expect(empty.ok).toBe(false);
    const letters = parseLength('douze');
    expect(letters.ok).toBe(false);
    if (!letters.ok) expect(letters.error).toMatch(/nombre/);
    const negative = parseLength('-3', { label: 'La profondeur' });
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.error).toMatch(/^La profondeur/);
    expect(parseLength('0').ok).toBe(false);
    expect(parseLength('0', { allowZero: true })).toEqual({ ok: true, value: 0 });
    expect(parseLength('20000').ok).toBe(false);
    expect(parseLength('1/0').ok).toBe(false);
    expect(parseLength('1..2').ok).toBe(false);
  });

  it('affiche les longueurs à la française', () => {
    expect(formatLength(12.5)).toBe('12,5 mm');
    expect(formatLength(60)).toBe('60 mm');
    expect(formatLength(1 / 3)).toBe('0,33 mm');
    expect(formatLength(-0.0001)).toBe('0 mm');
  });

  it('augmente ou diminue une saisie d’un pas (flèches, molette)', () => {
    expect(stepNumberText('60', 1, 1)).toBe('61');
    expect(stepNumberText('12,5', -1, 0.1)).toBe('12,4');
    expect(stepNumberText('60/2', 1, 10)).toBe('40');
    // Saisie vide : on part de la dimension en cours de tracé.
    expect(stepNumberText('', 1, 1, { fallback: 42.37 })).toBe('43,37');
    expect(stepNumberText('', 1, 1)).toBeNull();
    // Sous le minimum, la valeur ne bouge pas ; 0 est atteignable quand il est permis.
    expect(stepNumberText('1', -1, 1)).toBeNull();
    expect(stepNumberText('1', -1, 1, { min: 0 })).toBe('0');
    expect(stepNumberText('0,3', -1, 0.1)).toBe('0,2');
    expect(stepNumberText('9999,5', 1, 1)).toBeNull();
  });
});
