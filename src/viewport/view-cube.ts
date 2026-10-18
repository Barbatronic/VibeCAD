/**
 * Cube de navigation (coin inférieur gauche de la vue) : il tourne avec la caméra ; un clic sur
 * une face, une arête ou un coin oriente la vue dans cette direction (vue de face, vue d'une
 * arête, vue isométrique d'un coin). Conventions FreeCAD : Z vers le haut, la face « Face » regarde
 * vers −Y.
 *
 * Le cube 2 × 2 × 2 est découpé en 3 × 3 × 3 morceaux (sans celui du centre) : 6 faces, 12 arêtes,
 * 8 coins ; chaque morceau porte sa direction (i, j, k) ∈ {−1, 0, 1}³.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from 'three';
import type { ViewportPalette } from './colors';

/** Largeur des arêtes et coins (le cube va de −1 à 1). */
const BEVEL = 0.32;

const FACE_NAMES: Record<string, string> = {
  '0,0,1': 'Dessus',
  '0,0,-1': 'Dessous',
  '0,-1,0': 'Face',
  '0,1,0': 'Arrière',
  '1,0,0': 'Droite',
  '-1,0,0': 'Gauche',
};

export interface ViewCubePiece {
  dir: [number, number, number];
  mesh: Mesh<BoxGeometry, MeshBasicMaterial>;
  /** Nom des vues voisines (« Face », « Face + Dessus »…), pour l'infobulle. */
  label: string;
}

/** Haut de l'écran pour une direction de vue : +Z, sauf vue de dessus (+Y) ou de dessous (−Y). */
export function viewUp(dir: [number, number, number]): Vector3 {
  if (dir[0] === 0 && dir[1] === 0) return new Vector3(0, dir[2] > 0 ? 1 : -1, 0);
  return new Vector3(0, 0, 1);
}

