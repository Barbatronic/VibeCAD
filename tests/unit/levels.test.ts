import { describe, expect, it } from 'vitest';
import { allows, levelOf, parseLevel } from '../../src/app/levels';

describe('niveaux de l’interface', () => {
  it('lit le niveau avec ou sans accents, refuse le reste', () => {
    expect(parseLevel('débutant')).toBe('debutant');
    expect(parseLevel('Intermédiaire')).toBe('intermediaire');
    expect(parseLevel(' EXPERT ')).toBe('expert');
    expect(parseLevel('novice')).toBeNull();
    expect(parseLevel(null)).toBeNull();
  });

  it('chaque niveau montre les outils des niveaux inférieurs', () => {
    expect(allows('debutant', 'feature:extrude')).toBe(true);
    expect(allows('debutant', 'feature:pocket')).toBe(true);
    expect(allows('debutant', 'sketch:coincident')).toBe(true);
    expect(allows('debutant', 'feature:revolve')).toBe(false);
    expect(allows('debutant', 'workspace:assembly')).toBe(false);
    expect(allows('intermediaire', 'feature:revolve')).toBe(true);
    expect(allows('intermediaire', 'sketch:trim')).toBe(true);
    expect(allows('intermediaire', 'import-step')).toBe(false);
    expect(allows('expert', 'import-step')).toBe(true);
    expect(levelOf('feature:mirror')).toBe('intermediaire');
  });
});
