import { describe, expect, it } from 'vitest';
import { readGlb, toGlb } from '../../src/io/gltf';

const tri = {
  positions: Float32Array.from([0, 0, 0, 10, 0, 0, 0, 20, 5]),
  normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: Uint32Array.from([0, 1, 2]),
};

describe('export glTF binaire (.glb)', () => {
  it('écrit un glb 2.0 valide : en-tête, JSON, binaire aligné, accessoires bornés', () => {
    const bytes = toGlb([{ key: 'a', name: 'Plaque', color: '#ff8000', ...tri }], [{ name: 'Plaque', mesh: 'a' }], 'VibeCAD test');
    expect(bytes.length % 4).toBe(0);
    const { json, bin } = readGlb(bytes);
    const j = json as any;
    expect(j.asset).toEqual({ version: '2.0', generator: 'VibeCAD test' });
    expect(j.buffers[0].byteLength).toBe(bin.length);
    expect(j.accessors[0]).toMatchObject({ componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [10, 20, 5] });
    expect(j.accessors[2]).toMatchObject({ componentType: 5125, count: 3, type: 'SCALAR' });
    // Les données binaires se relisent telles quelles.
    const view = j.bufferViews[j.accessors[0].bufferView];
    expect(Array.from(new Float32Array(bin.slice(view.byteOffset, view.byteOffset + view.byteLength).buffer))).toEqual(Array.from(tri.positions));
    for (const v of j.bufferViews) expect(v.byteOffset % 4).toBe(0);
    // Couleur convertie en linéaire ; racine en mètres, Z vers le haut → Y vers le haut.
    const c = j.materials[0].pbrMetallicRoughness.baseColorFactor;
    expect(c[0]).toBeCloseTo(1, 6);
    expect(c[1]).toBeCloseTo(0.2158, 3);
    expect(j.nodes[0].matrix).toEqual([0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1]);
  });

  it('une pièce insérée deux fois : un seul maillage, deux nœuds placés', () => {
    const m = [0.0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, 30, 0, 0, 1];
    const { json } = readGlb(toGlb([{ key: 'a', name: 'Bras', color: '#3366cc', ...tri }], [{ name: 'Bras', mesh: 'a' }, { name: 'Bras (2)', mesh: 'a', matrix: m }], 'x'));
    const j = json as any;
    expect(j.meshes).toHaveLength(1);
    expect(j.nodes.slice(1).map((n: any) => [n.name, n.mesh, n.matrix ?? null])).toEqual([
      ['Bras', 0, null],
      ['Bras (2)', 0, m],
    ]);
    expect(j.scenes[0].nodes).toEqual([0]);
    expect(j.nodes[0].children).toEqual([1, 2]);
  });
});
