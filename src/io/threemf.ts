/**
 * Export 3MF (impression 3D) : archive contenant un maillage par pièce, en millimètres, avec le
 * nom et la couleur de chaque pièce. Contrairement au STL, l'unité est enregistrée dans le
 * fichier. Les sommets partagés entre faces sont fusionnés : chaque objet est un maillage fermé
 * (« manifold »), comme l'exige la spécification 3MF.
 *
 * Impression multicouleur : une pièce peinte porte le filament de chaque triangle, sous la forme
 * lue par les logiciels d'impression : attribut `paint_color` (Bambu Studio, OrcaSlicer) et
 * `slic3rpe:mmu_segmentation` (PrusaSlicer). Le logiciel ajoute alors autant de filaments que le
 * fichier en utilise, dans l'ordre des emplacements de l'AMS.
 */
import type { MeshData } from '../geometry/kernel';
import { createZip } from './zip';

export const THREEMF_NOTE =
  'Le 3MF enregistre l’unité (millimètres), le nom et la couleur de chaque pièce : c’est le format conseillé pour les logiciels d’impression récents (PrusaSlicer, Bambu Studio, OrcaSlicer, Cura).';

export interface ThreeMfItem {
  name: string;
  /** Couleur `#rrggbb`. */
  color: string;
  mesh: Pick<MeshData, 'positions' | 'indices'>;
  /** Filament (1, 2, 3…) de l'objet entier (emplacement de l'AMS) ; absent : celui par défaut. */
  filament?: number;
  /** Filament de chaque triangle de `mesh` (pièce peinte) ; absent : la pièce entière prend `filament`. */
  filaments?: Uint8Array;
}

/**
 * Code d'un triangle entier peint avec le filament `n` (format des triangles peints de PrusaSlicer,
 * repris par Bambu Studio et OrcaSlicer) : 1 → « 4 », 2 → « 8 », 3 → « 0C », 4 → « 1C »…
 */
export function filamentCode(n: number): string {
  if (n < 1 || n > 17 || !Number.isInteger(n)) throw new RangeError(`filament ${n} hors limites`);
  return n < 3 ? (n << 2).toString(16).toUpperCase() : `${(n - 3).toString(16).toUpperCase()}C`;
}

export interface IndexedMesh {
  vertices: Float64Array;
  triangles: Uint32Array;
  /** Triangle d'origine (dans `mesh.indices`) de chaque triangle gardé. */
  sources: Uint32Array;
}

