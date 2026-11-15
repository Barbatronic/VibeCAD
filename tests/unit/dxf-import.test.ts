import { describe, expect, it } from 'vitest';
import { importDxfShape } from '../../src/io/dxf-import';
import { addStamp, emptySketch } from '../../src/sketch/model';
import { extractProfiles } from '../../src/sketch/profiles';

/** Fichier DXF minimal : en-tête facultatif, puis les entités données (paires code / valeur). */
function dxf(entities: (string | number)[][], units?: number): string {
  const header = units === undefined ? [] : [0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, units, 0, 'ENDSEC'];
  return [...header, 0, 'SECTION', 2, 'ENTITIES', ...entities.flat(), 0, 'ENDSEC', 0, 'EOF'].join('\n');
}
const line = (x1: number, y1: number, x2: number, y2: number) => [0, 'LINE', 8, '0', 10, x1, 20, y1, 11, x2, 21, y2];

/** Aire du profil obtenu en posant le tampon à sa taille réelle. */
function areaOf(result: ReturnType<typeof importDxfShape>): number {
  if (!result.ok) throw new Error(result.error);
  const sketch = addStamp(emptySketch({ kind: 'plane', plane: 'XY', offset: 0 }), { x: 0, y: 0 }, result.shape, result.size!).sketch;
  const profiles = extractProfiles(sketch);
  if (!profiles.ok) throw new Error(profiles.code);
  return profiles.regions.reduce((sum, r) => sum + r.area, 0);
}

describe('import DXF dans une esquisse', () => {
  it('réunit des lignes séparées en un contour fermé, à l’échelle, avec un cercle pour trou', () => {
    // Rectangle 80 × 40 dessiné en 4 lignes dans le désordre (une à l'envers), percé d'un cercle Ø 10.
    const r = importDxfShape(dxf([line(0, 0, 80, 0), line(80, 40, 0, 40), line(80, 0, 80, 40), line(0, 0, 0, 40), [0, 'CIRCLE', 10, 20, 20, 20, 40, 5]]), 'plaque');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.size).toBeCloseTo(80, 6);
    expect(areaOf(r)).toBeCloseTo(80 * 40 - Math.PI * 25, 0);
  });

  it('polyligne fermée avec arrondis (bulge) : un oblong', () => {
    // Oblong de 60 × 20 : deux demi-cercles (bulge 1) reliés par deux droites.
    const r = importDxfShape(dxf([[0, 'LWPOLYLINE', 90, 4, 70, 1, 10, 10, 20, 0, 10, 50, 20, 0, 42, 1, 10, 50, 20, 20, 10, 10, 20, 20, 42, 1]]), 'oblong');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.size).toBeCloseTo(60, 3);
    expect(areaOf(r)).toBeCloseTo(40 * 20 + Math.PI * 100, 0);
  });

  it('arc et lignes : un secteur ; unités en pouces converties en millimètres', () => {
    // Quart de disque de rayon 1 pouce.
    const r = importDxfShape(dxf([line(0, 0, 1, 0), [0, 'ARC', 10, 0, 20, 0, 40, 1, 50, 0, 51, 90], line(0, 1, 0, 0)], 1), 'quart');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.size).toBeCloseTo(25.4, 3);
    expect(areaOf(r)).toBeCloseTo((Math.PI * 25.4 * 25.4) / 4, 0);
  });

  it('refuse un tracé ouvert, un fichier sans entité et un texte quelconque', () => {
    expect(importDxfShape(dxf([line(0, 0, 10, 0), line(10, 0, 10, 10)]), 'ouvert').ok).toBe(false);
    expect(importDxfShape(dxf([]), 'vide').ok).toBe(false);
    expect(importDxfShape('bonjour', 'texte').ok).toBe(false);
    const blocks = importDxfShape(dxf([[0, 'INSERT', 2, 'BLOC', 10, 0, 20, 0]]), 'blocs');
    expect(blocks.ok).toBe(false);
    if (!blocks.ok) expect(blocks.error).toContain('blocs');
  });
});
