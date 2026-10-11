import { describe, expect, it } from 'vitest';
import { fastenerGroups, fastenerMesh, sizesForHole } from '../../src/app/fasteners';
import { designation, holeMatches, lengthsOf, matchHole, sizesOf, suggestedLength } from '../../src/domain/fasteners';
import type { Assembly } from '../../src/domain/model';
import { meshVolume } from '../../src/sim/study';
import { billOfMaterials, bomCsv } from '../../src/app/drawings';
import { buildPlateDocument } from '../helpers/plate';

/** Chaque arête (par position) est partagée par exactement deux triangles : surface fermée. */
function closed(mesh: { positions: Float32Array; indices: Uint32Array }): boolean {
  const key = (v: number) => [0, 1, 2].map((c) => mesh.positions[3 * v + c]!.toFixed(4)).join(',');
  const edges = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const k = [key(mesh.indices[t + e]!), key(mesh.indices[t + ((e + 1) % 3)]!)].sort().join('|');
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  return [...edges.values()].every((n) => n === 2);
}

/** Volume signé (positif si les normales sont sortantes). */
function signedVolume(mesh: { positions: Float32Array; indices: Uint32Array }): number {
  let v = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [3 * mesh.indices[t]!, 3 * mesh.indices[t + 1]!, 3 * mesh.indices[t + 2]!];
    v += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return v / 6;
}

const hexArea = (s: number) => (Math.sqrt(3) / 2) * s * s;

describe('visserie : normes', () => {
  it('taille déduite du trou : passage ISO 273 ou taraudage, sinon rien', () => {
    expect(matchHole(3.4)).toEqual({ size: 'M3', hole: 'clearance' });
    expect(matchHole(3)).toEqual({ size: 'M3', hole: 'clearance' });
    expect(matchHole(9)).toEqual({ size: 'M8', hole: 'clearance' });
    expect(matchHole(3.8)).toBeNull();
    // 2,5 mm : passage M2,5 ou taraudage M3 ; les deux sont proposés.
    expect(holeMatches(2.5)).toContainEqual({ size: 'M3', hole: 'tapped' });
    expect(holeMatches(2.5)[0]).toEqual({ size: 'M2.5', hole: 'clearance' });
  });

  it('tailles et longueurs normalisées', () => {
    expect(sizesOf('iso7380')).not.toContain('M2');
    expect(lengthsOf('iso4762', 'M3')).toEqual([5, 6, 8, 10, 12, 14, 16, 20, 25, 30]);
    expect(lengthsOf('iso4032', 'M3')).toEqual([]);
    expect(designation('iso4762', 'M3', 12)).toBe('Vis CHC ISO 4762 M3 × 12');
    expect(designation('iso4032', 'M5')).toBe('Écrou H ISO 4032 M5');
  });

  it('longueur proposée : traverse la pièce et dépasse d’un diamètre', () => {
    expect(suggestedLength('iso4762', 'M3', 5, 'clearance')).toBe(8);
    expect(suggestedLength('iso4762', 'M3', 10, 'clearance')).toBe(14);
    expect(suggestedLength('iso4762', 'M3', 100, 'clearance')).toBe(30);
    expect(suggestedLength('iso4032', 'M3', 5, 'clearance')).toBeNull();
  });

  it('tête fraisée : la fraisure (diamètre de tête) ou le trou de passage', () => {
    expect(sizesForHole('iso10642', 6.72)[0]!.size).toBe('M3');
    expect(sizesForHole('iso10642', 3.4)[0]!.size).toBe('M3');
    expect(sizesForHole('iso7380', 3.8)).toEqual([]);
    expect(sizesForHole('iso7380', 2.4)).toEqual([{ size: 'M3', hole: 'tapped' }]);
  });
});

