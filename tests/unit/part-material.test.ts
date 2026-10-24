import { describe, expect, it } from 'vitest';
import { massOf, partMaterial, partMaterialId } from '../../src/domain/part-material';
import { demoMotorMount } from '../helpers/demo-motor';

describe('matière d’une pièce', () => {
  it('la choisie, sinon celle de la tôle, sinon le PLA', () => {
    const doc = demoMotorMount();
    const cover = doc.parts.find((p) => p.name === 'Capot')!;
    const { material: _m, ...plate } = doc.parts.find((p) => p.name === 'Platine')!;
    expect(cover.material).toBeUndefined();
    expect(partMaterialId(cover)).toBe('acrylic');
    expect(partMaterialId(plate)).toBe('pla');
    expect(partMaterialId({ ...plate, material: 'aluminium' })).toBe('aluminium');
    // Valeur inconnue : on retombe sur la règle par défaut.
    expect(partMaterialId({ ...plate, material: 'bois-rare' })).toBe('pla');
  });

  it('masse d’une pièce pleine', () => {
    // 1 cm³ d'acier : 7,85 g ; 10 cm³ de PLA : 12,4 g.
    expect(massOf(1000, partMaterial('steel'))).toBeCloseTo(7.85, 6);
    expect(massOf(10000, partMaterial('pla'))).toBeCloseTo(12.4, 6);
    expect(partMaterial(undefined).id).toBe('pla');
  });
});
