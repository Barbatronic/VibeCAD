/**
 * Interface documentée du noyau géométrique B-Rep. Les fonctions paramétriques (features) et le
 * moteur de recalcul ne connaissent que cette interface ; l'adaptateur Open CASCADE
 * (`geometry/occt`) en est l'implémentation. Toutes les longueurs sont en millimètres.
 */
import type { EdgeRef, FaceRef, Id } from '../domain/model';
import type { Frame3D } from '../math/frame';
import type { Vec2, Vec3 } from '../math/vec';
import type { ProfileLoop, ProfileRegion, ProfileSegment } from '../sketch/profiles';

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

/** Balayage : la face du profil suit le chemin (suite de segments et d'arcs, ouverte ou fermée). */
export interface SweepRequest {
  featureId: Id;
  profile: { frame: Frame3D; region: ProfileRegion };
  path: { frame: Frame3D; segments: ProfileSegment[] };
}

/** Lissage : un volume qui passe d'un contour à l'autre (au moins deux, dans l'ordre). */
export interface LoftRequest {
  featureId: Id;
  sections: { frame: Frame3D; loop: ProfileLoop }[];
  /** Vrai : raccords droits (faces réglées) ; sinon surface lisse. */
  ruled: boolean;
}

/**
 * Forme toute faite. Boîte : coin en `position`, dimensions `width` (X), `depth` (Y), `height` (Z) ;
 * cylindre : centre de la base en `position`, axe Z ; sphère et tore : centre en `position`, axe Z
 * (tore : `diameter` = diamètre de la ligne centrale, `thickness` = diamètre du tube).
 */
export interface PrimitiveRequest {
  featureId: Id;
  shape: 'box' | 'cylinder' | 'sphere' | 'torus';
  position: Vec3;
  width: number;
  depth: number;
  height: number;
  diameter: number;
  thickness: number;
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
  /** Centre de gravité du volume (matière homogène), null sans volume. */
  centroid: Vec3 | null;
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
  /** Pour une face sphérique : centre et rayon (rotules). */
  sphere?: { center: Vec3; radius: number };
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

/** Coque : la pièce est vidée en gardant une paroi d'épaisseur `thickness` ; les faces `open` sont retirées. */
export interface ShellRequest {
  featureId: Id;
  open: FaceRef[];
  thickness: number;
  /** Vrai : la paroi est ajoutée à l'extérieur (la pièce garde sa forme intérieure). */
  outward: boolean;
}

export interface ThickenRequest {
  featureId: Id;
  /** Décalage de toutes les faces (mm) : positif, la pièce grossit ; négatif, elle s'amincit. */
  distance: number;
  /** Coins : arrondis (décalage exact, idéal pour un jeu) ou vifs (prolongés). */
  corners: 'round' | 'sharp';
}

export interface DraftRequest {
  featureId: Id;
  faces: FaceRef[];
  /** Angle de dépouille (degrés) : positif, la pièce rétrécit en allant dans le sens `direction`. */
  angle: number;
  /** Plan neutre (là où les faces ne bougent pas) et sens de démoulage (sa normale). */
  origin: Vec3;
  direction: Vec3;
}

/** `failed` : `face` = rang de la face (dans la demande) que le moteur n'a pas pu incliner. */
export type DraftResult = { status: 'ok'; shape: KernelShape } | { status: 'faces-lost'; missing: number[] } | { status: 'failed'; detail: string; face?: number };

export type ShellResult = { status: 'ok'; shape: KernelShape } | { status: 'faces-lost'; missing: number[] } | { status: 'failed'; detail: string };

export type BlendResult =
  | { status: 'ok'; shape: KernelShape }
  | { status: 'edges-lost'; missing: number[] }
  | { status: 'failed'; detail: string };

/** Géométrie exacte d'une arête : segment de droite, cercle (ou arc), autre courbe. */
/** Géométrie d'une arête ; `mid` : son point au milieu (paramètre médian), pour la retrouver ailleurs. */
export type EdgeCurve =
  | { kind: 'line'; start: Vec3; end: Vec3; mid?: Vec3 }
  | { kind: 'circle'; center: Vec3; axis: Vec3; radius: number; mid?: Vec3 }
  | { kind: 'other'; mid?: Vec3 };

export interface DistanceResult {
  distance: number;
  pointA: Vec3;
  pointB: Vec3;
}

/**
 * Étiquetage des faces d'une copie :
 * - `index` : copie n° `index` d'une répétition (ou d'une symétrie d'étape) : rôle et élément gardés ;
 * - `whole` : symétrie de toute la pièce : l'élément devient « <étape d'origine>/<élément> » et
 *   l'index d'origine est conservé ;
 * - `keep` : simple déplacement (morceau écarté d'une découpe) : les étiquettes restent celles
 *   d'origine.
 */
export type CopyTag = { featureId: Id; index: number } | { featureId: Id; whole: true } | { keep: true };

export class KernelError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'KernelError';
  }
}

/**
 * Composant d'un assemblage STEP : une pièce (`partKey`) ou un sous-assemblage (`blockKey`),
 * placé par une matrice 4 × 4 (par colonnes) dans le repère de l'assemblage qui le contient.
 */
export interface StepComponent {
  partKey?: string;
  blockKey?: string;
  name: string;
  matrix: readonly number[];
}

/** Sous-assemblage STEP : défini une fois (ses composants), réutilisé par chaque insertion. */
export interface StepBlock {
  key: string;
  name: string;
  components: StepComponent[];
}

