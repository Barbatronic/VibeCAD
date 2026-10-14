/**
 * Vue 3D principale (Three.js). Elle affiche une représentation d'affichage fournie par
 * l'application (maillages, esquisses résolues) et remonte les interactions sous forme
 * d'événements ; elle ne modifie jamais le document.
 */
import {
  AmbientLight,
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Plane,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  TOUCH,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Id, PlaneName } from '../domain/model';
import { formatLength } from '../domain/units';
import type { MeshData } from '../geometry/kernel';
import { frameToWorld, originPlaneFrame, worldToFrame, type Frame3D } from '../math/frame';
import type { Vec2, Vec3 } from '../math/vec';
import { CameraRig, type Projection, type StandardView } from './camera-rig';
import { readPalette, type ViewportPalette } from './colors';
import { AxesView, frameMatrix, PlaneGrid } from './grid';
import { fatLineMaterial, hatchMaterial, PartObject, type DisplayStyle, type PartAppearance } from './part-meshes';
import { SketchView, type SketchRenderInput } from './sketch-render';
import { gridStepFor } from '../sketch/snapping';

/** Durée d'un aller-retour de la déformée animée (ms). */
const RESULT_PERIOD_MS = 1600;

export type ViewportMode = 'model' | 'pick-support' | 'sketch' | 'feature' | 'measure';

export interface ViewPartInput {
  partId: Id;
  color: string;
  visible: boolean;
  meshKey: string | null;
  mesh: MeshData | null;
  appearance: PartAppearance;
  /** Placement (matrice 4 × 4 par colonnes) : pièces d'un assemblage. */
  matrix?: number[];
}

/** Repère affiché dans la vue (liaison d'assemblage) : origine et axe Z. */
export interface ViewMarker {
  origin: Vec3;
  axis: Vec3;
  role: 'base' | 'moving';
  /** Aperçu (repère sous la souris pendant la création d'une liaison) : trait plus fin. */
  preview?: boolean;
  /** Étiquette affichée au bout de l'axe. */
  label?: string;
}

export interface ViewToolInput {
  key: string;
  mesh: MeshData;
  kind: 'add' | 'cut';
}

export interface ViewSelection {
  partId: Id;
  kind: 'face' | 'edge';
  index: number;
}

export interface ViewportInput {
  mode: ViewportMode;
  parts: ViewPartInput[];
  tool: ViewToolInput | null;
  sketches: (SketchRenderInput & { key: string })[];
  session: SketchRenderInput | null;
  selection: ViewSelection[];
  measure: { a: Vec3; b: Vec3; label: string } | null;
  /** Pendant l'édition d'une opération : la vue accepte les clics sur arêtes et faces (congé…). */
  featurePicking?: boolean;
  /** Compteur de demandes de cadrage : la vue cadre le contenu quand il change. */
  fitRequest?: number;
  /** Repères des liaisons à montrer (assemblage). */
  markers?: ViewMarker[];
  /** Volumes à signaler (collisions d'un assemblage), en rouge, visibles à travers les pièces. */
  highlightMeshes?: { key: string; mesh: MeshData }[];
  /** Points remarquables (centre de gravité), avec une étiquette. */
  points?: { at: Vec3; label: string }[];
  /** Mode d'affichage des pièces (ombré, arêtes cachées, fil de fer…). */
  displayStyle?: DisplayStyle;
  /** Points d'accroche cliquables (points seuls des esquisses, pendant la création d'une liaison). */
  anchors?: { key: string; at: Vec3; title: string }[];
  /** Vue en coupe : faces de coupe, hachurées. */
  sectionFaces?: ViewSelection[];
  /** Face verrouillée (touche Maj maintenue) : le survol et le clic désignent le sommet le plus proche. */
  lockedFace?: { partId: Id; index: number } | null;
  /** Clés des pièces qu'on peut faire glisser à la souris (pièces mobiles d'une liaison). */
  dragTargets?: string[];
  /** Plateau d'impression (mm) dessiné à z = 0 à partir de l'origine. */
  bed?: { x: number; y: number } | null;
  /** Simulation : faces fixées (bleu) et chargées (orange), hachurées. */
  markedFaces?: { partId: Id; index: number; role: 'fixed' | 'load' }[];
  /**
   * Simulation : pièce déformée, une couleur par sommet (rouge, vert, bleu entre 0 et 1).
   * `animation` : la pièce va et vient entre sa forme d'origine (`base`) et la déformée
   * (`base + scale × displacement`).
   */
  /** Plans de construction à montrer (rectangle translucide nommé), `active` : celui en cours de modification. */
  datumPlanes?: { key: string; frame: Frame3D; label: string; active?: boolean }[];
  /** Axes de construction à montrer (trait mixte nommé), `active` : celui en cours de modification. */
  datumAxes?: { key: string; point: Vec3; dir: Vec3; label: string; active?: boolean }[];
  resultMesh?: {
    key: string;
    positions: Float32Array;
    colors: Float32Array;
    indices: Uint32Array;
    animation?: { base: Float32Array; displacement: Float32Array; scale: number };
  } | null;
}

export interface AssemblyDragEvent {
  phase: 'start' | 'move' | 'end';
  key: string;
  ray: { origin: Vec3; direction: Vec3 };
  shift: boolean;
  /** Au départ : point de la pièce attrapé (monde). */
  point?: Vec3;
}

export interface ModelPick {
  partId: Id;
  /** `vertex` : sommet d'une face verrouillée (`index` = rang de la face, `point` = le sommet). */
  kind: 'face' | 'edge' | 'vertex';
  index: number;
  point: Vec3;
}

export interface ViewportEvents {
  onPick(pick: ModelPick | null, info: { shift: boolean; double: boolean }): void;
  onHover(pick: ModelPick | null): void;
  onPlanePick(plane: PlaneName): void;
  onSketchPointer(type: 'move' | 'down' | 'up' | 'leave', p: Vec2, mods: { shift: boolean; alt: boolean; double?: boolean }): void;
  onSketchLabel(constraintId: string, action: 'select' | 'edit', additive: boolean): void;
  /** Clic sur un point d'accroche (points d'esquisse proposés pendant la création d'une liaison). */
  onAnchorPick?(key: string): void;
  /** Glisser du libellé d'une cote (position en coordonnées d'esquisse). */
  onSketchLabelDrag?(constraintId: string, phase: 'move' | 'end', p: Vec2 | null): void;
  onSketchScale(pixelSize: number): void;
  onViewChange(): void;
  onContextLost(): void;
  /** Glisser d'une pièce d'assemblage (le mouvement est contraint par sa liaison). */
  onAssemblyDrag?(event: AssemblyDragEvent): void;
}

const EDGE_PICK_PX = 6;
const CLICK_MOVE_PX = 5;

function emptyInput(): ViewportInput {
  return { mode: 'model', parts: [], tool: null, sketches: [], session: null, selection: [], measure: null };
}

