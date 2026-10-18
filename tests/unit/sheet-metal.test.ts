import { describe, expect, it } from 'vitest';
import { bendAllowance, bendIssues, defaultBendRadius, kFactorFor, minBendRadius, sheetMaterial, SHEET_MATERIALS } from '../../src/domain/sheet-metal';

describe('tôlerie : calculs de pli', () => {
  it('longueur développée : quart de cercle sur la fibre neutre', () => {
    // 90°, r = 2, t = 1, K = 0,5 : π/2 × 2,5.
    expect(bendAllowance(90, 2, 1, 0.5)).toBeCloseTo((Math.PI / 2) * 2.5, 9);
    expect(bendAllowance(-90, 2, 1, 0.5)).toBeCloseTo(bendAllowance(90, 2, 1, 0.5), 9);
    expect(bendAllowance(0, 2, 1, 0.5)).toBe(0);
  });

  it('facteur K : 0,5 pour les plastiques, plus petit pour un pli serré dans le métal', () => {
    const alu = sheetMaterial('aluminium');
    expect(kFactorFor(sheetMaterial('acrylic'), 1, 3)).toBe(0.5);
    expect(kFactorFor(alu, 1, 1)).toBeCloseTo(alu.kFactor, 9);
    expect(kFactorFor(alu, 0.5, 1)).toBeLessThan(alu.kFactor);
    expect(kFactorFor(alu, 0.5, 1)).toBeGreaterThanOrEqual(0.33);
    expect(kFactorFor(alu, 3, 1)).toBeGreaterThan(alu.kFactor);
    expect(kFactorFor(alu, 10, 1)).toBe(0.5);
  });

  it('limites : rayon trop petit, angle trop grand, épaisseur peu courante', () => {
    const alu = sheetMaterial('aluminium');
    expect(minBendRadius(alu, 2)).toBe(3);
    expect(defaultBendRadius(alu, 2)).toBe(3);
    expect(bendIssues(alu, 2, 3, 90)).toEqual([]);
    expect(bendIssues(alu, 2, 1, 90)).toEqual([{ kind: 'radius', min: 3 }]);
    expect(bendIssues(alu, 2, 3, 170)).toEqual([{ kind: 'angle', max: 135 }]);
    expect(bendIssues(alu, 2.2, 4, 90)).toEqual([{ kind: 'thickness', available: alu.thicknesses }]);
  });

  it('matériaux : identifiants uniques, valeurs sensées, inconnu → aluminium', () => {
    expect(new Set(SHEET_MATERIALS.map((m) => m.id)).size).toBe(SHEET_MATERIALS.length);
    for (const m of SHEET_MATERIALS) {
      expect(m.kFactor).toBeGreaterThan(0.3);
      expect(m.kFactor).toBeLessThanOrEqual(0.5);
      expect(m.maxAngle).toBeLessThanOrEqual(180);
      expect(m.thicknesses.length).toBeGreaterThan(0);
    }
    expect(sheetMaterial('inconnu').id).toBe('aluminium');
  });
});