export interface GeometryKernel {
  /** Extrusion de régions planes entre deux positions le long de la normale du repère. */
  makePrism(request: PrismRequest): KernelShape;
  /**
   * Forme toute faite ; faces étiquetées `start` (dessous), `end` (dessus), `side` + élément
   * (`x-`, `x+`, `y-`, `y+` pour la boîte, `wall` pour le cylindre, `surface` pour la sphère et le tore).
   */
  makePrimitive(request: PrimitiveRequest): KernelShape;
  /** Lissage ; faces `start` (premier contour), `end` (dernier) et `side` + élément du premier contour. */
  makeLoft(request: LoftRequest): KernelShape;
  /** Balayage ; faces `start`, `end` et `side` + élément du profil. */
  makeSweep(request: SweepRequest): KernelShape;
  /** Solide de révolution ; faces étiquetées `start`, `end` (révolution partielle) et `side`. */
  makeRevolution(request: RevolveRequest): KernelShape;
  /**
   * Pli d'une tôle : les faces planes du solide posées sur le plan donné (la section de la tôle à
   * l'entrée du pli) tournent de `angle` (radians) autour de l'axe ; null si aucune face n'est sur
   * ce plan. Faces créées étiquetées `{ featureId, role: 'side', entityId: 'bend' }`.
   */
  revolveSection(shape: KernelShape, plane: { origin: Vec3; normal: Vec3 }, axis: { origin: Vec3; direction: Vec3 }, angle: number, featureId: Id): KernelShape | null;
  fuse(base: KernelShape, tool: KernelShape): KernelShape;
  cut(base: KernelShape, tool: KernelShape): KernelShape;
  /**
   * Ajout ou retrait de plusieurs volumes en une seule opération (exemplaires d'une répétition) :
   * bien plus rapide qu'une suite d'opérations, chacune contre une pièce de plus en plus chargée.
   */
  fuseMany(base: KernelShape, tools: readonly KernelShape[]): KernelShape;
  cutMany(base: KernelShape, tools: readonly KernelShape[]): KernelShape;
  /** Partie commune de deux solides (vide si ils ne font que se toucher). */
  common(a: KernelShape, b: KernelShape): KernelShape;
  /**
   * Lit un fichier STL (binaire ou texte) : les triangles sont cousus en solides, puis les
   * triangles d'une même face plane sont fusionnés. Solides sans étiquettes, dans l'ordre de lecture.
   */
  readStl(data: Uint8Array): StepReadResult;
  /** Lit un fichier STEP ; renvoie les solides dans l'ordre de lecture (sans étiquettes). */
  readStep(data: Uint8Array): StepReadResult;
  /** Copie étiquetée d'un solide importé : chaque face reçoit `{featureId, role:'imported', index}`. */
  tagImported(solid: KernelShape, featureId: Id): KernelShape;
  analyze(shape: KernelShape): ShapeAnalysis;
  /**
   * Traits vus et cachés exacts (algorithme HLR d'OCCT) de chaque vue : `u` et `v` sont les axes
   * de la feuille, `toViewer` la direction vers l'observateur. Arêtes vives, contours apparents et
   * arêtes de raccord tangentes (vues seulement), en coordonnées de la vue (mm).
   */
  hiddenLineViews(shape: KernelShape, views: readonly { u: Vec3; toViewer: Vec3 }[]): { a: { x: number; y: number }; b: { x: number; y: number }; hidden: boolean }[][];
  /** Volume et nombre de solides seulement : bien plus rapide qu'`analyze` (pas de contrôle de validité). */
  volumeOf(shape: KernelShape): { volume: number; solidCount: number };
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
  /** Coque ; les faces intérieures créées sont étiquetées `side` + `inner` + rang de la face d'origine. */
  shell(base: KernelShape, request: ShellRequest): ShellResult;
  /** Pièce entière décalée (épaissie ou amincie) ; chaque face garde les étiquettes de son originale. */
  thicken(base: KernelShape, request: ThickenRequest): { status: 'ok'; shape: KernelShape } | { status: 'failed'; detail: string };
  /** Dépouille : faces planes ou cylindriques inclinées autour du plan neutre ; étiquettes conservées. */
  draft(base: KernelShape, request: DraftRequest): DraftResult;
  mesh(shape: KernelShape, options: MeshOptions): MeshData;
  exportStep(items: StepExportItem[]): string;
  /**
   * STEP d'un assemblage avec son arborescence : un nœud au nom du projet, une définition par
   * pièce (nom, couleur), une instance placée (matrice 4 × 4 par colonnes) par pièce insérée.
   */
  /**
   * Forme au format BREP d'OpenCASCADE (texte), lisible par FreeCAD ; `matrix` : placée à cet
   * endroit (position portée par la forme, comme FreeCAD l'enregistre).
   */
  brep(shape: KernelShape, matrix?: readonly number[]): string;
  exportStepAssembly(name: string, parts: (StepExportItem & { key: string })[], instances: StepComponent[], blocks?: StepBlock[]): string;
  /** Distance minimale entre deux sous-éléments désignés par leur rang dans le maillage. */
  distance(a: { shape: KernelShape; kind: 'face' | 'edge'; index: number }, b: { shape: KernelShape; kind: 'face' | 'edge'; index: number }): DistanceResult;
  dispose(shape: KernelShape): void;
  /** Mémoire WASM réservée (octets), pour les mesures de performance. */
  memoryBytes(): number;
}