export class Viewport {
  private readonly renderer: WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new Scene();
  private readonly rig: CameraRig;
  private palette: ViewportPalette;
  private readonly grid: PlaneGrid;
  private readonly axes: AxesView;
  private readonly headlight = new DirectionalLight(0xffffff, 2.1);
  private readonly partsGroup = new Group();
  private readonly overlayGroup = new Group();
  private readonly planesGroup = new Group();
  private readonly parts = new Map<Id, PartObject>();
  private tool: { key: string; object: PartObject } | null = null;
  private readonly sketchViews = new Map<string, { view: SketchView; signature: string }>();
  private readonly sessionView: SketchView;
  private sessionFrame: Frame3D | null = null;
  private sessionEntityCount = 0;
  private input: ViewportInput = emptyInput();
  private hoverOverlay: Object3D | null = null;
  /** Élément actuellement surligné au survol (« pièce:type:rang ») : inutile de le recréer. */
  private hoverOverlayKey: string | null = null;
  private selectionOverlays: Object3D[] = [];
  private measureObjects: Object3D[] = [];
  private markerObjects: Object3D[] = [];
  private bedObjects: Object3D[] = [];
  private bedKey = '';
  private assemblyDrag: { key: string; moved: boolean } | null = null;
  private planeMeshes: { plane: PlaneName; mesh: Mesh; label: CSS2DObject }[] = [];
  private hoverPlane: PlaneName | null = null;
  private readonly raycaster = new Raycaster();
  private needsRender = true;
  private frameHandle = 0;
  private width = 1;
  private height = 1;
  private down: { x: number; y: number; button: number; time: number } | null = null;
  private lastClick: { x: number; y: number; time: number } | null = null;
  private hoverPending: PointerEvent | null = null;
  private lastPixelSize = 0;
  private lastFitRequest = 0;
  private savedCamera: { position: Vector3; target: Vector3; up: Vector3; projection: Projection } | null = null;
  private readonly gizmo: { scene: Scene; camera: OrthographicCamera };
  private readonly resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: ViewportEvents,
  ) {
    this.palette = readPalette(container);
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'vp-canvas';
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', 'Vue 3D du modèle');
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'vp-labels';
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.inset = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);

    this.rig = new CameraRig(this.renderer.domElement, () => this.onCameraChange());
    this.grid = new PlaneGrid(this.palette);
    this.axes = new AxesView(this.palette);
    this.sessionView = new SketchView(this.palette);

    this.scene.add(new HemisphereLight(0xffffff, 0x8899aa, 1.25));
    this.scene.add(new AmbientLight(0xffffff, 0.25));
    this.scene.add(this.headlight, this.headlight.target);
    this.scene.add(this.grid.group, this.axes.group, this.partsGroup, this.planesGroup, this.overlayGroup, this.sessionView.group);
    this.buildOriginPlanes();
    this.gizmo = this.buildGizmo();

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.rig.setStandardView('iso', null, false);
    this.loop();
  }

  // -------------------------------------------------------------------------
  // Boucle de rendu (à la demande)

  requestRender(): void {
    this.needsRender = true;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.loop);
    const now = performance.now();
    const animating = this.rig.tick(now);
    this.stepResultAnimation(now);
    if (this.hoverPending) {
      const e = this.hoverPending;
      this.hoverPending = null;
      this.updateHover(e);
    }
    if (!this.needsRender && !animating) return;
    this.needsRender = false;
    this.render();
    if (animating) this.events.onViewChange();
  };

  private render(): void {
    const camera = this.rig.camera;
    this.headlight.position.copy(camera.position);
    this.headlight.target.position.copy(this.rig.target);
    this.updateGrid();
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, camera);
    // Repère d'orientation dans le coin inférieur gauche.
    const size = 92;
    const g = this.gizmo;
    const dir = camera.position.clone().sub(this.rig.target).normalize();
    g.camera.position.copy(dir.multiplyScalar(4));
    g.camera.up.copy(camera.up);
    g.camera.lookAt(0, 0, 0);
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(8, 8, size, size);
    this.renderer.setViewport(8, 8, size, size);
    this.renderer.clearDepth();
    this.renderer.render(g.scene, g.camera);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.labelRenderer.render(this.scene, camera);
  }

  private onCameraChange(): void {
    this.needsRender = true;
    const px = this.rig.pixelSize();
    if (this.input.mode === 'sketch' && Math.abs(px - this.lastPixelSize) > this.lastPixelSize * 0.02) {
      this.lastPixelSize = px;
      this.events.onSketchScale(px);
    }
    this.axes.setLength(Math.max(10, px * 90));
    this.events.onViewChange();
  }

  private updateGrid(): void {
    const px = this.rig.pixelSize();
    const frame = this.input.mode === 'sketch' && this.sessionFrame ? this.sessionFrame : originPlaneFrame('XY');
    const step = gridStepFor(px, this.input.mode === 'sketch' ? 14 : 18);
    const target = this.rig.target;
    const center = worldToFrame(frame, { x: target.x, y: target.y, z: target.z });
    // La grille est placée un demi-pixel derrière son plan : pas de conflit de profondeur avec
    // une face posée sur ce plan (ex. le dessous d'une plaque sur XY).
    const n = frame.normal;
    const back = px * 0.6;
    this.grid.update({ ...frame, origin: { x: frame.origin.x - n.x * back, y: frame.origin.y - n.y * back, z: frame.origin.z - n.z * back } }, step, center);
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = `${this.width}px`;
    this.renderer.domElement.style.height = `${this.height}px`;
    this.labelRenderer.setSize(this.width, this.height);
    this.rig.resize(this.width, this.height);
    const res = { width: this.width, height: this.height };
    this.sessionView.setResolution(res.width, res.height);
    for (const { view } of this.sketchViews.values()) view.setResolution(res.width, res.height);
    for (const o of [...this.selectionOverlays, ...this.measureObjects, this.hoverOverlay]) {
      if (o instanceof LineSegments2) (o.material as { resolution: Vector2 }).resolution.set(res.width, res.height);
    }
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Objets fixes

  private buildOriginPlanes(): void {
    // Couleur de chaque plan = couleur de l'axe qui lui est perpendiculaire (XY ↔ Z bleu…).
    const planes: { plane: PlaneName; text: string; color: string }[] = [
      { plane: 'XY', text: 'XY · dessus', color: this.palette.axisZ },
      { plane: 'XZ', text: 'XZ · face', color: this.palette.axisY },
      { plane: 'YZ', text: 'YZ · droite', color: this.palette.axisX },
    ];
    for (const { plane, text, color } of planes) {
      const frame = originPlaneFrame(plane);
      const mesh = new Mesh(
        new PlaneGeometry(1, 1),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.14, side: DoubleSide, depthWrite: false }),
      );
      mesh.matrixAutoUpdate = false;
      mesh.userData = { plane, frame };
      const outline = new LineSegments(
        new BufferGeometry().setAttribute(
          'position',
          new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0], 3),
        ),
        new LineBasicMaterial({ color, transparent: true, opacity: 0.8 }),
      );
      mesh.add(outline);
      const el = document.createElement('span');
      el.className = 'vp-tag vp-tag-plane';
      el.textContent = text;
      el.style.color = color;
      el.style.borderColor = color;
      const label = new CSS2DObject(el);
      this.planesGroup.add(mesh, label);
      this.planeMeshes.push({ plane, mesh, label });
    }
    this.planesGroup.visible = false;
  }

  private layoutOriginPlanes(): void {
    const box = this.contentBounds();
    const size = box ? Math.max(30, box.getSize(new Vector3()).length() * 0.7) : 40;
    for (const { plane, mesh, label } of this.planeMeshes) {
      const frame = originPlaneFrame(plane);
      const m = frameMatrix(frame);
      m.scale(new Vector3(size, size, 1));
      // Les plans occupent le quart positif de chaque plan pour ne pas se masquer mutuellement.
      const offset = frameToWorld(frame, { x: size / 2, y: size / 2 });
      m.setPosition(offset.x, offset.y, offset.z);
      mesh.matrix.copy(m);
      mesh.matrixWorldNeedsUpdate = true;
      const at = frameToWorld(frame, { x: size * 0.5, y: size * 0.5 });
      label.position.set(at.x, at.y, at.z);
    }
  }

  private buildGizmo(): { scene: Scene; camera: OrthographicCamera } {
    const scene = new Scene();
    const camera = new OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    const colors = [this.palette.axisX, this.palette.axisY, this.palette.axisZ];
    const dirs = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
    const positions: number[] = [];
    const cols: number[] = [];
    dirs.forEach((d, i) => {
      positions.push(0, 0, 0, d.x, d.y, d.z);
      const c = new Color(colors[i]!);
      cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
      const sprite = new Sprite(new SpriteMaterial({ map: letterTexture('XYZ'[i]!, colors[i]!), depthTest: false }));
      sprite.position.copy(d.clone().multiplyScalar(1.32));
      sprite.scale.set(0.62, 0.62, 1);
      scene.add(sprite);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(cols, 3));
    scene.add(new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true })));
    return { scene, camera };
  }

  // -------------------------------------------------------------------------
  // État affiché

  setInput(input: ViewportInput): void {
    const prevMode = this.input.mode;
    this.input = input;
    this.syncParts(input.parts);
    this.syncTool(input.tool);
    this.syncSketches(input.mode === 'sketch' ? [] : input.sketches);
    this.syncSession(input.session);
    this.syncSelection(input.selection);
    this.syncSectionFaces(input.sectionFaces ?? []);
    this.syncMarkedFaces(input.markedFaces ?? []);
    this.syncResultMesh(input.resultMesh ?? null);
    this.syncPoints(input.points ?? []);
    this.syncAnchors(input.anchors ?? []);
    this.syncDatumPlanes(input.datumPlanes ?? [], input.datumAxes ?? []);
    this.syncHighlightMeshes(input.highlightMeshes ?? []);
    this.syncMeasure(input.measure);
    this.syncMarkers(input.markers ?? []);
    this.syncBed(input.bed ?? null);
    if (input.mode !== prevMode) this.onModeChange(prevMode, input.mode);
    if (input.fitRequest !== undefined && input.fitRequest !== this.lastFitRequest) {
      this.lastFitRequest = input.fitRequest;
      const bounds = this.contentBounds();
      if (bounds && input.mode !== 'sketch') this.rig.fit(bounds);
    }
    this.planesGroup.visible = input.mode === 'pick-support';
    if (this.planesGroup.visible) this.layoutOriginPlanes();
    this.requestRender();
  }

  private onModeChange(prev: ViewportMode, next: ViewportMode): void {
    const controls = this.rig.controls;
    if (next === 'sketch') {
      controls.enableRotate = false;
      controls.mouseButtons = { LEFT: null as unknown as MOUSE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
      controls.touches = { ONE: null as unknown as TOUCH, TWO: TOUCH.DOLLY_PAN };
    } else {
      controls.enableRotate = true;
      controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
      controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    }
    if (prev === 'sketch' && next !== 'sketch') this.restoreCamera();
    this.clearHover();
  }

  private syncParts(parts: ViewPartInput[]): void {
    const seen = new Set<Id>();
    for (const p of parts) {
      seen.add(p.partId);
      const existing = this.parts.get(p.partId);
      const style = this.input.displayStyle ?? 'shaded-edges';
      const signature = `${p.meshKey}|${p.color}|${p.appearance}|${style}`;
      if (!p.mesh || !p.meshKey) {
        if (existing) {
          this.partsGroup.remove(existing.group);
          existing.dispose();
          this.parts.delete(p.partId);
        }
        continue;
      }
      if (!existing || existing.group.userData.signature !== signature) {
        if (existing) {
          this.partsGroup.remove(existing.group);
          existing.dispose();
        }
        const obj = new PartObject(p.partId, p.meshKey, p.mesh, p.color, p.appearance, this.palette, style);
        // Pièce reconstruite : sa surbrillance de survol sera refaite au prochain mouvement.
        if (this.hoverOverlayKey?.startsWith(`${p.partId}:`)) this.hoverOverlayKey = null;
        obj.group.userData.signature = signature;
        this.parts.set(p.partId, obj);
        this.partsGroup.add(obj.group);
      }
      const obj = this.parts.get(p.partId)!;
      obj.setVisible(p.visible);
      if (p.matrix) {
        obj.group.matrixAutoUpdate = false;
        obj.group.matrix.fromArray(p.matrix);
        obj.group.matrixWorldNeedsUpdate = true;
      } else if (!obj.group.matrixAutoUpdate) {
        obj.group.matrixAutoUpdate = true;
        obj.group.matrix.identity();
        obj.group.position.set(0, 0, 0);
        obj.group.matrixWorldNeedsUpdate = true;
      }
    }
    for (const [id, obj] of this.parts) {
      if (!seen.has(id)) {
        this.partsGroup.remove(obj.group);
        obj.dispose();
        this.parts.delete(id);
      }
    }
  }

  private syncTool(tool: ViewToolInput | null): void {
    if (this.tool && (!tool || tool.key !== this.tool.key)) {
      this.overlayGroup.remove(this.tool.object.group);
      this.tool.object.dispose();
      this.tool = null;
    }
    if (tool && !this.tool) {
      const object = new PartObject('tool', tool.key, tool.mesh, '#ffffff', tool.kind === 'add' ? 'tool-add' : 'tool-cut', this.palette);
      this.overlayGroup.add(object.group);
      this.tool = { key: tool.key, object };
    }
  }

  private syncSketches(sketches: (SketchRenderInput & { key: string })[]): void {
    const seen = new Set<string>();
    const px = this.rig.pixelSize();
    for (const s of sketches) {
      seen.add(s.key);
      const signature = JSON.stringify([s.frame, s.sketch.entities, s.highlightPoints, s.emphasis]);
      const existing = this.sketchViews.get(s.key);
      if (existing && existing.signature === signature) continue;
      const view = existing?.view ?? new SketchView(this.palette);
      if (!existing) this.scene.add(view.group);
      view.update(s, px, { width: this.width, height: this.height });
      this.sketchViews.set(s.key, { view, signature });
    }
    for (const [key, { view }] of this.sketchViews) {
      if (!seen.has(key)) {
        this.scene.remove(view.group);
        view.dispose();
        this.sketchViews.delete(key);
      }
    }
  }

  private syncSession(session: SketchRenderInput | null): void {
    if (!session) {
      this.sessionView.clear();
      this.sessionFrame = null;
      this.sessionEntityCount = 0;
      return;
    }
    const enteringSketch = !this.sessionFrame;
    this.sessionFrame = session.frame;
    if (enteringSketch) this.alignToSketch(session);
    else if (session.sketch.entities.length > this.sessionEntityCount) this.fitSketchIfOutside(session);
    this.sessionEntityCount = session.sketch.entities.length;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.constraint : undefined;
    this.sessionView.update(session, this.rig.pixelSize(), { width: this.width, height: this.height });
    if (focused) {
      const el = this.labelRenderer.domElement.querySelector<HTMLElement>(`[data-constraint="${focused}"]`);
      el?.focus({ preventScroll: true });
    }
  }

  /** Vue normale au plan de l'esquisse, en projection orthographique. */
  private alignToSketch(session: SketchRenderInput): void {
    const cam = this.rig.camera;
    this.savedCamera = {
      position: cam.position.clone(),
      target: this.rig.target.clone(),
      up: cam.up.clone(),
      projection: this.rig.projection,
    };
    this.rig.setProjection('orthographic');
    const f = session.frame;
    let center: Vec2 = { x: 0, y: 0 };
    let radius = 40;
    const pts = session.sketch.entities.flatMap((e) => (e.type === 'point' ? [e] : []));
    if (pts.length > 0) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      radius = Math.max(20, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.75);
    } else {
      const box = this.contentBounds();
      radius = box ? Math.max(55, box.getSize(new Vector3()).length() * 0.6) : 55;
      center = { x: radius * 0.55, y: radius * 0.3 };
    }
    const target = frameToWorld(f, center);
    this.rig.look(new Vector3(f.normal.x, f.normal.y, f.normal.z), new Vector3(f.yAxis.x, f.yAxis.y, f.yAxis.z), new Vector3(target.x, target.y, target.z), radius * 2.6, true);
    this.lastPixelSize = 0;
  }

  /** Recadre l'esquisse si un nouvel élément sort de la vue (ex. rectangle tapé au clavier). */
  private fitSketchIfOutside(session: SketchRenderInput): void {
    const margin = 40;
    const outside = session.sketch.entities.some((e) => {
      if (e.type !== 'point') return false;
      const p = this.projectSketchPoint(session.frame, e);
      return p.x < margin || p.y < margin || p.x > this.width - margin || p.y > this.height - margin;
    });
    if (!outside) return;
    const saved = this.savedCamera;
    this.alignToSketch(session);
    this.savedCamera = saved;
  }

  /** Revient à la vue normale de l'esquisse en cours (bouton « Vue normale »). */
  lookAtSketch(): void {
    if (!this.sessionFrame || this.input.mode !== 'sketch' || !this.input.session) return;
    const saved = this.savedCamera;
    this.alignToSketch(this.input.session);
    this.savedCamera = saved;
  }

  private restoreCamera(): void {
    const saved = this.savedCamera;
    this.savedCamera = null;
    if (!saved) return;
    this.rig.setProjection(saved.projection);
    const dir = saved.position.clone().sub(saved.target);
    this.rig.look(dir, saved.up, saved.target, dir.length(), true);
  }

  private syncSelection(selection: ViewSelection[]): void {
    for (const o of this.selectionOverlays) this.disposeOverlay(o);
    this.selectionOverlays = [];
    for (const sel of selection) {
      const part = this.parts.get(sel.partId);
      if (!part) continue;
      const overlay =
        sel.kind === 'face'
          ? part.faceOverlay(sel.index, hatchMaterial(this.palette.selection, 0.8))
          : part.edgeOverlay(sel.index, this.resolved(fatLineMaterial(this.palette.selection, 4, { depthTest: false })));
      if (overlay) {
        this.placeOverlay(overlay, part);
        this.overlayGroup.add(overlay);
        this.selectionOverlays.push(overlay);
      }
    }
  }

  private highlightObjects: Object3D[] = [];
  private highlightKey = '';

  private syncHighlightMeshes(items: { key: string; mesh: MeshData }[]): void {
    const key = items.map((i) => i.key).join('|');
    if (key === this.highlightKey) return;
    this.highlightKey = key;
    for (const o of this.highlightObjects) {
      o.parent?.remove(o);
      if (o instanceof Mesh) {
        o.geometry.dispose();
        (o.material as Material).dispose();
      }
    }
    this.highlightObjects = [];
    for (const item of items) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(item.mesh.positions, 3));
      geometry.setIndex(Array.from(item.mesh.indices));
      const material = new MeshBasicMaterial({ color: this.palette.previewCut, transparent: true, opacity: 0.6, depthTest: false, side: DoubleSide });
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = 45;
      this.overlayGroup.add(mesh);
      this.highlightObjects.push(mesh);
    }
    this.requestRender();
  }

  private pointObjects: Object3D[] = [];
  private pointsKey = '';

  /** Symbole du centre de gravité : cercle à quartiers, visible à travers la pièce. */
  private anchorObjects: Object3D[] = [];
  private anchorsKey = '';

  /** Pastilles cliquables posées sur les points d'accroche (au-dessus des pièces). */
  private syncAnchors(anchors: NonNullable<ViewportInput['anchors']>): void {
    const key = JSON.stringify(anchors);
    if (key === this.anchorsKey) return;
    this.anchorsKey = key;
    for (const o of this.anchorObjects) this.disposeOverlay(o);
    this.anchorObjects = [];
    for (const a of anchors) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'vp-joint-anchor';
      el.dataset.anchor = a.key;
      el.title = a.title;
      el.setAttribute('aria-label', a.title);
      const o = new CSS2DObject(el);
      o.position.set(a.at.x, a.at.y, a.at.z);
      this.overlayGroup.add(o);
      this.anchorObjects.push(o);
    }
    this.requestRender();
  }

  private syncPoints(points: { at: Vec3; label: string }[]): void {
    const key = JSON.stringify(points);
    if (key === this.pointsKey) return;
    this.pointsKey = key;
    for (const o of this.pointObjects) this.disposeOverlay(o);
    this.pointObjects = [];
    for (const p of points) {
      const el = document.createElement('span');
      el.className = 'vp-centroid';
      el.setAttribute('aria-hidden', 'true');
      const tag = document.createElement('span');
      tag.className = 'vp-tag vp-tag-centroid';
      tag.textContent = p.label;
      const symbol = new CSS2DObject(el);
      symbol.position.set(p.at.x, p.at.y, p.at.z);
      const label = new CSS2DObject(tag);
      label.position.set(p.at.x, p.at.y, p.at.z);
      this.overlayGroup.add(symbol, label);
      this.pointObjects.push(symbol, label);
    }
    this.requestRender();
  }

  private datumObjects: Object3D[] = [];
  private datumKey = '';

  /**
   * Plans de construction : un carré translucide centré sur la projection du milieu de la pièce,
   * à la taille de la pièce, avec son nom.
   */
  private syncDatumPlanes(planes: NonNullable<ViewportInput['datumPlanes']>, axes: NonNullable<ViewportInput['datumAxes']>): void {
    const box = this.partsBounds();
    const center = box ? box.getCenter(new Vector3()) : new Vector3();
    const size = box ? Math.max(30, box.getSize(new Vector3()).length() * 0.8) : 40;
    const key = JSON.stringify([planes, axes, center.toArray().map((v) => Math.round(v)), Math.round(size)]);
    if (key === this.datumKey) return;
    this.datumKey = key;
    for (const o of this.datumObjects) {
      o.parent?.remove(o);
      o.traverse((x) => {
        if (x instanceof Mesh || x instanceof LineSegments) {
          x.geometry.dispose();
          (x.material as Material).dispose();
        }
      });
    }
    this.datumObjects = [];
    for (const p of planes) {
      const color = p.active ? this.palette.selection : this.palette.axisZ;
      const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color, transparent: true, opacity: p.active ? 0.22 : 0.1, side: DoubleSide, depthWrite: false }));
      mesh.matrixAutoUpdate = false;
      const outline = new LineSegments(
        new BufferGeometry().setAttribute(
          'position',
          new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0], 3),
        ),
        new LineBasicMaterial({ color, transparent: true, opacity: 0.9 }),
      );
      mesh.add(outline);
      // Centre : le milieu de la pièce ramené sur le plan.
      const local = worldToFrame(p.frame, { x: center.x, y: center.y, z: center.z });
      const at = frameToWorld(p.frame, local);
      const m = frameMatrix(p.frame);
      m.scale(new Vector3(size, size, 1));
      m.setPosition(at.x, at.y, at.z);
      mesh.matrix.copy(m);
      mesh.matrixWorldNeedsUpdate = true;
      mesh.renderOrder = 2;
      const el = document.createElement('span');
      el.className = 'vp-tag vp-tag-plane vp-tag-datum';
      el.textContent = p.label;
      el.style.color = color;
      el.style.borderColor = color;
      const label = new CSS2DObject(el);
      const corner = frameToWorld(p.frame, { x: local.x + size / 2, y: local.y + size / 2 });
      label.position.set(corner.x, corner.y, corner.z);
      this.overlayGroup.add(mesh, label);
      this.datumObjects.push(mesh, label);
    }
    for (const a of axes) {
      const color = a.active ? this.palette.selection : this.palette.axisZ;
      // Segment centré sur le point de l'axe le plus proche du milieu de la pièce.
      const t = (center.x - a.point.x) * a.dir.x + (center.y - a.point.y) * a.dir.y + (center.z - a.point.z) * a.dir.z;
      const mid = new Vector3(a.point.x + a.dir.x * t, a.point.y + a.dir.y * t, a.point.z + a.dir.z * t);
      const d = new Vector3(a.dir.x, a.dir.y, a.dir.z).multiplyScalar(size * 0.6);
      const p1 = mid.clone().sub(d);
      const p2 = mid.clone().add(d);
      const line = new LineSegments(
        new BufferGeometry().setAttribute('position', new Float32BufferAttribute([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z], 3)),
        new LineDashedMaterial({ color, dashSize: size * 0.06, gapSize: size * 0.025, transparent: true, opacity: 0.95 }),
      );
      line.computeLineDistances();
      line.renderOrder = 3;
      const el = document.createElement('span');
      el.className = 'vp-tag vp-tag-plane vp-tag-datum';
      el.textContent = a.label;
      el.style.color = color;
      el.style.borderColor = color;
      const label = new CSS2DObject(el);
      label.position.copy(p2);
      this.overlayGroup.add(line, label);
      this.datumObjects.push(line, label);
    }
    this.requestRender();
  }

  private sectionOverlays: Object3D[] = [];
  private sectionKey = '';

  /** Faces de coupe de la vue en coupe, hachurées comme sur un dessin technique. */
  private syncSectionFaces(faces: ViewSelection[]): void {
    const key = faces.map((f) => `${f.partId}:${f.index}`).join('|') + `|${Array.from(this.parts.values()).map((p) => p.meshKey).join(',')}`;
    if (key === this.sectionKey) return;
    this.sectionKey = key;
    for (const o of this.sectionOverlays) this.disposeOverlay(o);
    this.sectionOverlays = [];
    for (const f of faces) {
      const part = this.parts.get(f.partId);
      const overlay = part?.faceOverlay(f.index, hatchMaterial(this.palette.previewCut, 0.75));
      if (overlay && part) {
        this.placeOverlay(overlay, part);
        this.overlayGroup.add(overlay);
        this.sectionOverlays.push(overlay);
      }
    }
  }

  private markedOverlays: Object3D[] = [];
  private markedKey = '';

  private syncMarkedFaces(faces: NonNullable<ViewportInput['markedFaces']>): void {
    const key = faces.map((f) => `${f.partId}:${f.index}:${f.role}`).join('|') + `|${Array.from(this.parts.values()).map((p) => p.meshKey).join(',')}`;
    if (key === this.markedKey) return;
    this.markedKey = key;
    for (const o of this.markedOverlays) this.disposeOverlay(o);
    this.markedOverlays = [];
    for (const f of faces) {
      const part = this.parts.get(f.partId);
      const overlay = part?.faceOverlay(f.index, hatchMaterial(f.role === 'fixed' ? this.palette.axisZ : this.palette.selection, 0.8));
      if (overlay && part) {
        this.placeOverlay(overlay, part);
        this.overlayGroup.add(overlay);
        this.markedOverlays.push(overlay);
      }
    }
  }

  private resultObject: Mesh | null = null;
  private resultKey = '';

  /** Résultat de simulation : maillage coloré par sommet (non cliquable). */
  private syncResultMesh(result: ViewportInput['resultMesh'] | null): void {
    const key = result?.key ?? '';
    if (key === this.resultKey) return;
    this.resultKey = key;
    this.resultAnimation = null;
    if (this.resultObject) {
      this.resultObject.parent?.remove(this.resultObject);
      this.resultObject.geometry.dispose();
      (this.resultObject.material as Material).dispose();
      this.resultObject = null;
    }
    if (!result) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(result.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(result.colors, 3));
    geometry.setIndex(Array.from(result.indices));
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: DoubleSide }));
    mesh.renderOrder = 2;
    this.overlayGroup.add(mesh);
    this.resultObject = mesh;
    // Les normales restent celles de la déformée complète : les recalculer à chaque image coûterait
    // cher pour une différence à peine visible.
    if (result.animation) this.resultAnimation = { ...result.animation, start: performance.now() };
  }

  /** Animation de la déformée (aller-retour). */
  private resultAnimation: { base: Float32Array; displacement: Float32Array; scale: number; start: number } | null = null;

  private stepResultAnimation(now: number): void {
    const anim = this.resultAnimation;
    const attr = this.resultObject?.geometry.getAttribute('position');
    if (!anim || !attr) return;
    const f = (anim.scale * (1 - Math.cos(((now - anim.start) / RESULT_PERIOD_MS) * 2 * Math.PI))) / 2;
    const out = attr.array as Float32Array;
    for (let k = 0; k < out.length; k++) out[k] = anim.base[k]! + f * anim.displacement[k]!;
    attr.needsUpdate = true;
    this.needsRender = true;
  }

  /** Contour du plateau d'impression (et un quadrillage tous les 10 mm). */
  private syncBed(bed: { x: number; y: number } | null): void {
    const key = bed ? `${bed.x}x${bed.y}` : '';
    if (key === this.bedKey) return;
    this.bedKey = key;
    for (const o of this.bedObjects) this.disposeOverlay(o);
    this.bedObjects = [];
    if (!bed) return;
    const outline = [0, 0, 0, bed.x, 0, 0, bed.x, 0, 0, bed.x, bed.y, 0, bed.x, bed.y, 0, 0, bed.y, 0, 0, bed.y, 0, 0, 0, 0];
    const grid: number[] = [];
    for (let x = 10; x < bed.x; x += 10) grid.push(x, 0, 0, x, bed.y, 0);
    for (let y = 10; y < bed.y; y += 10) grid.push(0, y, 0, bed.x, y, 0);
    for (const [pts, color, width] of [
      [grid, this.palette.gridMajor, 1],
      [outline, this.palette.selection, 3],
    ] as const) {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(pts as number[]);
      const line = new LineSegments2(geometry, this.resolved(fatLineMaterial(color, width)));
      line.renderOrder = 5;
      this.overlayGroup.add(line);
      this.bedObjects.push(line);
    }
  }

  /** Repères de liaison : axe (flèche) et petit anneau autour de l'origine. */
  private syncMarkers(markers: ViewMarker[]): void {
    for (const o of this.markerObjects) this.disposeOverlay(o);
    this.markerObjects = [];
    for (const m of markers) {
      const z = new Vector3(m.axis.x, m.axis.y, m.axis.z).normalize();
      const o = new Vector3(m.origin.x, m.origin.y, m.origin.z);
      const tip = o.clone().addScaledVector(z, 18);
      const ref = Math.abs(z.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
      const u = new Vector3().crossVectors(z, ref).normalize();
      const v = new Vector3().crossVectors(z, u);
      const pts: number[] = [o.x, o.y, o.z, tip.x, tip.y, tip.z];
      // Pointe de flèche.
      for (const side of [u, v]) {
        for (const sgn of [1, -1]) {
          const b = tip.clone().addScaledVector(z, -4).addScaledVector(side, 2 * sgn);
          pts.push(tip.x, tip.y, tip.z, b.x, b.y, b.z);
        }
      }
      // Anneau de rayon 4 mm.
      const n = 24;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const b = ((i + 1) / n) * Math.PI * 2;
        const p1 = o.clone().addScaledVector(u, 4 * Math.cos(a)).addScaledVector(v, 4 * Math.sin(a));
        const p2 = o.clone().addScaledVector(u, 4 * Math.cos(b)).addScaledVector(v, 4 * Math.sin(b));
        pts.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(pts);
      const color = m.role === 'base' ? this.palette.selection : this.palette.hover;
      const line = new LineSegments2(geometry, this.resolved(fatLineMaterial(color, m.preview ? 2 : 3, { depthTest: false })));
      line.renderOrder = 41;
      this.overlayGroup.add(line);
      this.markerObjects.push(line);
      if (m.label) {
        const el = document.createElement('span');
        el.className = `vp-tag vp-tag-marker${m.role === 'base' ? ' is-base' : ''}`;
        el.textContent = m.label;
        const label = new CSS2DObject(el);
        label.position.copy(tip);
        this.overlayGroup.add(label);
        this.markerObjects.push(label);
      }
    }
  }

  private syncMeasure(measure: ViewportInput['measure']): void {
    for (const o of this.measureObjects) this.disposeOverlay(o);
    this.measureObjects = [];
    if (!measure) return;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions([measure.a.x, measure.a.y, measure.a.z, measure.b.x, measure.b.y, measure.b.z]);
    const line = new LineSegments2(geometry, this.resolved(fatLineMaterial(this.palette.selection, 3, { depthTest: false })));
    line.renderOrder = 40;
    const el = document.createElement('span');
    el.className = 'vp-tag vp-tag-measure';
    el.textContent = measure.label;
    const label = new CSS2DObject(el);
    label.position.set((measure.a.x + measure.b.x) / 2, (measure.a.y + measure.b.y) / 2, (measure.a.z + measure.b.z) / 2);
    this.overlayGroup.add(line, label);
    this.measureObjects.push(line, label);
  }

  private resolved<T extends { resolution: Vector2 }>(m: T): T {
    m.resolution.set(this.width, this.height);
    return m;
  }

  private disposeOverlay(o: Object3D): void {
    o.parent?.remove(o);
    if (o instanceof Mesh || o instanceof LineSegments2) {
      // La géométrie d'une face partage les attributs du maillage de la pièce : seul l'index est propre.
      if (o instanceof LineSegments2) o.geometry.dispose();
      (o.material as Material).dispose();
    }
  }

  // -------------------------------------------------------------------------
  // Commandes de vue

  setStandardView(view: StandardView): void {
    this.rig.setStandardView(view, this.contentBounds());
  }

  fitAll(): void {
    this.rig.fit(this.contentBounds());
  }

  setProjection(projection: Projection): void {
    this.rig.setProjection(projection);
    this.requestRender();
  }

  get projection(): Projection {
    return this.rig.projection;
  }

  /** Boîte des pièces visibles seulement (taille des plans de construction). */
  private partsBounds(): Box3 | null {
    const box = new Box3();
    this.partsGroup.updateMatrixWorld(true);
    for (const p of this.parts.values()) if (p.group.visible) box.expandByObject(p.faces);
    return box.isEmpty() ? null : box;
  }

  private contentBounds(): Box3 | null {
    const box = new Box3();
    // Les placements (pièces d'un assemblage) viennent peut-être de changer : sans cette mise à
    // jour, le cadrage utiliserait la position de l'image précédente.
    this.partsGroup.updateMatrixWorld(true);
    for (const p of this.parts.values()) if (p.group.visible) box.expandByObject(p.faces);
    for (const { view } of this.sketchViews.values()) box.expandByObject(view.group);
    // Plateau d'impression : il fait partie de ce qu'on veut voir en entier.
    const bed = this.input.bed;
    if (bed) box.expandByPoint(new Vector3(0, 0, 0)).expandByPoint(new Vector3(bed.x, bed.y, 0));
    return box.isEmpty() ? null : box;
  }

  /** Projette un point d'esquisse en coordonnées écran (pixels, relatives à la vue). */
  projectSketchPoint(frame: Frame3D, p: Vec2): { x: number; y: number } {
    const w = frameToWorld(frame, p);
    const v = new Vector3(w.x, w.y, w.z).project(this.rig.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  pixelSize(): number {
    return this.rig.pixelSize();
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  // -------------------------------------------------------------------------
  // Entrées

  /** Rayon de la souris dans le monde (pour le glisser d'assemblage). */
  private worldRay(e: PointerEvent): AssemblyDragEvent['ray'] {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const r = this.raycaster.ray;
    return { origin: { x: r.origin.x, y: r.origin.y, z: r.origin.z }, direction: { x: r.direction.x, y: r.direction.y, z: r.direction.z } };
  }

  private bindAssemblyDrag(): void {
    // Écouteur en phase de capture : il passe avant la rotation de la vue (OrbitControls).
    this.container.addEventListener(
      'pointerdown',
      (e) => {
        const targets = this.input.dragTargets;
        if (!targets?.length || e.button !== 0 || this.input.mode !== 'model' || e.target !== this.renderer.domElement) return;
        const pick = this.pickModel(e);
        if (!pick || !targets.includes(pick.partId)) return;
        this.assemblyDrag = { key: pick.partId, moved: false };
        this.rig.controls.enabled = false;
        this.renderer.domElement.style.cursor = 'grabbing';
        this.events.onAssemblyDrag?.({ phase: 'start', key: pick.partId, ray: this.worldRay(e), shift: e.shiftKey, point: pick.point });
      },
      { capture: true },
    );
    const finish = (e: PointerEvent) => {
      const drag = this.assemblyDrag;
      if (!drag) return;
      this.assemblyDrag = null;
      this.rig.controls.enabled = true;
      this.renderer.domElement.style.cursor = '';
      this.events.onAssemblyDrag?.({ phase: 'end', key: drag.key, ray: this.worldRay(e), shift: e.shiftKey });
    };
    window.addEventListener('pointermove', (e) => {
      const drag = this.assemblyDrag;
      if (!drag) return;
      drag.moved = true;
      this.events.onAssemblyDrag?.({ phase: 'move', key: drag.key, ray: this.worldRay(e), shift: e.shiftKey });
    });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  private bindEvents(): void {
    this.bindAssemblyDrag();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.events.onContextLost();
    });
    const labels = this.labelRenderer.domElement;
    // Les libellés sont reconstruits à chaque mise à jour : le double-clic est donc détecté ici
    // (deux appuis sur la même cote en moins de 400 ms) plutôt qu'avec l'événement dblclick.
    let lastLabelDown: { id: string; time: number } | null = null;
    labels.addEventListener('pointerdown', (e) => {
      const anchor = (e.target as HTMLElement).closest<HTMLElement>('[data-anchor]');
      if (anchor) {
        e.stopPropagation();
        e.preventDefault();
        this.events.onAnchorPick?.(anchor.dataset.anchor!);
        return;
      }
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-constraint]');
      if (!el) return;
      e.stopPropagation();
      e.preventDefault();
      const id = el.dataset.constraint!;
      const now = performance.now();
      const isDouble = !!lastLabelDown && lastLabelDown.id === id && now - lastLabelDown.time < 400;
      lastLabelDown = isDouble ? null : { id, time: now };
      this.events.onSketchLabel(id, isDouble ? 'edit' : 'select', e.shiftKey);
      // Une cote (pas un symbole) peut être déplacée en glissant son libellé.
      if (!isDouble && e.button === 0 && el.classList.contains('vp-dim')) labelDrag = { id, x: e.clientX, y: e.clientY, moved: false };
    });
    let labelDrag: { id: string; x: number; y: number; moved: boolean } | null = null;
    window.addEventListener('pointermove', (e) => {
      if (!labelDrag) return;
      if (!labelDrag.moved && Math.hypot(e.clientX - labelDrag.x, e.clientY - labelDrag.y) < 4) return;
      labelDrag.moved = true;
      lastLabelDown = null;
      this.events.onSketchLabelDrag?.(labelDrag.id, 'move', this.sketchPoint(e));
    });
    const endLabelDrag = () => {
      if (labelDrag?.moved) this.events.onSketchLabelDrag?.(labelDrag.id, 'end', null);
      labelDrag = null;
    };
    window.addEventListener('pointerup', endLabelDrag);
    window.addEventListener('pointercancel', endLabelDrag);
    labels.addEventListener('keydown', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-constraint]');
      if (!el) return;
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        e.stopPropagation();
        this.events.onSketchLabel(el.dataset.constraint!, 'edit', false);
      } else if (e.key === ' ') {
        e.preventDefault();
        this.events.onSketchLabel(el.dataset.constraint!, 'select', e.shiftKey);
      }
    });
  }

  private ndc(e: PointerEvent): Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private sketchPoint(e: PointerEvent): Vec2 | null {
    const frame = this.sessionFrame;
    if (!frame) return null;
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      new Vector3(frame.normal.x, frame.normal.y, frame.normal.z),
      new Vector3(frame.origin.x, frame.origin.y, frame.origin.z),
    );
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    return hit ? worldToFrame(frame, { x: hit.x, y: hit.y, z: hit.z }) : null;
  }

  /** Dernier appui dans l'esquisse, pour reconnaître un double-clic (deux appuis proches). */
  private lastSketchDown: { x: number; y: number; time: number } | null = null;

  private onPointerDown = (e: PointerEvent): void => {
    const now = performance.now();
    this.down = { x: e.clientX, y: e.clientY, button: e.button, time: now };
    if (this.input.mode === 'sketch' && e.button === 0) {
      const last = this.lastSketchDown;
      const double = !!last && now - last.time < 400 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6;
      this.lastSketchDown = double ? null : { x: e.clientX, y: e.clientY, time: now };
      const p = this.sketchPoint(e);
      if (p) this.events.onSketchPointer('down', p, { shift: e.shiftKey, alt: e.altKey, double });
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.input.mode === 'sketch') {
      if (e.buttons !== 0 && e.buttons !== 1) return;
      const p = this.sketchPoint(e);
      if (p) this.events.onSketchPointer('move', p, { shift: e.shiftKey, alt: e.altKey });
      return;
    }
    if (e.buttons === 0) this.hoverPending = e;
  };

  private onPointerUp = (e: PointerEvent): void => {
    const down = this.down;
    this.down = null;
    if (this.input.mode === 'sketch') {
      // Un relâchement sans appui sur la vue (appui sur un libellé de cote) est ignoré.
      if (e.button === 0 && down) {
        const p = this.sketchPoint(e);
        if (p) this.events.onSketchPointer('up', p, { shift: e.shiftKey, alt: e.altKey });
      }
      return;
    }
    if (!down || down.button !== 0) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_MOVE_PX) return;
    const now = performance.now();
    const double = !!this.lastClick && now - this.lastClick.time < 380 && Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) < 8;
    this.lastClick = double ? null : { x: e.clientX, y: e.clientY, time: now };
    if (this.input.mode === 'pick-support') {
      const plane = this.pickOriginPlane(e);
      const pick = this.pickModel(e);
      if (pick && pick.kind === 'face' && (!plane || pick.distance <= plane.distance)) {
        this.events.onPick(pick, { shift: e.shiftKey, double });
        return;
      }
      if (plane) this.events.onPlanePick(plane.plane);
      return;
    }
    this.events.onPick(this.lockedVertexPick(e) ?? this.pickModel(e), { shift: e.shiftKey, double });
  };

  private onPointerLeave = (): void => {
    if (this.input.mode === 'sketch') this.events.onSketchPointer('leave', { x: 0, y: 0 }, { shift: false, alt: false });
    this.clearHover();
    this.events.onHover(null);
  };

  private pickOriginPlane(e: PointerEvent): { plane: PlaneName; distance: number } | null {
    this.raycaster.setFromCamera(this.ndc(e), this.rig.camera);
    const hits = this.raycaster.intersectObjects(this.planeMeshes.map((p) => p.mesh), false);
    const hit = hits[0];
    return hit ? { plane: hit.object.userData.plane as PlaneName, distance: hit.distance } : null;
  }

  /** Face ou arête sous le curseur (une arête proche à l'écran est prioritaire). */
  private pickModel(e: PointerEvent): (ModelPick & { distance: number }) | null {
    const ndc = this.ndc(e);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    // Les pièces « fantômes » (autres pièces pendant une opération) laissent passer les clics.
    const objects = Array.from(this.parts.values()).filter((p) => p.group.visible && p.appearance !== 'ghost');
    const hits = this.raycaster.intersectObjects(objects.map((p) => p.faces), false);
    const hit = hits[0];
    let facePick: (ModelPick & { distance: number }) | null = null;
    if (hit && hit.faceIndex !== undefined && hit.faceIndex !== null) {
      const part = objects.find((p) => p.faces === hit.object)!;
      facePick = { partId: part.partId, kind: 'face', index: part.faceOfTriangle(hit.faceIndex), point: { x: hit.point.x, y: hit.point.y, z: hit.point.z }, distance: hit.distance };
    }
    // Arêtes : distance à l'écran, en ignorant celles cachées derrière la face touchée.
    const rect = this.renderer.domElement.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const camera = this.rig.camera;
    let best: (ModelPick & { distance: number }) | null = null;
    let bestPx = EDGE_PICK_PX;
    const a = new Vector3();
    const b = new Vector3();
    const wa = new Vector3();
    const wb = new Vector3();
    const onRay = new Vector3();
    const onSegment = new Vector3();
    const ray = this.raycaster.ray;
    // Tri rapide : une pièce dont la sphère englobante passe loin du rayon de la souris (au-delà
    // de la tolérance de sélection) n'a aucune arête à portée ; ses arêtes ne sont pas projetées.
    const sphere = new Sphere();
    const pxAtTarget = this.rig.pixelSize();
    const targetDistance = Math.max(1e-6, camera.position.distanceTo(this.rig.target));
    for (const part of objects) {
      const bs = part.faces.geometry.boundingSphere;
      if (bs) {
        sphere.copy(bs).applyMatrix4(part.group.matrixWorld);
        const depth = camera.position.distanceTo(sphere.center);
        const margin = EDGE_PICK_PX * 2 * pxAtTarget * Math.max(1, depth / targetDistance);
        if (ray.distanceToPoint(sphere.center) > sphere.radius + margin) continue;
      }
      const pos = part.data.edgePositions;
      part.data.edges.forEach((edge, edgeIndex) => {
        for (let k = edge.start; k < edge.start + edge.count; k += 2) {
          wa.set(pos[k * 3]!, pos[k * 3 + 1]!, pos[k * 3 + 2]!);
          wb.set(pos[k * 3 + 3]!, pos[k * 3 + 4]!, pos[k * 3 + 5]!);
          if (!part.group.matrixAutoUpdate) {
            wa.applyMatrix4(part.group.matrix);
            wb.applyMatrix4(part.group.matrix);
          }
          a.copy(wa);
          b.copy(wb);
          a.project(camera);
          b.project(camera);
          const ax = ((a.x + 1) / 2) * this.width;
          const ay = ((1 - a.y) / 2) * this.height;
          const bx = ((b.x + 1) / 2) * this.width;
          const by = ((1 - b.y) / 2) * this.height;
          const dx = bx - ax;
          const dy = by - ay;
          const l2 = dx * dx + dy * dy;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / l2)) : 0;
          const d = Math.hypot(sx - (ax + t * dx), sy - (ay + t * dy));
          if (d >= bestPx) continue;
          // Profondeur réelle : point de l'arête le plus proche du rayon (l'interpolation à
          // l'écran n'est pas linéaire en 3D avec la perspective).
          ray.distanceSqToSegment(wa, wb, onRay, onSegment);
          const depth = onRay.distanceTo(ray.origin);
          if (facePick && depth > facePick.distance + Math.max(0.5, facePick.distance * 0.002)) continue;
          bestPx = d;
          best = { partId: part.partId, kind: 'edge', index: edgeIndex, point: { x: onSegment.x, y: onSegment.y, z: onSegment.z }, distance: depth };
        }
      });
    }
    return best ?? facePick;
  }

  private clearHover(): void {
    if (this.hoverOverlay) {
      this.disposeOverlay(this.hoverOverlay);
      this.hoverOverlay = null;
      this.hoverOverlayKey = null;
      this.requestRender();
    }
    if (this.hoverPlane) {
      this.setPlaneHover(null);
    }
  }

  private setPlaneHover(plane: PlaneName | null): void {
    this.hoverPlane = plane;
    for (const p of this.planeMeshes) {
      (p.mesh.material as MeshBasicMaterial).opacity = p.plane === plane ? 0.36 : 0.14;
      p.label.element.classList.toggle('is-hover', p.plane === plane);
    }
    this.requestRender();
  }

  /** Sommet de la face verrouillée le plus proche du curseur (à l'écran). */
  private lockedVertexPick(e: PointerEvent): (ModelPick & { distance: number }) | null {
    const lock = this.input.lockedFace;
    const part = lock ? this.parts.get(lock.partId) : undefined;
    if (!lock || !part) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pos = part.data.edgePositions;
    const w = new Vector3();
    const q = new Vector3();
    let best: { point: Vector3; px: number } | null = null;
    for (const edge of part.data.edges) {
      if (!edge.faces.includes(lock.index) || edge.count < 2) continue;
      for (const k of [edge.start, edge.start + edge.count - 1]) {
        w.set(pos[k * 3]!, pos[k * 3 + 1]!, pos[k * 3 + 2]!);
        if (!part.group.matrixAutoUpdate) w.applyMatrix4(part.group.matrix);
        q.copy(w).project(this.rig.camera);
        const px = Math.hypot(((q.x + 1) / 2) * this.width - sx, ((1 - q.y) / 2) * this.height - sy);
        if (!best || px < best.px) best = { point: w.clone(), px };
      }
    }
    if (!best) return null;
    return { partId: lock.partId, kind: 'vertex', index: lock.index, point: { x: best.point.x, y: best.point.y, z: best.point.z }, distance: 0 };
  }

  private updateHover(e: PointerEvent): void {
    if (this.input.mode === 'sketch' || (this.input.mode === 'feature' && !this.input.featurePicking)) return;
    const pick = this.lockedVertexPick(e) ?? this.pickModel(e);
    if (this.input.mode === 'pick-support') {
      const plane = this.pickOriginPlane(e);
      const usePlane = plane && (!pick || pick.kind !== 'face' || plane.distance < pick.distance) ? plane.plane : null;
      if (usePlane !== this.hoverPlane) this.setPlaneHover(usePlane);
      if (usePlane) {
        if (this.hoverOverlay) this.clearHoverOverlayOnly();
        this.events.onHover(null);
        return;
      }
    }
    // Même élément que la dernière fois : la surbrillance reste (la recréer à chaque mouvement de
    // souris jetait un matériau neuf et forçait la recompilation de son shader).
    const key = pick ? `${pick.partId}:${pick.kind}:${pick.index}` : null;
    if (key && key === this.hoverOverlayKey && this.hoverOverlay) {
      this.events.onHover(pick);
      return;
    }
    if (this.hoverOverlay) this.clearHoverOverlayOnly();
    if (pick) {
      const part = this.parts.get(pick.partId);
      const overlay =
        pick.kind === 'face' || pick.kind === 'vertex'
          ? part?.faceOverlay(pick.index, hatchMaterial(this.palette.hover, 0.35))
          : part?.edgeOverlay(pick.index, this.resolved(fatLineMaterial(this.palette.hover, 3, { depthTest: false })));
      if (overlay && part) {
        this.placeOverlay(overlay, part);
        this.overlayGroup.add(overlay);
        this.hoverOverlay = overlay;
        this.hoverOverlayKey = key;
      }
    }
    // Outil Main : une pièce qu'on peut attraper montre la main.
    this.renderer.domElement.style.cursor = pick ? (this.input.dragTargets?.includes(pick.partId) ? 'grab' : 'pointer') : '';
    this.events.onHover(pick);
    this.requestRender();
  }

  /** Les surlignages suivent le placement de la pièce (assemblage). */
  private placeOverlay(overlay: Object3D, part: PartObject): void {
    if (part.group.matrixAutoUpdate) return;
    overlay.matrixAutoUpdate = false;
    overlay.matrix.copy(part.group.matrix);
    overlay.matrixWorldNeedsUpdate = true;
  }

  private clearHoverOverlayOnly(): void {
    if (this.hoverOverlay) this.disposeOverlay(this.hoverOverlay);
    this.hoverOverlay = null;
    this.hoverOverlayKey = null;
  }

  setPalette(): void {
    this.palette = readPalette(this.container);
    this.grid.setPalette(this.palette);
    this.axes.setPalette(this.palette);
    this.sessionView.setPalette(this.palette);
    for (const p of this.parts.values()) p.group.userData.signature = '';
    this.setInput(this.input);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    for (const p of this.parts.values()) p.dispose();
    this.tool?.object.dispose();
    for (const { view } of this.sketchViews.values()) view.dispose();
    this.sessionView.dispose();
    this.grid.dispose();
    this.axes.dispose();
    this.rig.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
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

export function measureLabel(distance: number): string {
  return formatLength(distance);
}
