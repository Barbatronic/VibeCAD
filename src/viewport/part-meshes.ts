/**
 * Affichage des solides à partir des maillages du noyau. Le maillage ne sert qu'à l'affichage :
 * la géométrie de référence reste le solide B-Rep du worker.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  GreaterDepth,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  ShapeUtils,
  Vector2,
  type Material,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { Id } from '../domain/model';
import type { MeshData } from '../geometry/kernel';
import type { ViewportPalette } from './colors';

/**
 * Mode d'affichage des pièces (bouton « Affichage » de la vue) :
 * - `shaded-edges` : faces ombrées et arêtes (par défaut) ;
 * - `shaded` : faces ombrées seules (présentation) ;
 * - `hidden-lines` : faces blanches, arêtes visibles en trait plein et cachées en pointillés ;
 * - `transparent` : faces translucides, toutes les arêtes visibles ;
 * - `wireframe` : arêtes seules, toutes visibles ;
 * - `monochrome` : faces blanches et arêtes noires (impression, daltonisme).
 */
export type DisplayStyle = 'shaded-edges' | 'shaded' | 'hidden-lines' | 'transparent' | 'wireframe' | 'monochrome';

export const DISPLAY_STYLES: DisplayStyle[] = ['shaded-edges', 'shaded', 'hidden-lines', 'transparent', 'wireframe', 'monochrome'];

/** `ghost` : autre pièce pendant une opération ou une esquisse, très transparente et ignorée par les clics. */
export type PartAppearance = 'normal' | 'stale' | 'preview' | 'tool-add' | 'tool-cut' | 'dimmed' | 'ghost';

/** Matériau hachuré en espace écran : la sélection se voit sans dépendre de la couleur. */
export function hatchMaterial(color: string, opacity = 0.85): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        float stripe = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
        vec3 c = mix(uColor, mix(uColor, vec3(1.0), 0.55), stripe);
        gl_FragColor = vec4(c, uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: DoubleSide,
  });
}

export function fatLineMaterial(color: string, width: number, opts: { dashed?: boolean; depthTest?: boolean; opacity?: number } = {}): LineMaterial {
  const m = new LineMaterial({
    color: new Color(color).getHex(),
    linewidth: width,
    dashed: opts.dashed ?? false,
    dashSize: 3,
    gapSize: 2,
    transparent: (opts.opacity ?? 1) < 1,
    opacity: opts.opacity ?? 1,
    depthTest: opts.depthTest ?? true,
    worldUnits: false,
  });
  return m;
}

type P3 = { x: number; y: number; z: number };
const cross = (a: P3, b: P3): P3 => {
  const c = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const l = Math.hypot(c.x, c.y, c.z) || 1;
  return { x: c.x / l, y: c.y / l, z: c.z / l };
};

/** Gravures sans profondeur d'une pièce : contours en trait, régions remplies (avec leurs trous). */
export interface PartMarkings {
  lines: P3[][];
  fills: { outer: P3[]; holes: P3[][]; normal: P3 }[];
  color: string;
}

/** Clé courte d'un marquage, pour savoir s'il faut reconstruire la pièce affichée. */
export function markingsKey(m: PartMarkings): string {
  const first = (l: P3[]) => `${l.length}:${l[0]?.x.toFixed(3)},${l[0]?.y.toFixed(3)},${l[0]?.z.toFixed(3)}`;
  return `${m.color}|${m.lines.map(first).join(';')}|${m.fills.map((f) => first(f.outer)).join(';')}`;
}

export class PartObject {
  readonly group = new Group();
  readonly faces: Mesh;
  /** Arêtes en lignes épaisses (épaisseur en pixels réglable). */
  readonly edges: LineSegments2;
  /** Premier triangle de chaque face, pour retrouver la face d'un triangle touché. */
  private readonly faceTriangleStarts: number[];
  /** Marquages de surface (gravures sans profondeur) : traits et surfaces. */
  readonly markings: (LineSegments2 | Mesh)[] = [];

