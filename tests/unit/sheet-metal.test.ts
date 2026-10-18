import { describe, expect, it } from 'vitest';
import { clipLineToOutline } from '../../src/app/laser';
import { originPlaneFrame } from '../../src/math/frame';
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

describe('tôlerie : lignes de pli coupées au contour', () => {
  // Plaque 100 × 40 percée d'un trou carré 10 × 10 au milieu (x 45 → 55, y 15 → 25).
  const outline = {
    outer: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }],
    holes: [[{ x: 45, y: 15 }, { x: 45, y: 25 }, { x: 55, y: 25 }, { x: 55, y: 15 }]],
    frame: originPlaneFrame('XY'),
  };
  it('une ligne qui traverse la plaque : un seul morceau, de bord à bord', () => {
    const segs = clipLineToOutline(outline, { x: 20, y: -50, z: 1 }, { x: 0, y: 1, z: 0 });
    expect(segs).toHaveLength(1);
    expect(segs[0]![0].y).toBeCloseTo(0, 9);
    expect(segs[0]![1].y).toBeCloseTo(40, 9);
  });
  it('une ligne qui passe par le trou : deux morceaux', () => {
    const segs = clipLineToOutline(outline, { x: 50, y: 0, z: 1 }, { x: 0, y: 1, z: 0 });
    expect(segs.map(([a, b]) => [a.y, b.y])).toEqual([[0, 15], [25, 40]]);
  });
  it('une ligne hors de la plaque : rien', () => {
    expect(clipLineToOutline(outline, { x: 120, y: 0, z: 1 }, { x: 0, y: 1, z: 0 })).toEqual([]);
  });
});
