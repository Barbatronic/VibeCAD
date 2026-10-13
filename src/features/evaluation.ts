/**
 * Types partagés par les évaluateurs de fonctions et le moteur de recalcul.
 * Les évaluateurs ne connaissent que l'interface `GeometryKernel`, jamais Open CASCADE.
 */
import type { Feature, Id, SketchParams } from '../domain/model';
import type { FeatureStatus } from '../domain/status';
import type { GeometryKernel, KernelShape, ShapeAnalysis } from '../geometry/kernel';
import type { Frame3D } from '../math/frame';
import type { Vec3 } from '../math/vec';
import type { ProfileResult } from '../sketch/profiles';

export interface SketchEvaluation {
  featureId: Id;
  /** Repère 3D du plan de l'esquisse (null si le support est introuvable). */
  frame: Frame3D | null;
  /** Géométrie résolue (coordonnées recalculées par le solveur). */
  solved: SketchParams;
  converged: boolean;
  dof: number;
  freeEntities: string[];
  unsatisfied: string[];
  profile: ProfileResult;
}

export interface ResourceData {
  sha256: string;
  fileName: string;
  bytes: Uint8Array;
  /** Format du fichier (STEP par défaut). */
  kind?: 'step' | 'stl';
}

export interface ResourceProvider {
  get(id: Id): ResourceData | undefined;
}

export interface EvaluatedSketch {
  evaluation: SketchEvaluation;
  status: FeatureStatus;
}

/** Contexte d'évaluation : état de la pièce juste avant la fonction évaluée. */
export interface EvaluationContext {
  kernel: GeometryKernel;
  /** Solide courant de la pièce (null tant qu'aucun volume n'existe). */
  shape: KernelShape | null;
  shapeAnalysis: ShapeAnalysis | null;
  /** Esquisses déjà évaluées dans cette pièce, par identifiant. */
  sketches: ReadonlyMap<Id, EvaluatedSketch>;
  /** Plans de construction déjà calculés dans cette pièce, par identifiant. */
  datums: ReadonlyMap<Id, Frame3D>;
  /** Axes de construction déjà calculés dans cette pièce, par identifiant. */
  axes: ReadonlyMap<Id, { point: Vec3; dir: Vec3 }>;
  /** Corps outils des étapes précédentes (volume ajouté ou retiré), pour la répétition. */
  tools: ReadonlyMap<Id, { shape: KernelShape; mode: 'add' | 'cut' }>;
  /** Solides d'une ressource STEP embarquée (lecture mise en cache par le moteur). */
  readStepSolids(resourceId: Id): { solids: KernelShape[] } | { error: 'RESOURCE_MISSING' | 'IMPORT_FAILED'; detail?: string };
}

export interface FeatureOutcome {
  status: FeatureStatus;
  /** Nouveau solide de la pièce, créé par l'évaluateur (le moteur en devient propriétaire). */
  shape?: KernelShape;
  analysis?: ShapeAnalysis;
  /** Corps outil (volume ajouté ou retiré), conservé pour l'aperçu et la répétition. */
  tool?: KernelShape;
  /** Le corps outil a été ajouté (extrusion, révolution) ou retiré (poche) du solide. */
  toolMode?: 'add' | 'cut';
  sketch?: SketchEvaluation;
  /** Plan de construction calculé (étape `plane`). */
  datum?: Frame3D;
  /** Axe de construction calculé (étape `axis`) : point de passage et direction unitaire. */
  datumAxis?: { point: Vec3; dir: Vec3 };
}

export type FeatureEvaluator<F extends Feature> = (feature: F, ctx: EvaluationContext) => FeatureOutcome;
