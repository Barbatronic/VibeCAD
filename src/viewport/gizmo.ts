/**
 * Manipulateur visuel (à la façon de FreeCAD et d'Orca) : trois flèches pour déplacer le long de X,
 * Y, Z et trois anneaux pour tourner autour de ces axes, posés sur un point de la pièce. Dessiné
 * par-dessus le modèle, à taille constante à l'écran ; chaque poignée a une zone de clic plus
 * large qu'elle (invisible).
 */
import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type Raycaster,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Vec3 } from '../math/vec';

export type GizmoAxis = 'x' | 'y' | 'z';
export interface GizmoHandle {
  kind: 'move' | 'rotate';
  axis: GizmoAxis;
}

/** Couleurs des axes, comme les axes de la vue (X rouge, Y vert, Z bleu) ; jaune : poignée survolée. */
const COLORS: Record<GizmoAxis, number> = { x: 0xe5484d, y: 0x30a46c, z: 0x3e8bff };
const HOVER = 0xf2c200;

export const AXIS_VECTORS: Record<GizmoAxis, Vec3> = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };

export class Gizmo {
  readonly group = new Group();
  private readonly visuals = new Map<string, { mesh: Mesh; color: number }>();
  private readonly hits: Object3D[] = [];
  private hovered: string | null = null;

  constructor() {
    this.group.visible = false;
    this.group.renderOrder = 1000;
    for (const axis of ['x', 'y', 'z'] as const) {
      this.addArrow(axis);
      this.addRing(axis);
    }
  }

  private material(color: number, opacity = 1): MeshBasicMaterial {
    return new MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false });
  }

  /** Oriente un objet dont l'axe propre est Y (cylindre, cône) le long de `axis`. */
  private alongAxis(o: Object3D, axis: GizmoAxis): void {
    if (axis === 'x') o.rotation.z = -Math.PI / 2;
    if (axis === 'z') o.rotation.x = Math.PI / 2;
  }

  private addArrow(axis: GizmoAxis): void {
    const key = `move:${axis}`;
    const arrow = new Group();
    const shaft = new Mesh(new CylinderGeometry(0.018, 0.018, 0.78, 10), this.material(COLORS[axis]));
    shaft.position.y = 0.39 + 0.1;
    const head = new Mesh(new ConeGeometry(0.065, 0.2, 18), this.material(COLORS[axis]));
    head.position.y = 0.98;
    const hit = new Mesh(new CylinderGeometry(0.09, 0.09, 1.0, 8), this.material(0xffffff, 0));
    hit.position.y = 0.6;
    hit.userData.handle = key;
    for (const m of [shaft, head, hit]) m.renderOrder = 1000;
    arrow.add(shaft, head, hit);
    this.alongAxis(arrow, axis);
    this.group.add(arrow);
    this.visuals.set(`${key}:shaft`, { mesh: shaft, color: COLORS[axis] });
    this.visuals.set(`${key}:head`, { mesh: head, color: COLORS[axis] });
    this.hits.push(hit);
  }

  private addRing(axis: GizmoAxis): void {
    const key = `rotate:${axis}`;
    const ring = new Mesh(new TorusGeometry(0.62, 0.014, 8, 72), this.material(COLORS[axis], 0.9));
    const hit = new Mesh(new TorusGeometry(0.62, 0.05, 6, 48), this.material(0xffffff, 0));
    hit.userData.handle = key;
    // Un tore est dans le plan XY (axe Z) : on le tourne pour qu'il entoure `axis`.
    for (const m of [ring, hit]) {
      if (axis === 'x') m.rotation.y = Math.PI / 2;
      if (axis === 'y') m.rotation.x = Math.PI / 2;
      m.renderOrder = 1000;
    }
    this.group.add(ring, hit);
    this.visuals.set(`${key}:ring`, { mesh: ring, color: COLORS[axis] });
    this.hits.push(hit);
  }

  /** Affiche le manipulateur en `origin`, `size` = longueur des flèches (mm) ; anneaux facultatifs. */
  show(origin: Vec3 | null, size: number, rings: boolean): void {
    this.group.visible = !!origin;
    if (!origin) return;
    this.group.position.set(origin.x, origin.y, origin.z);
    this.group.scale.setScalar(size);
    for (const [key, v] of this.visuals) if (key.startsWith('rotate:')) v.mesh.visible = rings;
    for (const h of this.hits) h.visible = rings || !(h.userData.handle as string).startsWith('rotate:');
  }

  /** Poignée sous le rayon, ou null. */
  pick(raycaster: Raycaster): GizmoHandle | null {
    if (!this.group.visible) return null;
    const hit = raycaster.intersectObjects(this.hits.filter((h) => h.visible), false)[0];
    const key = hit?.object.userData.handle as string | undefined;
    if (!key) return null;
    const [kind, axis] = key.split(':') as [GizmoHandle['kind'], GizmoAxis];
    return { kind, axis };
  }

  /** Met en évidence la poignée survolée (ou rien). Vrai si l'affichage change. */
  highlight(handle: GizmoHandle | null): boolean {
    const key = handle ? `${handle.kind}:${handle.axis}` : null;
    if (key === this.hovered) return false;
    this.hovered = key;
    for (const [k, v] of this.visuals) (v.mesh.material as MeshBasicMaterial).color.setHex(key && k.startsWith(`${key}:`) ? HOVER : v.color);
    return true;
  }

  get origin(): Vector3 {
    return this.group.position;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose();
        (o.material as MeshBasicMaterial).dispose();
      }
    });
  }
}
