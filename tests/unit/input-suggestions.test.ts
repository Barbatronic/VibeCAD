import { describe, expect, it } from 'vitest';
import { rankSuggestions, tokenBefore } from '../../src/ui/components/number-input';

const names = (list: { name: string }[]) => list.map((x) => x.name);
const items = ['largeur', 'Longueur', 'ep', 'hauteur_pied', 'épaisseur', 'rayon'].map((name) => ({ name }));

describe('liste des paramètres sous un champ numérique', () => {
  it('nom en cours de saisie juste avant le curseur', () => {
    expect(tokenBefore('lar', 3)).toBe('lar');
    expect(tokenBefore('largeur/2', 9)).toBe('');
    expect(tokenBefore('10 + ha', 7)).toBe('ha');
    expect(tokenBefore('10 + ha*2', 7)).toBe('ha');
    expect(tokenBefore('12', 2)).toBe('');
  });

  it('tri du plus proche au plus lointain, casse et accents ignorés', () => {
    expect(names(rankSuggestions(items, 'L')).slice(0, 2)).toEqual(['largeur', 'Longueur']);
    expect(names(rankSuggestions(items, 'LON'))[0]).toBe('Longueur');
    expect(names(rankSuggestions(items, 'epa'))[0]).toBe('épaisseur');
    // Début d'un mot du nom (après _), puis lettres contenues.
    expect(names(rankSuggestions(items, 'pied'))[0]).toBe('hauteur_pied');
    expect(names(rankSuggestions(items, 'ayo'))[0]).toBe('rayon');
    // Faute de frappe : le nom le plus ressemblant passe devant.
    expect(names(rankSuggestions(items, 'lageur'))[0]).toBe('largeur');
    // Rien de tapé : tous, par ordre alphabétique.
    expect(names(rankSuggestions(items, ''))).toEqual(['ep', 'épaisseur', 'hauteur_pied', 'largeur', 'Longueur', 'rayon']);
    expect(rankSuggestions(items, 'x')).toHaveLength(items.length);
  });
});