describe('visserie : maillages', () => {
  it('vis CHC M3 × 12 : fermée, normales sortantes, volume de la tige + tête − empreinte (aux chanfreins près)', () => {
    const { mesh } = fastenerMesh('iso4762', 'M3', 12);
    expect(closed(mesh)).toBe(true);
    const expected = Math.PI * 1.5 ** 2 * 12 + Math.PI * 2.75 ** 2 * 3 - hexArea(2.5) * 0.55 * 3;
    expect(signedVolume(mesh)).toBeGreaterThan(0.97 * expected);
    expect(signedVolume(mesh)).toBeLessThan(1.0 * expected);
  });

  it('écrou M3 et rondelle M3 : percés, fermés, bons volumes', () => {
    const nut = fastenerMesh('iso4032', 'M3').mesh;
    expect(closed(nut)).toBe(true);
    const nutVolume = (hexArea(5.5) - Math.PI * 1.5 ** 2) * 2.4;
    // Les chanfreins (coins à 30°, entrée du taraudage) retirent quelques pour cent du prisme.
    expect(signedVolume(nut) / nutVolume).toBeGreaterThan(0.9);
    expect(signedVolume(nut) / nutVolume).toBeLessThan(0.98);
    const washer = fastenerMesh('iso7089', 'M3').mesh;
    expect(closed(washer)).toBe(true);
    expect(meshVolume(washer.positions, washer.indices) / (Math.PI * (3.5 ** 2 - 1.6 ** 2) * 0.5)).toBeCloseTo(1, 1);
  });

  it('toutes les formes et tailles : surfaces fermées et orientées', () => {
    for (const kind of ['iso4762', 'iso7380', 'iso10642', 'iso4017', 'iso4032', 'iso7089'] as const) {
      for (const size of sizesOf(kind)) {
        const length = lengthsOf(kind, size)[0];
        const { mesh } = fastenerMesh(kind, size, length);
        expect(closed(mesh), `${kind} ${size}`).toBe(true);
        expect(signedVolume(mesh), `${kind} ${size}`).toBeGreaterThan(0);
      }
    }
  });

  it('regroupement : éléments identiques comptés ensemble', () => {
    const edge = { faces: [{ featureId: 'f', role: 'side' as const }, { featureId: 'f', role: 'end' as const }] as [never, never] };
    const at = { instanceId: 'i1', edge };
    const assembly = {
      instances: [],
      joints: [],
      fasteners: [
        { id: 'a', kind: 'iso4762' as const, size: 'M3' as const, length: 12, at },
        { id: 'b', kind: 'iso4032' as const, size: 'M3' as const, at },
        { id: 'c', kind: 'iso4762' as const, size: 'M3' as const, length: 12, at },
      ],
    } as unknown as Assembly;
    expect(fastenerGroups(assembly).map((g) => [g.name, g.ids])).toEqual([
      ['Vis CHC ISO 4762 M3 × 12', ['a', 'c']],
      ['Écrou H ISO 4032 M3', ['b']],
    ]);
  });

  it('nomenclature : les pièces puis la visserie regroupée par désignation', () => {
    const { doc, ids } = buildPlateDocument();
    const edge = { faces: [{ featureId: ids.pocket, role: 'side' as const }, { featureId: ids.extrude, role: 'end' as const }] as [never, never] };
    const at = { instanceId: 'i1', edge };
    const withAssembly = {
      ...doc,
      assembly: {
        instances: [{ id: 'i1', partId: ids.partId, name: 'Plaque', position: { x: 0, y: 0, z: 0 } }],
        joints: [],
        fasteners: [
          { id: 'a', kind: 'iso4762' as const, size: 'M3' as const, length: 12, at },
          { id: 'b', kind: 'iso4762' as const, size: 'M3' as const, length: 12, at },
          { id: 'c', kind: 'iso7089' as const, size: 'M3' as const, at },
        ],
      },
    };
    const bom = billOfMaterials(withAssembly, () => true, () => null, () => null);
    expect(bom.rows.map((r) => [r.mark, r.name, r.quantity, r.partId])).toEqual([
      [1, doc.parts[0]!.name, 1, ids.partId],
      [2, 'Vis CHC ISO 4762 M3 × 12', 2, null],
      [3, 'Rondelle plate ISO 7089 M3', 1, null],
    ]);
    expect(bomCsv(bom)).toContain('2;Vis CHC ISO 4762 M3 × 12;2;—;');
  });
});