export class ViewCube {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-2.45, 2.45, 2.45, -2.45, 0.1, 20);
  readonly pieces: ViewCubePiece[] = [];
  private hovered: ViewCubePiece | null = null;
  private readonly raycaster = new Raycaster();
  private colors = { face: new Color(), edge: new Color(), hover: new Color() };

  constructor(palette: ViewportPalette) {
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          if (!i && !j && !k) continue;
          const size = [i, j, k].map((d) => (d ? BEVEL : 2 - 2 * BEVEL)) as [number, number, number];
          const geometry = new BoxGeometry(...size);
          const mesh = new Mesh(geometry, new MeshBasicMaterial());
          mesh.position.set(...([i, j, k].map((d) => d * (1 - BEVEL / 2)) as [number, number, number]));
          const outline = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ transparent: true, opacity: 0.35 }));
          mesh.add(outline);
          this.scene.add(mesh);
          const dir: [number, number, number] = [i, j, k];
          const names = [
            [i, 0, 0],
            [0, j, 0],
            [0, 0, k],
          ]
            .filter((d) => d.some(Boolean))
            .map((d) => FACE_NAMES[d.join(',')]!);
          this.pieces.push({ dir, mesh, label: names.join(' + ') });
        }
    // Noms des faces, lisibles quand on regarde la face de l'extérieur, le haut de l'écran en haut.
    for (const [key, name] of Object.entries(FACE_NAMES)) {
      const n = new Vector3(...(key.split(',').map(Number) as [number, number, number]));
      const up = viewUp(key.split(',').map(Number) as [number, number, number]);
      const right = up.clone().cross(n);
      const label = new Mesh(new PlaneGeometry(2 - 2 * BEVEL, 2 - 2 * BEVEL), new MeshBasicMaterial({ transparent: true, depthWrite: false }));
      label.applyMatrix4(new Matrix4().makeBasis(right, up, n).setPosition(n.clone().multiplyScalar(1.004)));
      label.userData.name = name;
      label.renderOrder = 1;
      this.scene.add(label);
    }
    // Axes X, Y, Z le long des arêtes qui partent du coin (−1, −1, −1).
    const corner = new Vector3(-1.02, -1.02, -1.02);
    (['x', 'y', 'z'] as const).forEach((axis, a) => {
      const d = new Vector3(a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0);
      const geometry = new BufferGeometry().setFromPoints([corner, corner.clone().addScaledVector(d, 2.55)]);
      const line = new LineSegments(geometry, new LineBasicMaterial({ depthTest: false }));
      line.userData.axis = axis;
      line.renderOrder = 2;
      this.scene.add(line);
      const sprite = new Sprite(new SpriteMaterial({ depthTest: false }));
      sprite.position.copy(corner.clone().addScaledVector(d, 2.85));
      sprite.scale.set(0.5, 0.5, 1);
      sprite.userData.axis = axis;
      sprite.renderOrder = 3;
      this.scene.add(sprite);
    });
    this.setPalette(palette);
  }

  /** Couleurs selon le thème : faces claires (ou sombres) bien visibles sur le fond de la vue. */
  setPalette(palette: ViewportPalette): void {
    const dark = new Color(palette.background).getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
    this.colors = {
      face: new Color(dark ? '#4a5566' : '#ffffff'),
      edge: new Color(dark ? '#3a4352' : '#dfe5ee'),
      hover: new Color(palette.hover),
    };
    const ink = dark ? '#eef2f7' : '#2b3442';
    for (const p of this.pieces) {
      p.mesh.material.color.copy(p === this.hovered ? this.colors.hover : p.dir.filter(Boolean).length === 1 ? this.colors.face : this.colors.edge);
      ((p.mesh.children[0] as LineSegments).material as LineBasicMaterial).color.set(ink);
    }
    const axisColor = { x: palette.axisX, y: palette.axisY, z: palette.axisZ };
    for (const o of this.scene.children) {
      if (o.userData.name) {
        const m = (o as Mesh).material as MeshBasicMaterial;
        m.map?.dispose();
        m.map = labelTexture(o.userData.name as string, ink);
        m.needsUpdate = true;
      }
      const axis = o.userData.axis as 'x' | 'y' | 'z' | undefined;
      if (axis && o instanceof LineSegments) (o.material as LineBasicMaterial).color.set(axisColor[axis]);
      if (axis && o instanceof Sprite) {
        o.material.map?.dispose();
        o.material.map = letterTexture(axis.toUpperCase(), axisColor[axis]);
        o.material.needsUpdate = true;
      }
    }
  }

  /** Oriente le cube comme la vue (direction de la caméra vers la cible, haut de l'écran). */
  sync(viewDir: Vector3, up: Vector3): void {
    this.camera.position.copy(viewDir).normalize().multiplyScalar(6);
    this.camera.up.copy(up);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  /** Morceau sous un point du cube (coordonnées normalisées −1 → 1 dans son carré). */
  pick(ndc: { x: number; y: number }): ViewCubePiece | null {
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.camera);
    const hit = this.raycaster.intersectObjects(
      this.pieces.map((p) => p.mesh),
      false,
    )[0];
    return hit ? (this.pieces.find((p) => p.mesh === hit.object) ?? null) : null;
  }

  /** Surligne le morceau survolé ; renvoie vrai si cela change l'image. */
  hover(piece: ViewCubePiece | null): boolean {
    if (piece === this.hovered) return false;
    const old = this.hovered;
    this.hovered = piece;
    if (old) old.mesh.material.color.copy(old.dir.filter(Boolean).length === 1 ? this.colors.face : this.colors.edge);
    if (piece) piece.mesh.material.color.copy(this.colors.hover);
    return true;
  }

  /** Position (coordonnées normalisées du carré) du centre extérieur d'un morceau : pour les tests. */
  project(dir: [number, number, number]): { x: number; y: number } {
    const p = new Vector3(...dir.map((d) => d * 0.999)).project(this.camera);
    return { x: p.x, y: p.y };
  }
}

function labelTexture(text: string, color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 72;
  do {
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    size -= 4;
  } while (ctx.measureText(text.toUpperCase()).width > 230 && size > 20);
  ctx.fillText(text.toUpperCase(), 128, 132);
  const texture = new CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

function letterTexture(letter: string, color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 32, 34);
  return new CanvasTexture(canvas);
}
