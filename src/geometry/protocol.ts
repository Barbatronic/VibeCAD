/**
 * Protocole entre l'interface et le worker de calcul géométrique. Les messages sont des objets
 * clonables (aucun objet du noyau ne traverse la frontière). Chaque requête porte un identifiant ;
 * les réponses obsolètes sont ignorées côté interface.
 */
import type { StepBlock, StepComponent } from './kernel';
import type { FreecadLeaf } from '../io/freecad';
import type { CadDocument, Id, SketchParams } from '../domain/model';
import type { FeatureIssueCode, FeatureStatus } from '../domain/status';
import type { Frame3D } from '../math/frame';
import type { Vec2, Vec3 } from '../math/vec';
import type { MeshData, ShapeAnalysis } from './kernel';

export type SketchProfileSummary =
  | { ok: true; regionCount: number; area: number }
  | { ok: false; code: FeatureIssueCode; points: string[]; positions: Vec2[] };

export interface SketchResult {
  featureId: Id;
  frame: Frame3D | null;
  solved: SketchParams;
  converged: boolean;
  dof: number;
  freeEntities: string[];
  unsatisfied: string[];
  profile: SketchProfileSummary;
}

export interface PartResult {
  partId: Id;
  statuses: FeatureStatus[];
  sketches: SketchResult[];
  /** Plans de construction calculés (repère de chacun). */
  planes: { featureId: Id; frame: Frame3D }[];
  /** Axes de construction calculés (point de passage, direction unitaire). */
  axes: { featureId: Id; point: Vec3; dir: Vec3 }[];
  /** Identifiant du maillage du dernier solide valide (null si aucun volume). */
  meshKey: string | null;
  /** Maillage, omis (null) si l'interface possède déjà `meshKey`. */
  mesh: MeshData | null;
  analysis: ShapeAnalysis | null;
  failedFeatureId: Id | null;
  /** Aperçu : corps outil de la fonction demandée (volume ajouté ou retiré). */
  previewTool?: { featureId: Id; mesh: MeshData };
  /** Images de référence : repère de leur support. */
  images?: { featureId: Id; frame: Frame3D }[];
  /** Tôlerie (pièce qui a des plis) : développé et lignes de pli. */
  flat?: SheetFlatResult;
}

/**
 * Développé d'une pièce de tôlerie : la tôle à plat (maillage, omis si l'interface a déjà
 * `meshKey`) et, pour chaque pli, les deux lignes qui bordent la bande pliée (point et direction,
 * sur le dessus de la tôle ; à couper au contour). `angle` en degrés, négatif vers le bas.
 */
export interface SheetFlatResult {
  meshKey: string;
  mesh: MeshData | null;
  normal: Vec3;
  thickness: number;
  bends: { featureId: Id; angle: number; radius: number; lines: { point: Vec3; dir: Vec3 }[] }[];
}

export interface EvaluationResult {
  parts: PartResult[];
  durationMs: number;
  memoryBytes: number;
}

export interface StepInspection {
  solids: { volume: number; bbox: { min: Vec3; max: Vec3 } | null; valid: boolean }[];
  productNames: string[];
  /** STL : nombre de triangles du fichier. */
  triangles?: number;
}

export interface PickRef {
  partId: Id;
  kind: 'face' | 'edge';
  index: number;
}

export interface MeasureResult {
  distance: number;
  pointA: Vec3;
  pointB: Vec3;
}

/** Document envoyé au worker : les ressources sont transmises à part (une seule fois). */
export type DocumentForWorker = Omit<CadDocument, 'resources'> & { resources: Record<Id, { sha256: string }> };

export interface WorkerResourcePayload {
  id: Id;
  sha256: string;
  fileName: string;
  bytes: Uint8Array;
  /** Format du fichier (STEP si absent). */
  kind?: 'step' | 'stl';
}

/** Pièce d'assemblage à exporter à sa place (matrice 4 × 4 par colonnes). */
export interface ExportPlacement {
  partId: Id;
  name: string;
  matrix: number[];
}

/** Arborescence STEP d'un assemblage : composants de premier niveau et sous-assemblages (blocs). */
export interface StepTree {
  roots: StepComponent[];
  blocks: StepBlock[];
}

export type WorkerRequest =
  | { id: number; type: 'init' }
  | { id: number; type: 'resources'; resources: WorkerResourcePayload[] }
  | { id: number; type: 'evaluate'; doc: DocumentForWorker; knownMeshKeys: string[]; previewFeatureId?: Id }
  | { id: number; type: 'exportStep'; doc: DocumentForWorker; partIds: Id[]; placements?: ExportPlacement[]; tree?: StepTree }
  | { id: number; type: 'exportStl'; doc: DocumentForWorker; partIds: Id[] }
  | { id: number; type: 'export3mf'; doc: DocumentForWorker; partIds: Id[]; placements?: ExportPlacement[] }
  | { id: number; type: 'exportFreecad'; doc: DocumentForWorker; partIds: Id[]; leaves: FreecadLeaf[] }
  | { id: number; type: 'inspectStep'; bytes: Uint8Array; format?: 'step' | 'stl' }
  | { id: number; type: 'measure'; doc: DocumentForWorker; a: PickRef; b: PickRef }
  | { id: number; type: 'section'; doc: DocumentForWorker; section: SectionPlane }
  | { id: number; type: 'hiddenLines'; doc: DocumentForWorker; partId: Id; views: { u: Vec3; toViewer: Vec3 }[] }
  | { id: number; type: 'collisions'; doc: DocumentForWorker; placements: CollisionPlacement[] };

/** Pièce insérée placée dans l'assemblage, pour la recherche de collisions. */
export interface CollisionPlacement {
  instanceId: Id;
  partId: Id;
  matrix: number[];
}

/** Deux pièces qui se rentrent dedans : volume en commun (mm³) et maillage de cette partie commune. */
export interface Collision {
  a: Id;
  b: Id;
  volume: number;
  mesh: MeshData;
}

/** Vue en coupe : plan parallèle à un plan d'origine, à la cote `offset` ; `flip` garde l'autre moitié. */
export interface SectionPlane {
  plane: 'XY' | 'XZ' | 'YZ';
  offset: number;
  flip: boolean;
}

/** Pièce coupée pour l'affichage : maillage et rangs des faces de coupe (à colorer). */
export interface SectionPart {
  partId: Id;
  /** Null : la pièce est entièrement du côté retiré (rien à montrer). */
  mesh: MeshData | null;
  cutFaces: number[];
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string; detail?: string } };

export interface WorkerResultMap {
  init: { memoryBytes: number; initMs: number };
  resources: { count: number };
  evaluate: EvaluationResult;
  exportStep: { text: string; warnings: string[] };
  exportStl: { bytes: Uint8Array; warnings: string[] };
  export3mf: { bytes: Uint8Array; warnings: string[] };
  exportFreecad: { script: string; fcstd: Uint8Array; warnings: string[] };
  inspectStep: StepInspection;
  measure: MeasureResult;
  section: { parts: SectionPart[] };
  /** Traits vus et cachés exacts de chaque vue demandée (vide si la pièce n'a pas de volume). */
  hiddenLines: { views: { a: { x: number; y: number }; b: { x: number; y: number }; hidden: boolean }[][] };
  collisions: { collisions: Collision[] };
}

/** Prépare un document pour le worker : les données des ressources sont retirées. */
export function documentForWorker(doc: CadDocument): DocumentForWorker {
  const resources: Record<Id, { sha256: string }> = {};
  for (const [id, r] of Object.entries(doc.resources)) resources[id] = { sha256: r.sha256 };
  return { ...doc, resources };
}