  constructor(
    readonly partId: Id,
    readonly meshKey: string,
    readonly data: MeshData,
    color: string,
    readonly appearance: PartAppearance,
    palette: ViewportPalette,
    style: DisplayStyle = 'shaded-edges',
    edgeWidth = 1,
    /** Opacité de la matière (< 1 : translucide) ; seulement pour une pièce affichée normalement. */
    private readonly opacity = 1,
    /** Couleur de chaque face (chants brûlés d'une découpe, couleurs d'impression) ; absente : la couleur de la pièce. */
    faceColors?: readonly string[],
    /** Marquages de surface (gravures sans profondeur), sur la face. */
    markings?: PartMarkings,
    /** Aspect de la matière (rendu « matières réelles ») ; absent : l'aspect habituel. */
    private readonly finish?: 'matte' | 'satin' | 'glossy' | 'metal',
    /** Hauteur de couche (mm) d'une pièce imprimée : stries visibles sur les flancs ; absente : surface lisse. */
    private readonly layers?: number,
    /** Arêtes cachées par la matière montrées en pointillés (choix des arêtes d'un congé, d'un chanfrein). */
    readonly xray = false,
  ) {
    // Le mode d'affichage ne concerne que les pièces « normales » (pas les aperçus d'outil, fantômes…).
    const styled = appearance === 'normal' || appearance === 'preview' ? style : 'shaded-edges';
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geometry.setIndex(new BufferAttribute(data.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const shaded = styled === 'shaded-edges' || styled === 'shaded';
    let material: Material | Material[] = shaded ? this.faceMaterial(color, appearance, palette) : this.styledFaceMaterial(color, styled, palette);
    if (faceColors && shaded && appearance === 'normal') {
      // Un matériau par couleur, et un groupe de triangles par face.
      const distinct = Array.from(new Set(faceColors));
      (material as Material).dispose();
      material = distinct.map((c) => this.faceMaterial(c, appearance, palette));
      data.faces.forEach((f, i) => geometry.addGroup(f.start, f.count, Math.max(0, distinct.indexOf(faceColors[i] ?? color))));
    }
    this.faces = new Mesh(geometry, material);
    this.faces.userData = { partId, kind: 'part-faces' };
    const edgeGeometry = new LineSegmentsGeometry();
    edgeGeometry.setPositions(data.edgePositions);
    this.edges = new LineSegments2(edgeGeometry, this.edgeMaterial(appearance, palette, styled, edgeWidth));
    this.edges.userData = { partId, kind: 'part-edges' };
    if (styled === 'shaded') this.edges.visible = false;
    if (appearance === 'tool-add' || appearance === 'tool-cut') {
      this.faces.renderOrder = 10;
      this.edges.renderOrder = 11;
    }
    this.group.add(this.faces, this.edges);
    if (styled === 'hidden-lines' || xray) {
      // Arêtes cachées : dessinées seulement là où la matière les masque (test de profondeur inversé).
      // (En mode transparent, les faces n'écrivent pas la profondeur : toutes les arêtes se voient.)
      const material = fatLineMaterial(palette.edge, Math.max(0.5, edgeWidth * 0.8), { dashed: true, opacity: 0.55 });
      material.dashSize = 1.2;
      material.gapSize = 1;
      material.depthFunc = GreaterDepth;
      material.depthWrite = false;
      const hidden = new LineSegments2(edgeGeometry, material);
      hidden.computeLineDistances();
      hidden.renderOrder = 2;
      hidden.userData = { partId, kind: 'part-hidden-edges' };
      this.hiddenEdges = hidden;
      this.group.add(hidden);
    }
    this.faceTriangleStarts = data.faces.map((f) => f.start / 3);
    if (markings && appearance !== 'ghost') this.addMarkings(markings, Math.max(1.5, edgeWidth * 1.6));
  }

  /** Gravures sans profondeur : traits (contour) et surfaces (remplissage), juste au-dessus de la face. */
  private addMarkings(markings: PartMarkings, width: number): void {
    const lift = (p: P3, n: P3, d: number) => ({ x: p.x + n.x * d, y: p.y + n.y * d, z: p.z + n.z * d });
    if (markings.lines.length) {
      const pos: number[] = [];
      for (const loop of markings.lines) {
        loop.forEach((p, i) => {
          const q = loop[(i + 1) % loop.length]!;
          pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
        });
      }
      const g = new LineSegmentsGeometry();
      g.setPositions(pos);
      const lines = new LineSegments2(g, fatLineMaterial(markings.color, width));
      lines.userData = { partId: this.partId, kind: 'part-markings' };
      lines.renderOrder = 3;
      this.markings.push(lines);
      this.group.add(lines);
    }
    if (markings.fills.length) {
      // Chaque région est triangulée dans son plan (repère tiré de la normale), trous compris.
      const pos: number[] = [];
      for (const r of markings.fills) {
        const n = r.normal;
        const u = Math.abs(n.x) < 0.9 ? cross({ x: 1, y: 0, z: 0 }, n) : cross({ x: 0, y: 1, z: 0 }, n);
        const v = cross(n, u);
        const flat = (p: P3) => new Vector2(p.x * u.x + p.y * u.y + p.z * u.z, p.x * v.x + p.y * v.y + p.z * v.z);
        const all = [r.outer, ...r.holes];
        const tris = ShapeUtils.triangulateShape(r.outer.map(flat), r.holes.map((h) => h.map(flat)));
        const points = all.flat().map((p) => lift(p, n, 0.02));
        for (const t of tris) for (const k of t) pos.push(points[k]!.x, points[k]!.y, points[k]!.z);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      const mesh = new Mesh(g, new MeshBasicMaterial({ color: markings.color, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      mesh.userData = { partId: this.partId, kind: 'part-markings' };
      mesh.renderOrder = 2;
      this.markings.push(mesh);
      this.group.add(mesh);
    }
  }

  private faceMaterial(color: string, appearance: PartAppearance, palette: ViewportPalette): Material {
    // Sans carte d'environnement, un métal très réfléchissant paraîtrait noir : reflet modéré.
    const surface = { matte: { roughness: 0.85, metalness: 0 }, satin: { roughness: 0.62, metalness: 0.04 }, glossy: { roughness: 0.28, metalness: 0.02 }, metal: { roughness: 0.4, metalness: 0.3 } }[this.finish ?? 'satin'];
    const base = { ...surface, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    switch (appearance) {
      case 'stale':
        return new MeshStandardMaterial({ ...base, color: palette.stale, transparent: true, opacity: 0.55 });
      case 'preview':
        return new MeshStandardMaterial({ ...base, color, transparent: true, opacity: 0.9 });
      case 'tool-add':
        return new MeshStandardMaterial({ ...base, color: palette.previewAdd, transparent: true, opacity: 0.38, depthWrite: false });
      case 'tool-cut':
        return new MeshStandardMaterial({ ...base, color: palette.previewCut, transparent: true, opacity: 0.38, depthWrite: false });
      case 'ghost':
        return new MeshStandardMaterial({ ...base, color, transparent: true, opacity: 0.12, depthWrite: false });
      case 'dimmed':
        return new MeshStandardMaterial({ ...base, color, transparent: true, opacity: 0.3, depthWrite: false });
      default:
        // Matière translucide (acrylique, PETG transparent) : on voit au travers, un peu brillante.
        return withLayers(
          this.opacity < 1
            ? new MeshStandardMaterial({ ...base, color, transparent: true, opacity: this.opacity, depthWrite: false, roughness: Math.min(base.roughness, 0.25) })
            : new MeshStandardMaterial({ ...base, color }),
          this.layers,
        );
    }
  }

  private edgeMaterial(appearance: PartAppearance, palette: ViewportPalette, style: DisplayStyle, width: number): LineMaterial {
    const color =
      style === 'monochrome'
        ? '#111111'
        : appearance === 'tool-add'
          ? palette.previewAdd
          : appearance === 'tool-cut'
            ? palette.previewCut
            : appearance === 'stale'
              ? palette.stale
              : palette.edge;
    const opacity = appearance === 'dimmed' ? 0.35 : appearance === 'ghost' ? 0.2 : 1;
    // Fil de fer : toutes les arêtes, même derrière la matière.
    const m = fatLineMaterial(color, width, { opacity, depthTest: style !== 'wireframe' });
    if (appearance !== 'normal') m.transparent = true;
    return m;
  }

  /** Arêtes cachées en pointillés (mode « arêtes cachées »), partageant la géométrie des arêtes. */
  private hiddenEdges: LineSegments2 | null = null;

  /** Taille de la vue (pixels) : l'épaisseur des lignes épaisses en dépend. */
  setResolution(width: number, height: number): void {
    (this.edges.material as LineMaterial).resolution.set(width, height);
    if (this.hiddenEdges) (this.hiddenEdges.material as LineMaterial).resolution.set(width, height);
    for (const m of this.markings) if (m instanceof LineSegments2) (m.material as LineMaterial).resolution.set(width, height);
  }

  private styledFaceMaterial(color: string, style: DisplayStyle, palette: ViewportPalette): Material {
    const offset = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    switch (style) {
      case 'transparent':
        return new MeshStandardMaterial({ ...offset, color, roughness: 0.62, metalness: 0.04, transparent: true, opacity: 0.28, depthWrite: false, side: DoubleSide });
      case 'wireframe':
        // Invisibles mais toujours cliquables (choisir une face reste possible).
        return new MeshBasicMaterial({ ...offset, colorWrite: false, depthWrite: false });
      case 'monochrome':
        return new MeshStandardMaterial({ ...offset, color: '#ffffff', roughness: 0.9, metalness: 0 });
      default:
        // Arêtes cachées : faces unies de la couleur du fond, comme une feuille.
        return new MeshBasicMaterial({ ...offset, color: palette.background });
    }
  }

  /** Face (rang dans `data.faces`) qui contient le triangle donné. */
  faceOfTriangle(triangle: number): number {
    let lo = 0;
    let hi = this.faceTriangleStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.faceTriangleStarts[mid]! <= triangle) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Maillage de surlignage d'une face (partage les sommets du maillage complet). */
  faceOverlay(faceIndex: number, material: Material): Mesh | null {
    const face = this.data.faces[faceIndex];
    if (!face) return null;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.faces.geometry.getAttribute('position'));
    geometry.setIndex(new BufferAttribute(this.data.indices.subarray(face.start, face.start + face.count), 1));
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = 20;
    return mesh;
  }

  /** Trait épais de surlignage d'une arête. */
  edgeOverlay(edgeIndex: number, material: LineMaterial): LineSegments2 | null {
    const edge = this.data.edges[edgeIndex];
    if (!edge) return null;
    const positions = this.data.edgePositions.subarray(edge.start * 3, (edge.start + edge.count) * 3);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(Array.from(positions));
    const line = new LineSegments2(geometry, material);
    line.renderOrder = 21;
    return line;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.faces.geometry.dispose();
    for (const m of ([] as Material[]).concat(this.faces.material)) m.dispose();
    this.edges.geometry.dispose();
    (this.edges.material as Material).dispose();
    if (this.hiddenEdges) (this.hiddenEdges.material as Material).dispose();
    for (const m of this.markings) {
      m.geometry.dispose();
      (m.material as Material).dispose();
    }
  }
}

/**
 * Couches d'impression 3D : des cordons empilés selon l'axe Z de la pièce (sens d'impression),
 * dessinés par le shader (relief et sillon assombri), sans toucher à la géométrie. Absents des faces
 * horizontales ; ils s'estompent quand ils deviennent plus fins qu'un pixel, pour éviter le moiré.
 */
function withLayers(material: MeshStandardMaterial, height: number | undefined): MeshStandardMaterial {
  if (!height || height <= 0) return material;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.layerHeight = { value: height };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLayerZ;\nvarying float vLayerNz;\nvarying vec3 vLayerAxis;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLayerZ = position.z;\nvLayerNz = normal.z;\nvLayerAxis = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float layerHeight;\nvarying float vLayerZ;\nvarying float vLayerNz;\nvarying vec3 vLayerAxis;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float layerZ = vLayerZ / layerHeight;
        float layerW = fwidth(layerZ);
        float layerOn = (1.0 - smoothstep(0.85, 0.98, abs(vLayerNz))) * (1.0 - smoothstep(0.25, 0.6, layerW));
        float layerF = fract(layerZ);
        // Cordon arrondi : la normale penche vers le haut puis vers le bas sur chaque couche.
        normal = normalize(normal + vLayerAxis * (0.55 * layerOn * cos(3.14159265 * layerF)));
        float layerGroove = 1.0 - smoothstep(0.0, 0.18 + layerW, min(layerF, 1.0 - layerF));
        diffuseColor.rgb *= 1.0 - 0.22 * layerGroove * layerOn;`,
      );
  };
  material.customProgramCacheKey = () => `layers-${height}`;
  return material;
}
