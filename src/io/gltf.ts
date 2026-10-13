/**
 * Export glTF 2.0 binaire (.glb) : pour montrer un modèle dans une page web, une présentation, un
 * visualiseur 3D ou de la réalité augmentée. Ce sont les maillages d'affichage (facettes), sans
 * historique ni cotes : pour échanger avec un logiciel de CAO, préférer STEP.
 *
 * - Un maillage par pièce (partagé si la pièce est insérée plusieurs fois), un nœud par exemplaire
 *   avec sa matrice de placement, une couleur par pièce (matériau mat, non métallique).
 * - glTF compte en mètres avec Y vers le haut ; VibeCAD en millimètres avec Z vers le haut : le nœud
 *   racine convertit (échelle 0,001 et quart de tour autour de X), les coordonnées restent en mm.
 */

export interface GltfMesh {
  key: string;
  name: string;
  /** Couleur #rrggbb. */
  color: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface GltfNode {
  name: string;
  mesh: string;
  /** Matrice 4 × 4 par colonnes (mm) ; absente : identité. */
  matrix?: number[];
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** sRGB (0–255) → composante linéaire (0–1), comme l'attend baseColorFactor. */
function linear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function colorFactor(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0.5, 0.5, 0.5, 1];
  return [linear(parseInt(m[1]!, 16)), linear(parseInt(m[2]!, 16)), linear(parseInt(m[3]!, 16)), 1];
}

const pad4 = (n: number) => (n + 3) & ~3;

/** Fichier .glb : en-tête, bloc JSON, bloc binaire. */
export function toGlb(meshes: readonly GltfMesh[], nodes: readonly GltfNode[], generator: string): Uint8Array {
  const used = meshes.filter((m) => nodes.some((n) => n.mesh === m.key) && m.indices.length > 0);
  const chunks: Uint8Array[] = [];
  let binLength = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const push = (data: ArrayBufferView, target: number) => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.length, target });
    chunks.push(bytes);
    const padded = pad4(bytes.length);
    if (padded > bytes.length) chunks.push(new Uint8Array(padded - bytes.length));
    binLength += padded;
    return bufferViews.length - 1;
  };
  const meshIndex = new Map<string, number>();
  const gltfMeshes: object[] = [];
  const materials: object[] = [];
  for (const m of used) {
    const count = m.positions.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, m.positions[i]!);
      max[i % 3] = Math.max(max[i % 3]!, m.positions[i]!);
    }
    const pos = accessors.push({ bufferView: push(m.positions, 34962), componentType: 5126, count, type: 'VEC3', min, max }) - 1;
    const nor = accessors.push({ bufferView: push(m.normals, 34962), componentType: 5126, count, type: 'VEC3' }) - 1;
    const idx = accessors.push({ bufferView: push(m.indices, 34963), componentType: 5125, count: m.indices.length, type: 'SCALAR' }) - 1;
    const material = materials.push({ name: m.name, pbrMetallicRoughness: { baseColorFactor: colorFactor(m.color), metallicFactor: 0, roughnessFactor: 0.6 } }) - 1;
    meshIndex.set(m.key, gltfMeshes.push({ name: m.name, primitives: [{ attributes: { POSITION: pos, NORMAL: nor }, indices: idx, material }] }) - 1);
  }
  const children = nodes.filter((n) => meshIndex.has(n.mesh));
  const json = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ name: 'VibeCAD', nodes: [0] }],
    nodes: [
      // Racine : millimètres → mètres, Z vers le haut → Y vers le haut.
      { name: 'VibeCAD (mm, Z vers le haut)', matrix: [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1], children: children.map((_n, i) => i + 1) },
      ...children.map((n) => ({ name: n.name, mesh: meshIndex.get(n.mesh)!, ...(n.matrix && n.matrix.some((v, i) => v !== IDENTITY[i]) ? { matrix: n.matrix } : {}) })),
    ],
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = pad4(jsonBytes.length);
  if (jsonPadded > jsonBytes.length) {
    const padded = new Uint8Array(jsonPadded).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // « glTF »
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true); // « JSON »
  out.set(jsonBytes, 20);
  let o = 20 + jsonBytes.length;
  view.setUint32(o, binLength, true);
  view.setUint32(o + 4, 0x004e4942, true); // « BIN »
  o += 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Lecture d'un .glb (contrôle et tests) : JSON et bloc binaire. */
export function readGlb(bytes: Uint8Array): { json: Record<string, unknown>; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new Error('Ce n’est pas un fichier glTF 2.0 binaire.');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Record<string, unknown>;
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  return { json, bin: bytes.subarray(binStart + 8, binStart + 8 + binLength) };
}
