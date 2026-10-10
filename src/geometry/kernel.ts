/**
 * Interface documentée du noyau géométrique B-Rep. Les fonctions paramétriques (features) et le
 * moteur de recalcul ne connaissent que cette interface ; l'adaptateur Open CASCADE
 * (`geometry/occt`) en est l'implémentation. Toutes les longueurs sont en millimètres.
 */
import type { EdgeRef, FaceRef, Id } from '../domain/model';
import type { Frame3D } from '../math/frame';
import type { Vec2, Vec3 } from '../math/vec';
import type { ProfileRegion } from '../sketch/profiles';

/**
 * Étiquette sémantique portée par une face d'un solide (même structure qu'une référence de
 * face persistante). Une face peut porter plusieurs étiquettes (faces fusionnées).
 */
export type FaceTag = FaceRef;

/** Solide (ou ensemble de solides) détenu par le noyau. Objet opaque, à libérer avec `dispose`. */
export interface KernelShape {
  readonly __kernelShape: true;
}

export interface PrismRequest {
  featureId: Id;
  regions: ProfileRegion[];
  frame: Frame3D;
  /** Positions de départ et d'arrivée le long de la normale du repère (mm), `from < to`. */
  from: number;
  to: number;
}

/** Révolution de régions planes autour d'un axe du plan de l'esquisse. */
export interface RevolveRequest {
  featureId: Id;
  regions: ProfileRegion[];
  frame: Frame3D;
  /** Axe dans le repère de l'esquisse : un point et une direction. */
  axisOrigin: Vec2;
  axisDirection: Vec2;
  /** Angle en radians (signe : sens de rotation autour de l'axe). */
  angle: number;
}

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

export interface ShapeAnalysis {
  volume: number;
  area: number;
  bbox: BoundingBox | null;
  solidCount: number;
  /** Résultat de la vérification topologique et géométrique (BRepCheck). */
  valid: boolean;
}

export type FacePlaneLookup =
  | { status: 'found'; origin: Vec3; normal: Vec3; faceCount: number }
  | { status: 'lost' | 'not-planar' | 'ambiguous' };

export type SurfaceKind = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'other';
export type CurveKind = 'line' | 'circle' | 'other';

export interface FaceMeshInfo {
  /** Premier indice et nombre d'indices (triangles × 3) dans `indices`. */
  start: number;
  count: number;
  tags: FaceTag[];
  surface: SurfaceKind;
  /** Pour une face plane : point du plan et normale sortante. */
  plane?: { origin: Vec3; normal: Vec3 };
  /** Pour une face cylindrique : axe et rayon. */
  cylinder?: { origin: Vec3; axis: Vec3; radius: number };
  area: number;
}

export interface EdgeMeshInfo {
  /** Premier sommet et nombre de sommets (segments × 2) dans `edgePositions`. */
  start: number;
  count: number;
  /** Rang (dans `faces`) des faces qui bordent l'arête (deux en général). */
  faces: number[];
  curve: CurveKind;
  length: number;
  circle?: { center: Vec3; axis: Vec3; radius: number };
  line?: { start: Vec3; end: Vec3 };
}

/** Représentation d'affichage d'un solide : triangles par face et polylignes par arête. */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faces: FaceMeshInfo[];
  /** Segments d'arêtes (paires de sommets). */
  edgePositions: Float32Array;
  edges: EdgeMeshInfo[];
}

export interface MeshOptions {
  linearDeflection: number;
  angularDeflection: number;
}

export interface StepExportItem {
  name: string;
  color: string;
  shape: KernelShape;
}

export interface StepReadResult {
  solids: KernelShape[];
  /** Noms de produits trouvés dans le fichier (indicatifs). */
  productNames: string[];
}

export interface BlendRequest {
  featureId: Id;
  kind: 'fillet' | 'chamfer';
  edges: EdgeRef[];
  /** Rayon du congé ou longueur du chanfrein (mm). */
  size: number;
}

export type BlendResult =
  | { status: 'ok'; shape: KernelShape }
  | { status: 'edges-lost'; missing: number[] }
  | { status: 'failed'; detail: string };

/** Géométrie exacte d'une arête : segment de droite, cercle (ou arc), autre courbe. */
export type EdgeCurve =
  | { kind: 'line'; start: Vec3; end: Vec3 }
  | { kind: 'circle'; center: Vec3; axis: Vec3; radius: number }
  | { kind: 'other' };

export interface DistanceResult {
  distance: number;
  pointA: Vec3;
  pointB: Vec3;
}

/**
 * Étiquetage des faces d'une copie :
 * - `index` : copie n° `index` d'une répétition (ou d'une symétrie d'étape) : rôle et élément gardés ;
 * - `whole` : symétrie de toute la pièce : l'élément devient « <étape d'origine>/<élément> » et
 *   l'index d'origine est conservé.
 */
export type CopyTag = { featureId: Id; index: number } | { featureId: Id; whole: true };

export class KernelError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'KernelError';
  }
}

export interface GeometryKernel {
  /** Extrusion de régions planes entre deux positions le long de la normale du repère. */
  makePrism(request: PrismRequest): KernelShape;
  /** Solide de révolution ; faces étiquetées `start`, `end` (révolution partielle) et `side`. */
  makeRevolution(request: RevolveRequest): KernelShape;
  fuse(base: KernelShape, tool: KernelShape): KernelShape;
  cut(base: KernelShape, tool: KernelShape): KernelShape;
  /** Lit un fichier STEP ; renvoie les solides dans l'ordre de lecture (sans étiquettes). */
  readStep(data: Uint8Array): StepReadResult;
  /** Copie étiquetée d'un solide importé : chaque face reçoit `{featureId, role:'imported', index}`. */
  tagImported(solid: KernelShape, featureId: Id): KernelShape;
  analyze(shape: KernelShape): ShapeAnalysis;
  findFacePlane(shape: KernelShape, ref: FaceRef): FacePlaneLookup;
  /**
   * Copie déplacée d'un solide (matrice 4 × 4 de placement, par colonnes) : export d'assemblage,
   * répétition. Avec `retag`, les faces copiées sont étiquetées au nom de la copie (voir
   * `CopyTag`) ; sans, elles n'ont pas d'étiquette.
   */
  transformed(shape: KernelShape, matrix: readonly number[], retag?: CopyTag): KernelShape;
  /** Copie symétrique d'un solide par rapport au plan (point, normale) ; mêmes étiquettes que `transformed`. */
  mirrored(shape: KernelShape, origin: Vec3, normal: Vec3, retag?: CopyTag): KernelShape;
  /** Géométrie exacte des arêtes désignées par une référence persistante (vide si introuvable). */
  edgeCurves(shape: KernelShape, ref: EdgeRef): EdgeCurve[];
  /**
   * Congé ou chanfrein sur des arêtes désignées par des références persistantes. Les faces créées
   * sont étiquetées `{ featureId, role: 'blend', index }` (rang de l'arête dans la demande).
   */
  blend(base: KernelShape, request: BlendRequest): BlendResult;
  mesh(shape: KernelShape, options: MeshOptions): MeshData;
  exportStep(items: StepExportItem[]): string;
  /** Distance minimale entre deux sous-éléments désignés par leur rang dans le maillage. */
  distance(a: { shape: KernelShape; kind: 'face' | 'edge'; index: number }, b: { shape: KernelShape; kind: 'face' | 'edge'; index: number }): DistanceResult;
  dispose(shape: KernelShape): void;
  /** Mémoire WASM réservée (octets), pour les mesures de performance. */
  memoryBytes(): number;
}
