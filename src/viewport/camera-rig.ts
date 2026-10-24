/**
 * Caméra de la vue 3D : perspective ou orthographique, vues standard (conventions FreeCAD :
 * Z vers le haut, vue de face depuis −Y), cadrage et transitions douces.
 */
import { Box3, MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type Projection = 'perspective' | 'orthographic';
export type StandardView = 'iso' | 'front' | 'back' | 'top' | 'bottom' | 'right' | 'left';

export const STANDARD_VIEWS: Record<StandardView, { label: string; key: string; dir: [number, number, number]; up: [number, number, number] }> = {
  iso: { label: 'Isométrique', key: '0', dir: [1, -1, 1], up: [0, 0, 1] },
  front: { label: 'Face', key: '1', dir: [0, -1, 0], up: [0, 0, 1] },
  top: { label: 'Dessus', key: '2', dir: [0, 0, 1], up: [0, 1, 0] },
  right: { label: 'Droite', key: '3', dir: [1, 0, 0], up: [0, 0, 1] },
  back: { label: 'Arrière', key: '4', dir: [0, 1, 0], up: [0, 0, 1] },
  bottom: { label: 'Dessous', key: '5', dir: [0, 0, -1], up: [0, -1, 0] },
  left: { label: 'Gauche', key: '6', dir: [-1, 0, 0], up: [0, 0, 1] },
};

const FOV = 35;

interface Transition {
  fromPos: Vector3;
  toPos: Vector3;
  fromTarget: Vector3;
  toTarget: Vector3;
  fromUp: Vector3;
  toUp: Vector3;
  fromZoom: number;
  toZoom: number;
  start: number;
  duration: number;
}

export class CameraRig {
  readonly perspective: PerspectiveCamera;
  readonly orthographic: OrthographicCamera;
  readonly controls: OrbitControls;
  projection: Projection = 'perspective';
  private width = 1;
  private height = 1;
  /** Place cachée à gauche, à droite et en haut par les panneaux et la barre flottants (px) : le centre de la vue et le cadrage portent sur la zone libre. */
  private insetLeft = 0;
  private insetRight = 0;
  private insetTop = 0;
  private transition: Transition | null = null;

  constructor(domElement: HTMLElement, private readonly onChange: () => void) {
    this.perspective = new PerspectiveCamera(FOV, 1, 0.1, 100000);
    this.orthographic = new OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    for (const cam of [this.perspective, this.orthographic]) cam.up.set(0, 0, 1);
    this.perspective.position.set(160, -200, 140);
    this.controls = new OrbitControls(this.perspective, domElement);
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(30, 15, 0);
    this.controls.update();
    // Écouteur ajouté après l'initialisation : la vue n'est pas encore prête pendant le constructeur.
    this.controls.addEventListener('change', () => {
      this.syncClipping();
      this.onChange();
    });
  }

  get camera(): PerspectiveCamera | OrthographicCamera {
    return this.projection === 'perspective' ? this.perspective : this.orthographic;
  }

  get target(): Vector3 {
    return this.controls.target;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.applyView();
  }

  /** Panneaux et barre posés sur la vue : le centre de projection passe au milieu de la zone libre. */
  setInsets(left: number, right: number, top = 0): void {
    const l = Math.max(0, Math.round(left));
    const r = Math.max(0, Math.round(right));
    const t = Math.max(0, Math.round(top));
    if (l === this.insetLeft && r === this.insetRight && t === this.insetTop) return;
    this.insetLeft = l;
    this.insetRight = r;
    this.insetTop = t;
    this.applyView();
  }

  /** Cadre complet : la vue en est une partie, décalée pour centrer la zone libre. */
  private fullWidth(): number {
    return this.width + Math.abs(this.insetLeft - this.insetRight);
  }

  private fullHeight(): number {
    return this.height + this.insetTop;
  }

  private applyView(): void {
    const d = this.insetLeft - this.insetRight;
    const full = this.fullWidth();
    const fullH = this.fullHeight();
    this.perspective.aspect = full / fullH;
    for (const cam of [this.perspective, this.orthographic]) {
      if (d === 0 && this.insetTop === 0) cam.clearViewOffset();
      else cam.setViewOffset(full, fullH, (Math.abs(d) - d) / 2, 0, this.width, this.height);
    }
    this.perspective.updateProjectionMatrix();
    this.updateOrthoFrustum();
    this.onChange();
  }

  private distance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  private updateOrthoFrustum(distance = this.distance()): void {
    const halfH = distance * Math.tan(MathUtils.degToRad(FOV / 2));
    const halfW = halfH * (this.fullWidth() / this.fullHeight());
    this.orthographic.left = -halfW;
    this.orthographic.right = halfW;
    this.orthographic.top = halfH;
    this.orthographic.bottom = -halfH;
    this.orthographic.updateProjectionMatrix();
  }

  private syncClipping(): void {
    const d = this.distance();
    this.perspective.near = Math.max(0.01, d / 2000);
    this.perspective.far = d * 2000 + 1000;
    this.perspective.updateProjectionMatrix();
  }

  /** Passe en perspective ou en projection orthographique sans changer le cadrage apparent. */
  setProjection(projection: Projection): void {
    if (projection === this.projection) return;
    const from = this.camera;
    const to = projection === 'perspective' ? this.perspective : this.orthographic;
    const target = this.controls.target.clone();
    if (projection === 'orthographic') {
      to.position.copy(from.position);
      to.up.copy(from.up);
      this.updateOrthoFrustum(from.position.distanceTo(target));
      this.orthographic.zoom = 1;
    } else {
      // La distance équivalente au zoom orthographique courant.
      const dir = from.position.clone().sub(target).normalize();
      const d = from.position.distanceTo(target) / this.orthographic.zoom;
      to.position.copy(target).addScaledVector(dir, d);
      to.up.copy(from.up);
    }
    to.lookAt(target);
    to.updateProjectionMatrix();
    this.projection = projection;
    this.controls.object = to;
    this.controls.update();
    this.onChange();
  }

  /** Taille d'un pixel écran en mm, à la profondeur de la cible. */
  pixelSize(): number {
    if (this.projection === 'orthographic') {
      return (this.orthographic.top - this.orthographic.bottom) / this.orthographic.zoom / this.fullHeight();
    }
    const d = this.distance();
    return (2 * d * Math.tan(MathUtils.degToRad(FOV / 2))) / this.fullHeight();
  }

  /** Oriente la caméra selon une direction (de la cible vers la caméra) et un haut d'écran. */
  look(direction: Vector3, up: Vector3, target: Vector3, distance: number, animate = true): void {
    const toPos = target.clone().addScaledVector(direction.clone().normalize(), distance);
    let zoom = this.orthographic.zoom;
    if (this.projection === 'orthographic') {
      // Nouveau cadre orthographique, avec un zoom de départ équivalent (pas de saut visuel).
      const oldHalf = this.orthographic.top;
      this.updateOrthoFrustum(distance);
      this.orthographic.zoom *= this.orthographic.top / oldHalf;
      this.orthographic.updateProjectionMatrix();
      zoom = 1;
    }
    if (!animate) {
      this.camera.position.copy(toPos);
      this.camera.up.copy(up);
      this.controls.target.copy(target);
      this.orthographic.zoom = zoom;
      this.orthographic.updateProjectionMatrix();
      this.camera.lookAt(target);
      this.controls.update();
      this.onChange();
      return;
    }
    this.transition = {
      fromPos: this.camera.position.clone(),
      toPos,
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      fromUp: this.camera.up.clone(),
      toUp: up.clone(),
      fromZoom: this.orthographic.zoom,
      toZoom: zoom,
      start: performance.now(),
      duration: 320,
    };
    this.controls.enabled = false;
    this.onChange();
  }

  setStandardView(view: StandardView, bounds: Box3 | null, animate = true): void {
    const v = STANDARD_VIEWS[view];
    const { center, distance } = this.framing(bounds);
    this.look(new Vector3(...v.dir), new Vector3(...v.up), center, distance, animate);
  }

  /** Vue depuis une direction quelconque (cube de navigation : face, arête, coin), cadrée sur la boîte. */
  setViewDirection(direction: Vector3, up: Vector3, bounds: Box3 | null, animate = true): void {
    const { center, distance } = this.framing(bounds);
    this.look(direction, up, center, distance, animate);
  }

  /** Cadre la boîte donnée en conservant l'orientation actuelle. */
  fit(bounds: Box3 | null, animate = true): void {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const { center, distance } = this.framing(bounds);
    this.look(dir, this.camera.up.clone(), center, distance, animate);
  }

  private framing(bounds: Box3 | null): { center: Vector3; distance: number } {
    const box = bounds && !bounds.isEmpty() ? bounds : new Box3(new Vector3(-30, -30, 0), new Vector3(30, 30, 10));
    const center = box.getCenter(new Vector3());
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 5);
    const fov = MathUtils.degToRad(FOV);
    // Zone libre entre les panneaux et sous la barre ; angle par pixel du cadre complet.
    const freeW = Math.max(this.width * 0.3, this.width - this.insetLeft - this.insetRight);
    const freeH = Math.max(this.height * 0.3, this.height - this.insetTop);
    const perPixel = Math.tan(fov / 2) / (this.fullHeight() / 2);
    const half = Math.atan((perPixel * Math.min(freeW, freeH)) / 2);
    return { center, distance: (radius / Math.sin(half)) * 1.1 };
  }

  /** Avance la transition en cours ; renvoie vrai si une image doit être redessinée. */
  tick(now: number): boolean {
    const t = this.transition;
    if (!t) return false;
    const k = Math.min(1, (now - t.start) / t.duration);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const cam = this.camera;
    cam.position.lerpVectors(t.fromPos, t.toPos, e);
    this.controls.target.lerpVectors(t.fromTarget, t.toTarget, e);
    cam.up.lerpVectors(t.fromUp, t.toUp, e).normalize();
    if (this.projection === 'orthographic') {
      this.orthographic.zoom = MathUtils.lerp(t.fromZoom, t.toZoom, e);
      this.orthographic.updateProjectionMatrix();
    }
    cam.lookAt(this.controls.target);
    if (k >= 1) {
      this.transition = null;
      this.controls.enabled = true;
      this.controls.update();
    }
    this.syncClipping();
    return true;
  }

  get animating(): boolean {
    return this.transition !== null;
  }

  dispose(): void {
    this.controls.dispose();
  }
}
