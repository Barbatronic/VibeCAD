import { describe, expect, it } from 'vitest';
import { fastenerGroups, fastenerMesh, sizesForHole } from '../../src/app/fasteners';
import { designation, holeMatches, INSERTS, lengthsOf, matchHole, sizesOf, suggestedLength } from '../../src/domain/fasteners';
import { holeDiameter } from '../../src/features/hole/definition';
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
    for (const kind of ['iso4762', 'iso7380', 'iso10642', 'iso4017', 'iso4032', 'iso7089', 'insert'] as const) {
      for (const size of sizesOf(kind)) {
        const length = lengthsOf(kind, size)[0];
        const { mesh } = fastenerMesh(kind, size, length);
        expect(closed(mesh), `${kind} ${size}`).toBe(true);
        expect(signedVolume(mesh), `${kind} ${size}`).toBeGreaterThan(0);
      }
    }
  });

  it('insert à chaud : seulement dans un trou percé pour lui, affleurant, désigné avec sa longueur', () => {
    expect(sizesForHole('insert', 4)).toEqual([{ size: 'M3', hole: 'insert' }]);
    expect(sizesForHole('insert', 4.2)[0]?.size).toBe('M3');
    // Trou de passage M3 large (3,6) ou perçage à tarauder : pas d'insert. (3,2 à 3,4 : insert M2.)
    expect(sizesForHole('insert', 3.6)).toEqual([]);
    expect(sizesForHole('insert', 3.4)[0]?.size).toBe('M2');
    expect(sizesForHole('insert', 2.5)).toEqual([]);
    expect(designation('insert', 'M3')).toBe('Insert fileté à chaud M3 × 5,7');
    const { mesh } = fastenerMesh('insert', 'M3');
    expect(closed(mesh)).toBe(true);
    // Dans le trou : de −5,7 à 0 mm, rien ne dépasse de la face.
    const zs = Array.from(mesh.positions).filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(0, 6);
    expect(Math.min(...zs)).toBeCloseTo(-5.7, 6);
    const tube = Math.PI * (2.3 ** 2 - 1.5 ** 2) * 5.7;
    expect(signedVolume(mesh) / tube).toBeGreaterThan(0.85);
    expect(signedVolume(mesh) / tube).toBeLessThan(1);
  });

  it('perçage fileté pour insert : le diamètre conseillé de l’insert', () => {
    const base = { sketchId: 's', kind: 'tapped', size: 'M3', fit: 'medium', through: false, depth: 8, headDiameter: 0, headDepth: 0 } as const;
    expect(holeDiameter({ ...base, thread: 'insert' } as never)).toBe(INSERTS.M3!.hole);
    expect(holeDiameter({ ...base, thread: 'tap' } as never)).toBe(2.5);
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