/** Fusionne les sommets de même position et retire les triangles dégénérés. */
export function weldMesh(mesh: Pick<MeshData, 'positions' | 'indices'>): IndexedMesh {
  const map = new Map<string, number>();
  const vertices: number[] = [];
  const remap = new Uint32Array(mesh.positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const x = mesh.positions[i * 3]!;
    const y = mesh.positions[i * 3 + 1]!;
    const z = mesh.positions[i * 3 + 2]!;
    const key = `${x},${y},${z}`;
    let index = map.get(key);
    if (index === undefined) {
      index = vertices.length / 3;
      map.set(key, index);
      vertices.push(x, y, z);
    }
    remap[i] = index;
  }
  const triangles: number[] = [];
  const sources: number[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]!]!;
    const b = remap[mesh.indices[t + 1]!]!;
    const c = remap[mesh.indices[t + 2]!]!;
    if (a !== b && b !== c && a !== c) {
      triangles.push(a, b, c);
      sources.push(t / 3);
    }
  }
  return { vertices: Float64Array.from(vertices), triangles: Uint32Array.from(triangles), sources: Uint32Array.from(sources) };
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Nombre décimal sans exposant ni zéros inutiles (précision 0,1 µm). */
function num(v: number): string {
  const s = (Math.abs(v) < 5e-8 ? 0 : v).toFixed(4);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function build3mfModel(items: readonly ThreeMfItem[], meta: { title: string; application: string }): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  const painted = items.some((i) => i.filaments);
  lines.push(`<model unit="millimeter" xml:lang="fr-FR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${painted ? ' xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"' : ''}>`);
  lines.push(`  <metadata name="Title">${escapeXml(meta.title)}</metadata>`);
  lines.push(`  <metadata name="Application">${escapeXml(meta.application)}</metadata>`);
  if (painted) lines.push('  <metadata name="slic3rpe:MmPaintingVersion">1</metadata>');
  lines.push('  <resources>');
  lines.push('    <basematerials id="1">');
  for (const item of items) lines.push(`      <base name="${escapeXml(item.name)}" displaycolor="${item.color.toUpperCase()}FF" />`);
  lines.push('    </basematerials>');
  items.forEach((item, i) => {
    const { vertices, triangles, sources } = weldMesh(item.mesh);
    lines.push(`    <object id="${i + 2}" type="model" name="${escapeXml(item.name)}" pid="1" pindex="${i}">`);
    lines.push('      <mesh>');
    lines.push('        <vertices>');
    for (let v = 0; v < vertices.length; v += 3) lines.push(`          <vertex x="${num(vertices[v]!)}" y="${num(vertices[v + 1]!)}" z="${num(vertices[v + 2]!)}" />`);
    lines.push('        </vertices>');
    lines.push('        <triangles>');
    for (let t = 0; t < triangles.length; t += 3) {
      const filament = item.filaments?.[sources[t / 3]!];
      const paint = filament ? ` paint_color="${filamentCode(filament)}" slic3rpe:mmu_segmentation="${filamentCode(filament)}"` : '';
      lines.push(`          <triangle v1="${triangles[t]}" v2="${triangles[t + 1]}" v3="${triangles[t + 2]}"${paint} />`);
    }
    lines.push('        </triangles>');
    lines.push('      </mesh>');
    lines.push('    </object>');
  });
  lines.push('  </resources>');
  lines.push('  <build>');
  items.forEach((_item, i) => lines.push(`    <item objectid="${i + 2}" />`));
  lines.push('  </build>');
  lines.push('</model>');
  return lines.join('\n');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

/**
 * Filament de chaque objet, dans les réglages lus par les logiciels d'impression : PrusaSlicer
 * (`Slic3r_PE_model.config`, repris par OrcaSlicer) et Bambu Studio / OrcaSlicer
 * (`model_settings.config`). Une pièce d'une seule couleur prend ainsi son filament en entier,
 * comme si on le choisissait dans la liste des objets. Null si aucun objet n'a de filament.
 */
export function objectFilamentConfigs(items: readonly ThreeMfItem[]): { prusa: string; bambu: string } | null {
  if (!items.some((i) => i.filament !== undefined)) return null;
  const prusa = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
  const bambu = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
  items.forEach((item, i) => {
    const id = i + 2;
    const name = escapeXml(item.name);
    const extruder = item.filament ?? 1;
    const triangles = weldMesh(item.mesh).triangles.length / 3;
    prusa.push(`  <object id="${id}" instances_count="1">`);
    prusa.push(`    <metadata type="object" key="name" value="${name}"/>`);
    prusa.push(`    <metadata type="object" key="extruder" value="${extruder}"/>`);
    prusa.push(`    <volume firstid="0" lastid="${Math.max(0, triangles - 1)}">`);
    prusa.push(`      <metadata type="volume" key="name" value="${name}"/>`);
    prusa.push('      <metadata type="volume" key="volume_type" value="ModelPart"/>');
    prusa.push('    </volume>');
    prusa.push('  </object>');
    bambu.push(`  <object id="${id}">`);
    bambu.push(`    <metadata key="name" value="${name}"/>`);
    bambu.push(`    <metadata key="extruder" value="${extruder}"/>`);
    bambu.push('  </object>');
  });
  prusa.push('</config>');
  bambu.push('</config>');
  return { prusa: prusa.join('\n'), bambu: bambu.join('\n') };
}

export async function meshesTo3mf(items: readonly ThreeMfItem[], meta: { title: string; application: string }): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const configs = objectFilamentConfigs(items);
  return createZip([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(RELS) },
    { name: '3D/3dmodel.model', data: enc.encode(build3mfModel(items, meta)) },
    ...(configs
      ? [
          { name: 'Metadata/Slic3r_PE_model.config', data: enc.encode(configs.prusa) },
          { name: 'Metadata/model_settings.config', data: enc.encode(configs.bambu) },
        ]
      : []),
  ]);
}
