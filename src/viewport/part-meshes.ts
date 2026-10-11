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
  LineBasicMaterial,
  LineSegments,
  Mesh,
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
  readonly edges: LineSegments;
  /** Premier triangle de chaque face, pour retrouver la face d'un triangle touché. */
  private readonly faceTriangleStarts: number[];

  constructor(
    readonly partId: Id,
    readonly meshKey: string,
    readonly data: MeshData,
    color: string,
    readonly appearance: PartAppearance,
    palette: ViewportPalette,
  ) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
    geometry.setIndex(new BufferAttribute(data.indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    this.faces = new Mesh(geometry, this.faceMaterial(color, appearance, palette));
    this.faces.userData = { partId, kind: 'part-faces' };
    const edgeGeometry = new BufferGeometry();
    edgeGeometry.setAttribute('position', new BufferAttribute(data.edgePositions, 3));
    this.edges = new LineSegments(edgeGeometry, this.edgeMaterial(appearance, palette));
    this.edges.userData = { partId, kind: 'part-edges' };
    if (appearance === 'tool-add' || appearance === 'tool-cut') {
      this.faces.renderOrder = 10;
      this.edges.renderOrder = 11;
    }
    this.group.add(this.faces, this.edges);
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

  private edgeMaterial(appearance: PartAppearance, palette: ViewportPalette): LineBasicMaterial {
    const color =
      appearance === 'tool-add' ? palette.previewAdd : appearance === 'tool-cut' ? palette.previewCut : appearance === 'stale' ? palette.stale : palette.edge;
    return new LineBasicMaterial({ color, transparent: appearance !== 'normal', opacity: appearance === 'dimmed' ? 0.35 : appearance === 'ghost' ? 0.2 : 1 });
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
  }
}
