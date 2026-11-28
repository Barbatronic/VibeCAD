import { describe, expect, it } from 'vitest';
import { placementWarnings, type PlacedOutline } from '../../src/app/laser';
import type { LaserMaterial } from '../../src/domain/model';

const material: LaserMaterial = { id: 'mat-3', name: 'Contreplaqué 3 mm', thickness: 3, sheet: { w: 300, h: 300 }, kerf: 0.15 };

/** Carré de côté `size`, centré en (x, y), sur la plaque `sheet`. */
const square = (name: string, x: number, y: number, size: number, sheet = 0, copy = 0): PlacedOutline => {
  const h = size / 2;
  const local = [[{ x: -h, y: -h }, { x: h, y: -h }, { x: h, y: h }, { x: -h, y: h }]];
  return {
    partId: name,
    name,
    materialId: material.id,
    sheet,
    copy,
    loops: local.map((l) => l.map((p) => ({ x: p.x + x, y: p.y + y }))),
    labelAt: { x, y },
    placement: { x, y, angle: 0 },
    local,
  };
};

describe('découpe laser : pièces mal placées', () => {
  it('pièces bien rangées : aucun avertissement', () => {
    expect(placementWarnings([square('A', 50, 50, 40), square('B', 150, 50, 40)], material)).toEqual([]);
  });

  it('une pièce qui dépasse de la plaque est signalée', () => {
    const w = placementWarnings([square('A', 10, 150, 60)], material);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('« A » dépasse de sa plaque');
  });

  it('deux pièces qui se chevauchent sont signalées ensemble, pas celles d’une autre plaque', () => {
    const w = placementWarnings([square('A', 100, 100, 60), square('B', 120, 110, 60), square('C', 100, 100, 60, 1)], material);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('« A »');
    expect(w[0]).toContain('« B »');
    expect(w[0]).not.toContain('« C »');
  });

  it('les exemplaires sont nommés', () => {
    const w = placementWarnings([square('Roue', 290, 150, 40, 0, 1)], material);
    expect(w[0]).toContain('« Roue » (exemplaire 2)');
  });
});
