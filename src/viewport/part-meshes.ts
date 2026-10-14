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

export class PartObject {
  readonly group = new Group();
  readonly faces: Mesh;
  /** Arêtes en lignes épaisses (épaisseur en pixels réglable). */
  readonly edges: LineSegments2;
  /** Premier triangle de chaque face, pour retrouver la face d'un triangle touché. */
  private readonly faceTriangleStarts: number[];

  constructor(
    readonly partId: Id,
    readonly meshKey: string,
    readonly data: MeshData,
    color: string,
    readonly appearance: PartAppearance,
    palette: ViewportPalette,
    style: DisplayStyle = 'shaded-edges',
    edgeWidth = 1,
  ) {
    // Le mode d'affichage ne concerne que les pièces « normales » (pas les aperçus d'outil, fantômes…).
    const styled = appearance === 'normal' || appearance === 'preview' ? style : 'shaded-edges';
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geometry.setIndex(new BufferAttribute(data.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.faces = new Mesh(geometry, styled === 'shaded-edges' || styled === 'shaded' ? this.faceMaterial(color, appearance, palette) : this.styledFaceMaterial(color, styled, palette));
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
    if (styled === 'hidden-lines') {
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
  }

  private faceMaterial(color: string, appearance: PartAppearance, palette: ViewportPalette): Material {
    const base = { roughness: 0.62, metalness: 0.04, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
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
        return new MeshStandardMaterial({ ...base, color });
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
    (this.faces.material as Material).dispose();
    this.edges.geometry.dispose();
    (this.edges.material as Material).dispose();
    if (this.hiddenEdges) (this.hiddenEdges.material as Material).dispose();
  }
}
