/**
 * Modèle métier portable du document. Il ne dépend ni du DOM, ni de Three.js, ni du noyau
 * géométrique : c'est la source de vérité, sérialisée telle quelle dans le format natif.
 * La géométrie (solides, maillages) est toujours reconstruite à partir de ce modèle.
 */
import type { PlaneName } from '../math/frame';
import type { FastenerKind, MetricSize } from './fasteners';

export type { PlaneName } from '../math/frame';

export type Id = string;

/** Seule unité de longueur prise en charge : le millimètre. */
export type LengthUnit = 'mm';

export interface CadDocument {
  id: Id;
  name: string;
  units: LengthUnit;
  parts: Part[];
  /** Ressources embarquées (contenu géométrique des imports), référencées par identifiant. */
  resources: Record<Id, Resource>;
  /** Assemblage des pièces (facultatif : absent tant qu'on n'utilise pas l'onglet Assemblage). */
  assembly?: Assembly;
  /** Sous-assemblages réutilisables, insérés comme un bloc rigide (facultatif). */
  subassemblies?: SubAssembly[];
  /**
   * Sous-assemblage en cours de modification (non enregistré) : son contenu est alors dans
   * `assembly` et l'assemblage principal est rangé à sa place dans `subassemblies`, pour que tous
   * les outils de l'onglet Assemblage s'appliquent à lui. Voir `domain/subassemblies.ts`.
   */
  editingSubassembly?: Id;
  /** Préparation de la fabrication (facultatif : réglages de l'onglet Fabrication). */
  fabrication?: FabricationSettings;
  /** Paramètres du projet (variables utilisables dans les cotes et les champs numériques). */
  parameters?: ProjectParameter[];
  /** Études de déformation (facultatif : réglages de l'onglet Simulation). */
  simulation?: SimulationSettings;
  createdAt: string;
  modifiedAt: string;
}

// ---------------------------------------------------------------------------
// Fabrication (impression 3D, découpe laser)

/** Pièce à imprimer : nombre d'exemplaires, échelle (%), face posée sur le plateau. */
export interface PrintItem {
  partId: Id;
  copies: number;
  scale: number;
  downFace?: FaceRef;
}

/**
 * Pièce plate à découper : nombre d'exemplaires, face qui donne le contour et matériau
 * (absent : celui dont l'épaisseur est la plus proche de celle de la pièce).
 */
export interface LaserItem {
  partId: Id;
  copies: number;
  face?: FaceRef;
  materialId?: Id;
}

/** Matériau de découpe : une « page » de l'onglet laser, avec ses plaques (mm). */
export interface LaserMaterial {
  id: Id;
  name: string;
  thickness: number;
  sheet: { w: number; h: number };
  /** Largeur du trait de coupe (mm). */
  kerf: number;
  /**
   * Placements choisis (plaques en grand, « Optimiser ») : exemplaire d'une pièce, plaque, centre
   * (mm) et angle (degrés). Absent : rangement automatique par rangées.
   */
  placements?: LaserPlacement[];
}

export interface LaserPlacement {
  partId: Id;
  /** Rang de l'exemplaire (0, 1, 2…). */
  copy: number;
  sheet: number;
  x: number;
  y: number;
  angle: number;
}

export interface FabricationSettings {
  /** Les pièces qui ne tiennent pas sur un plateau passent sur le suivant. */
  print: { bed: { x: number; y: number; z: number }; spacing: number; items: PrintItem[] };
  laser: { materials: LaserMaterial[]; spacing: number; engraveNames?: boolean; items: LaserItem[] };
}

// ---------------------------------------------------------------------------
// Paramètres du projet

/**
 * Variable du projet : un nom (lettres, chiffres, _) et sa valeur, donnée par une équation qui peut
 * utiliser d'autres paramètres (ex. `entraxe = largeur - 2*marge`). Unité : mm (ou ° pour un angle).
 */
export interface ProjectParameter {
  name: string;
  expression: string;
  comment?: string;
}

// ---------------------------------------------------------------------------
// Simulation (déformation d'une pièce)

/**
 * Sens de la charge : `push` pousse la face vers l'intérieur de la pièce ; les autres suivent un
 * axe du repère (`-z` : vers le bas, comme un poids).
 */
/**
 * Sens de la charge : `push` appuie sur la face (contre sa normale), `pull` tire dessus, un axe du
 * repère, ou `custom` : la direction `vector` de la charge.
 */
export type LoadDirection = 'push' | 'pull' | '-z' | '+z' | '-x' | '+x' | '-y' | '+y' | 'custom';

/** Étude de l'assemblage (au lieu d'une pièce) : ses pièces qui se touchent sont collées. */
export const ASSEMBLY_STUDY = '@assembly';

/** Face d'une étude ; dans l'étude de l'assemblage, `instanceId` dit sur quelle pièce insérée. */
export type StudyFace = FaceRef & { instanceId?: Id };

/** Charge : une masse posée (kg, son poids tire dans le sens choisi, vers le bas par défaut) ou une force (N). */
export interface SimulationLoad {
  faces: StudyFace[];
  kind: 'mass' | 'force';
  value: number;
  direction: LoadDirection;
  /** Direction de la charge quand `direction` vaut `custom` (pas forcément unitaire). */
  vector?: { x: number; y: number; z: number };
}

/** Étude d'une pièce (ou de l'assemblage, `ASSEMBLY_STUDY`) : matériau, faces fixées, charge, précision. */
export interface SimulationStudy {
  partId: Id;
  materialId: string;
  quality: 'coarse' | 'normal' | 'fine';
  fixed: StudyFace[];
  load: SimulationLoad;
  /** « Alléger la pièce » : faces gardées pleines (autour des perçages, des appuis…). */
  keep?: StudyFace[];
}

/**
 * Étude « Mécanisme » : couple (pivot, N·m) ou force (glissière, N) à fournir sur la liaison
 * `jointId` pour faire bouger l'assemblage de `from` à `to` (degrés ou mm). `friction` : couple ou
 * force de frottement constant ; `acceleration` : accélération voulue (rad/s² ou m/s²) ;
 * `safety` : coefficient de sécurité (≥ 1).
 */
export interface MechanismStudy {
  jointId: Id;
  from: number;
  to: number;
  friction: number;
  acceleration: number;
  safety: number;
  /** Masses portées (kg), posées au centre de gravité de la pièce `instanceKey` (clé dépliée). */
  loads?: { instanceKey: string; mass: number }[];
}

export interface SimulationSettings {
  studies: SimulationStudy[];
  /** Étude « Mécanisme » de l'assemblage (facultative). */
  mechanism?: MechanismStudy;
}

// ---------------------------------------------------------------------------
// Assemblage

/**
 * Repère local (LCS) posé sur une pièce, désigné de façon persistante :
 * - `face` : centre d'une face plane, axe Z = normale sortante ; ou centre d'une sphère (rotule) ;
 * - `circle` : centre d'un cercle ou d'un arc (bord d'un trou…), axe Z = axe du cercle ;
 * - `edge` : milieu d'une arête droite, axe Z = direction de l'arête ;
 * - `vertex` : sommet d'une face plane, axe Z = normale de la face ;
 * - `point` : point seul d'une esquisse (outil Point), axe Z = normale de l'esquisse.
 */
export type LcsRef =
  | { kind: 'face'; face: FaceRef }
  | { kind: 'circle'; edge: EdgeRef }
  | { kind: 'edge'; edge: EdgeRef }
  /** Sommet d'une face plane : point commun à deux de ses arêtes, axe Z = normale de la face. */
  | { kind: 'vertex'; face: FaceRef; edges: [EdgeRef, EdgeRef] }
  /** Point seul d'une esquisse de la pièce (outil Point), axe Z = normale de l'esquisse. */
  | { kind: 'point'; sketchId: Id; pointId: string };

/**
 * Pièce insérée dans l'assemblage (une même pièce peut être insérée plusieurs fois), ou
 * sous-assemblage inséré (`subassemblyId` ; `partId` est alors vide) : un bloc rigide.
 */
export interface AssemblyInstance {
  id: Id;
  partId: Id;
  subassemblyId?: Id;
  /**
   * Bloc souple : ses liaisons internes prennent ici les réglages `jointValues` (par identifiant
   * de liaison du bloc) au lieu de ceux du bloc ; chaque insertion a les siens.
   */
  flexible?: boolean;
  jointValues?: Record<Id, { angle: number; offset: number }>;
  name: string;
  /** Position (mm) tant que la pièce n'est tenue par aucune liaison. */
  position: { x: number; y: number; z: number };
  /**
   * Orientation (degrés) tant que la pièce n'est tenue par aucune liaison : autour de X, puis de Y,
   * puis de Z (axes fixes), autour de l'origine de la pièce. Facultative (absente : aucune).
   */
  rotation?: { x: number; y: number; z: number };
}

export interface JointEnd {
  instanceId: Id;
  /**
   * Sous-assemblage inséré : chemin de la pièce du bloc où s'accroche la liaison (identifiants
   * des pièces insérées, du bloc vers la pièce, un par niveau d'imbrication).
   */
  member?: Id[];
  lcs: LcsRef;
}

export type JointKind = 'fixed' | 'revolute' | 'slider' | 'cylindrical' | 'spherical';

/**
 * Liaison : le repère de la pièce mobile est superposé à celui de la pièce de référence (axes Z
 * opposés, `flip` les rend identiques), tourné de `angle` degrés autour de l'axe et décalé de
 * `offset` mm le long de l'axe. Les limites bornent les mouvements libres.
 * Rotule : en plus, la pièce mobile se penche de `tilt` degrés vers la direction `tiltDirection`
 * (degrés, autour de l'axe du repère de référence) ; son point d'accroche ne bouge pas.
 */
export interface AssemblyJoint {
  id: Id;
  name: string;
  kind: JointKind;
  moving: JointEnd;
  base: JointEnd;
  flip: boolean;
  angle: number;
  offset: number;
  angleLimits?: [number, number];
  offsetLimits?: [number, number];
  tilt?: number;
  tiltDirection?: number;
  /** Inclinaison maximale (degrés) d'une rotule. */
  tiltLimit?: number;
}

/**
 * Élément de visserie normalisée (vis, écrou, rondelle) posé sur le bord circulaire d'un trou
 * d'une pièce insérée : il suit la pièce. La tête (ou l'écrou, la rondelle) est du côté de la face
 * où débouche le trou, la tige entre dans le trou. Plusieurs éléments sur le même bord s'empilent
 * dans l'ordre de la liste (rondelle puis vis…). `flip` retourne l'élément.
 */
export interface AssemblyFastener {
  id: Id;
  kind: FastenerKind;
  size: MetricSize;
  /** Longueur normalisée (vis seulement). */
  length?: number;
  at: { instanceId: Id; edge: EdgeRef };
  flip?: boolean;
}

/**
 * Couplage entre deux liaisons : la liaison menée suit la menante.
 * - `gear` (engrenage, deux pivots) : la menée tourne de `teeth[0] / teeth[1]` fois l'angle de la
 *   menante, en sens opposé (dans le même sens si `reversed` : courroie, couronne à denture
 *   intérieure) ;
 * - `rack` (crémaillère : pivot menant, glissière menée) : un tour de la roue fait avancer la
 *   glissière de π × `pitchDiameter` mm (sens inverse si `reversed`).
 * `phase` est le réglage de la menée quand la menante est à 0 (degrés ou mm) : il est pris à la
 * création pour que rien ne bouge, puis modifiable pour caler les dents.
 */
export interface JointCoupling {
  id: Id;
  name: string;
  kind: 'gear' | 'rack';
  driver: Id;
  driven: Id;
  teeth: [number, number];
  pitchDiameter: number;
  reversed: boolean;
  phase: number;
}

/** Sous-assemblage : un assemblage nommé, inséré dans d'autres comme un bloc rigide. */
export interface SubAssembly extends Assembly {
  id: Id;
  name: string;
}

export interface Assembly {
  /** La première pièce insérée est fixe. */
  instances: AssemblyInstance[];
  joints: AssemblyJoint[];
  /** Visserie (facultatif). */
  fasteners?: AssemblyFastener[];
  /** Engrenages et crémaillères entre liaisons (facultatif). */
  couplings?: JointCoupling[];
}

export interface Part {
  id: Id;
  name: string;
  /** Couleur d'affichage et d'export STEP, au format #rrggbb. */
  color: string;
  visible: boolean;
  /**
   * Matière (identifiant de `domain/part-material.ts`) : masse de la pièce, matériau par défaut de
   * ses études de simulation. Facultatif : absente, celle de sa tôle, sinon le PLA.
   */
  material?: string;
  /** Historique de construction, évalué dans l'ordre. */
  features: Feature[];
}

export type Feature = SketchFeature | ExtrudeFeature | PocketFeature | RevolveFeature | ImportedSolidFeature | FilletFeature | ChamferFeature | PatternFeature | MirrorFeature | PrimitiveFeature | ShellFeature | LoftFeature | SweepFeature | SplitFeature | DraftFeature | ThickenFeature | GearFeature | MoveFeature | HoleFeature | PlaneFeature | AxisFeature | SheetFeature | FlangeFeature | FoldFeature | ImageFeature;
export type FeatureType = Feature['type'];

interface FeatureBase<T extends string, P> {
  id: Id;
  type: T;
  name: string;
  params: P;
  /**
   * Champs réglés par une équation qui utilise des paramètres du projet (nom du champ du panneau →
   * équation, ex. `{ distance: "epaisseur*2" }`) : recalculés quand un paramètre change.
   */
  expressions?: Record<string, string>;
}

export type SketchFeature = FeatureBase<'sketch', SketchParams> & {
  /** Affichage de l'esquisse dans la vue 3D hors édition. */
  visible: boolean;
};
export type ExtrudeFeature = FeatureBase<'extrude', ExtrudeParams>;
export type PocketFeature = FeatureBase<'pocket', PocketParams>;
export type RevolveFeature = FeatureBase<'revolve', RevolveParams>;
export type ImportedSolidFeature = FeatureBase<'imported-solid', ImportedSolidParams>;
export type FilletFeature = FeatureBase<'fillet', FilletParams>;
export type ChamferFeature = FeatureBase<'chamfer', ChamferParams>;
export type PatternFeature = FeatureBase<'pattern', PatternParams>;
export type MirrorFeature = FeatureBase<'mirror', MirrorParams>;
export type PrimitiveFeature = FeatureBase<'primitive', PrimitiveParams>;
export type ShellFeature = FeatureBase<'shell', ShellParams>;
export type LoftFeature = FeatureBase<'loft', LoftParams>;
export type SweepFeature = FeatureBase<'sweep', SweepParams>;
export type SplitFeature = FeatureBase<'split', SplitParams>;
export type DraftFeature = FeatureBase<'draft', DraftParams>;
export type ThickenFeature = FeatureBase<'thicken', ThickenParams>;
export type MoveFeature = FeatureBase<'move', MoveParams>;
export type HoleFeature = FeatureBase<'hole', HoleParams>;
export type PlaneFeature = FeatureBase<'plane', DatumPlaneParams>;
export type AxisFeature = FeatureBase<'axis', DatumAxisParams>;
export type SheetFeature = FeatureBase<'sheet', SheetParams>;
export type FlangeFeature = FeatureBase<'flange', FlangeParams>;
export type FoldFeature = FeatureBase<'fold', FoldParams>;
export type ImageFeature = FeatureBase<'image', ImageParams> & {
  /** Affichage de l'image dans la vue 3D. */
  visible: boolean;
};

// ---------------------------------------------------------------------------
// Esquisses

/**
 * Support d'une esquisse :
 * - un plan d'origine, éventuellement décalé le long de sa normale ;
 * - une face plane désignée par une référence sémantique (jamais par un numéro de face).
 */
/**
 * Conception en contexte d'assemblage : la référence vers une autre pièce passe par l'assemblage.
 * `matrix` (4 × 4, colonnes) place l'autre pièce dans le repère de la pièce de l'esquisse, d'après
 * leurs insertions `instanceId` (cette pièce) et `otherInstanceId` (l'autre), liaisons à zéro.
 * L'application la recalcule quand l'assemblage change, sauf si `frozen` (lien figé).
 */
export interface AssemblyContext {
  instanceId: Id;
  otherInstanceId: Id;
  matrix: number[];
  frozen?: boolean;
}

export type SketchSupport =
  | { kind: 'plane'; plane: PlaneName; offset: number }
  /**
   * Face plane de la pièce, ou d'une autre pièce du projet (`partId`, sa forme finale), placée
   * comme dans l'assemblage si `context`.
   */
  | { kind: 'face'; ref: FaceRef; partId?: Id; context?: AssemblyContext }
  /** Plan de construction (étape `plane` de la même pièce, placée avant). */
  | { kind: 'datum'; featureId: Id };

/**
 * Référence sémantique et persistante d'une face générée :
 * - `start` / `end` : faces de départ et d'arrivée d'une extrusion ou d'une poche ;
 * - `side` : face latérale engendrée par l'élément d'esquisse `entityId` ;
 * - `imported` : face n° `index` d'un solide importé (ordre de lecture du fichier STEP embarqué) ;
 * - `blend` : face créée par un congé ou un chanfrein sur l'arête n° `index` de ses paramètres.
 * Quand `featureId` est une répétition (ou la symétrie d'une étape), la face appartient à la
 * copie n° `index` et `role` / `entityId` sont ceux de la face d'origine. Pour la symétrie de toute
 * la pièce, `entityId` vaut « <étape d'origine>/<élément> » et `index` est celui d'origine.
 */
export interface FaceRef {
  featureId: Id;
  role: 'start' | 'end' | 'side' | 'imported' | 'blend';
  entityId?: string;
  index?: number;
}

/**
 * Référence persistante d'une arête : l'arête commune aux deux faces désignées. Elle survit aux
 * recalculs tant que ces deux faces existent et se touchent.
 */
export interface EdgeRef {
  faces: [FaceRef, FaceRef];
}

/** Identifiant réservé désignant l'origine fixe de l'esquisse (0, 0). */
export const ORIGIN_POINT_ID = 'origin';

export interface SketchPoint {
  id: string;
  type: 'point';
  x: number;
  y: number;
}

/**
 * Géométrie reprise de la pièce (« projetée ») : l'arête désignée de façon persistante est
 * projetée sur le plan de l'esquisse à chaque recalcul. L'élément est fixe (non résolu), sert
 * de référence aux cotes et contraintes, et ne compte pas dans le contour du volume.
 */
export interface SketchReference {
  edge: EdgeRef;
  /** Arête d'une autre pièce du projet (sa forme finale) ; absent : la pièce de l'esquisse. */
  partId?: Id;
  /** Autre pièce placée comme dans l'assemblage (conception en contexte). */
  context?: AssemblyContext;
}

/** Propriétés communes des courbes d'esquisse. */
interface CurveFlags {
  /** Élément de construction : visible et utilisable pour coter, mais ignoré pour le volume. */
  construction?: boolean;
  /** Élément repris de la pièce (fixe, toujours de construction). */
  reference?: SketchReference;
}

export interface SketchLine extends CurveFlags {
  id: string;
  type: 'line';
  /** Extrémités : identifiants de points de l'esquisse. */
  a: string;
  b: string;
}

export interface SketchCircle extends CurveFlags {
  id: string;
  type: 'circle';
  center: string;
  radius: number;
}

/**
 * Arc de cercle : de `start` à `end` dans le sens trigonométrique autour de `center`. Son rayon
 * est la distance du centre au point de départ ; le point d'arrivée est maintenu à la même
 * distance par le solveur.
 */
export interface SketchArc extends CurveFlags {
  id: string;
  type: 'arc';
  center: string;
  start: string;
  end: string;
}

/**
 * Ellipse : `center` et `major` (bout du grand axe : rayon et orientation) sont des points de
 * l'esquisse ; `minorRadius` est le demi-axe perpendiculaire.
 */
export interface SketchEllipse extends CurveFlags {
  id: string;
  type: 'ellipse';
  center: string;
  major: string;
  minorRadius: number;
}

/** Spline : courbe lisse passant par les points `points` (au moins 2), ouverte ou fermée. */
export interface SketchSpline extends CurveFlags {
  id: string;
  type: 'spline';
  points: string[];
  closed: boolean;
}

export type SketchEntity = SketchPoint | SketchLine | SketchCircle | SketchArc | SketchEllipse | SketchSpline;
export type SketchCurve = SketchLine | SketchCircle | SketchArc | SketchEllipse | SketchSpline;

interface ConstraintBase<T extends string> {
  id: string;
  type: T;
}

/** Position d'affichage d'une cote (décalage perpendiculaire en mm), sans effet géométrique. */
export interface DimensionPlacement {
  /** Équation de la cote si elle utilise des paramètres du projet (ex. « largeur/2 ») : recalculée quand un paramètre change. */
  expression?: string;
  /**
   * Placement d'affichage choisi à la souris (mm, repère de l'esquisse), sans effet géométrique :
   * longueur / distance alignée : décalage latéral de la ligne de cote ; distance horizontale ou
   * verticale : position de la ligne de cote par rapport au milieu des deux points ; diamètre /
   * rayon : longueur du repère au-delà du cercle ; angle : rayon de l'arc ; distance point-segment :
   * glissement le long du segment. Absent : placement automatique.
   */
  offset?: number;
  /** Diamètre / rayon : direction du libellé (degrés). */
  labelAngle?: number;
}

export type CoincidentConstraint = ConstraintBase<'coincident'> & { a: string; b: string };
export type HorizontalConstraint = ConstraintBase<'horizontal'> & { line: string };
export type VerticalConstraint = ConstraintBase<'vertical'> & { line: string };
/** Longueur d'un segment. */
export type LengthConstraint = ConstraintBase<'length'> & DimensionPlacement & { line: string; value: number };
/** Distance alignée entre deux points. */
export type DistanceConstraint = ConstraintBase<'distance'> & DimensionPlacement & { a: string; b: string; value: number };
/** Distance horizontale : x(b) − x(a) = value (value ≥ 0). */
export type DistanceXConstraint = ConstraintBase<'distanceX'> & DimensionPlacement & { a: string; b: string; value: number };
/** Distance verticale : y(b) − y(a) = value (value ≥ 0). */
export type DistanceYConstraint = ConstraintBase<'distanceY'> & DimensionPlacement & { a: string; b: string; value: number };
/** Diamètre ou rayon d'un cercle ou d'un arc (champ `circle` : identifiant de l'un ou de l'autre). */
export type DiameterConstraint = ConstraintBase<'diameter'> & DimensionPlacement & { circle: string; value: number };
export type RadiusConstraint = ConstraintBase<'radius'> & DimensionPlacement & { circle: string; value: number };
/** Deux segments `a` et `b` parallèles (même direction ou directions opposées). */
export type ParallelConstraint = ConstraintBase<'parallel'> & { a: string; b: string };
/** Deux segments `a` et `b` perpendiculaires. */
export type PerpendicularConstraint = ConstraintBase<'perpendicular'> & { a: string; b: string };
/** Deux segments `a` et `b` sur une même droite. */
export type CollinearConstraint = ConstraintBase<'collinear'> & { a: string; b: string };
/** Deux segments de même longueur, ou deux cercles de même rayon. */
export type EqualConstraint = ConstraintBase<'equal'> & { a: string; b: string };
/**
 * Tangence : `a` segment ou cercle, `b` cercle. Pour deux cercles, `internal` indique que l'un
 * est à l'intérieur de l'autre (choisi d'après le dessin au moment de l'ajout).
 */
export type TangentConstraint = ConstraintBase<'tangent'> & { a: string; b: string; internal?: boolean };
/** Point posé sur une courbe (sur la droite qui porte un segment, ou sur un cercle). */
export type PointOnConstraint = ConstraintBase<'pointOn'> & { point: string; curve: string };
/** Point au milieu d'un segment. */
export type MidpointConstraint = ConstraintBase<'midpoint'> & { point: string; line: string };
/**
 * Angle entre deux segments, en degrés (0 < value < 180), mesuré entre leurs directions
 * (du premier point vers le second) ; `supplementary` retourne la direction de `b`.
 */
export type AngleConstraint = ConstraintBase<'angle'> & DimensionPlacement & { a: string; b: string; value: number; supplementary?: boolean };
/** Distance d'un point à la droite qui porte un segment. */
export type PointLineDistanceConstraint = ConstraintBase<'pointLineDistance'> & DimensionPlacement & { point: string; line: string; value: number };

export type SketchConstraint =
  | CoincidentConstraint
  | HorizontalConstraint
  | VerticalConstraint
  | LengthConstraint
  | DistanceConstraint
  | DistanceXConstraint
  | DistanceYConstraint
  | DiameterConstraint
  | RadiusConstraint
  | ParallelConstraint
  | PerpendicularConstraint
  | CollinearConstraint
  | EqualConstraint
  | TangentConstraint
  | PointOnConstraint
  | MidpointConstraint
  | AngleConstraint
  | PointLineDistanceConstraint;

export type ConstraintType = SketchConstraint['type'];
export type DimensionConstraint = Extract<SketchConstraint, { value: number }>;

export const DIMENSION_TYPES: readonly ConstraintType[] = [
  'length',
  'distance',
  'distanceX',
  'distanceY',
  'diameter',
  'radius',
  'angle',
  'pointLineDistance',
];

/** Entités visées par une contrainte (points, segments, cercles). */
export function constraintReferences(c: SketchConstraint): string[] {
  switch (c.type) {
    case 'coincident':
    case 'distance':
    case 'distanceX':
    case 'distanceY':
    case 'parallel':
    case 'perpendicular':
    case 'collinear':
    case 'equal':
    case 'tangent':
    case 'angle':
      return [c.a, c.b];
    case 'horizontal':
    case 'vertical':
    case 'length':
      return [c.line];
    case 'diameter':
    case 'radius':
      return [c.circle];
    case 'pointOn':
      return [c.point, c.curve];
    case 'midpoint':
    case 'pointLineDistance':
      return [c.point, c.line];
  }
}

/** Une courbe d'esquisse ne compte pas dans le contour du volume (construction ou reprise). */
export function isConstructionCurve(e: SketchCurve): boolean {
  return !!e.construction || !!e.reference;
}

export function isDimension(c: SketchConstraint): c is DimensionConstraint {
  return 'value' in c;
}

export interface SketchParams {
  support: SketchSupport;
  entities: SketchEntity[];
  constraints: SketchConstraint[];
}

// ---------------------------------------------------------------------------
// Fonctions volumiques

/**
 * Sens de l'opération par rapport à la normale de l'esquisse :
 * - extrusion : `default` = du côté de la normale (vers l'extérieur d'une face) ;
 * - poche : `default` = contre la normale (dans la matière sous une face) ;
 * - `reversed` inverse ce sens, `symmetric` répartit de part et d'autre du plan.
 */
/** Sens d'une extrusion ou d'une poche ; `twoSides` : deux longueurs différentes de part et d'autre du plan. */
export type ExtentDirection = 'default' | 'reversed' | 'symmetric' | 'twoSides';

/** Axe de révolution : un axe du repère de l'esquisse, ou l'un de ses segments (souvent de construction). */
export type RevolveAxis = { kind: 'sketch-x' } | { kind: 'sketch-y' } | { kind: 'line'; lineId: string };

/** Révolution d'un profil fermé autour d'un axe de son esquisse ; `angle` en degrés (0 < angle ≤ 360). */
export interface RevolveParams {
  sketchId: Id;
  axis: RevolveAxis;
  angle: number;
  /** Tourne dans l'autre sens (utile pour une révolution partielle). */
  reversed: boolean;
  /** Ajouter le volume tourné, le creuser (gorge, cône de perçage…) ou garder la partie commune. */
  operation: VolumeOperation;
}

/** Direction ou axe d'une répétition : un axe du repère (passant par l'origine) ou une arête de la pièce. */
export type PatternAxis = { kind: 'axis'; axis: 'X' | 'Y' | 'Z' } | { kind: 'edge'; edge: EdgeRef } | { kind: 'datum'; featureId: Id };

/** Seconde direction d'une répétition linéaire (grille). */
export interface PatternDirection {
  axis: PatternAxis;
  count: number;
  spacing: number;
  reversed: boolean;
}

/**
 * Répétition d'une étape volumique (extrusion, poche, révolution) : ses exemplaires sont ajoutés
 * (ou retirés, pour une poche) le long d'une direction, en grille, ou autour d'un axe.
 * `count` compte l'original ; en circulaire, `angle` (degrés) est l'angle total : 360 répartit
 * les exemplaires sur un tour complet, sinon le premier et le dernier sont séparés de `angle`.
 */
export interface PatternParams {
  sourceId: Id;
  kind: 'linear' | 'circular';
  /** Linéaire : direction ; circulaire : axe de rotation. */
  axis: PatternAxis;
  count: number;
  /** Linéaire : distance entre deux exemplaires voisins (mm). */
  spacing: number;
  /** Circulaire : angle total (degrés). */
  angle: number;
  reversed: boolean;
  second?: PatternDirection;
}

/** Plan de symétrie : un plan d'origine (XY, XZ, YZ), une face plane de la pièce ou un plan de construction. */
export type MirrorPlane = { kind: 'plane'; plane: PlaneName } | { kind: 'face'; ref: FaceRef } | { kind: 'datum'; featureId: Id };

/**
 * Plan de construction : un plan d'origine, une face plane ou un autre plan de construction,
 * décalé de `offset` mm le long de sa normale, puis incliné de `angle` degrés autour de la
 * charnière `hinge` (axe X, Y ou Z passant par l'origine, ou arête droite de la pièce). Il ne
 * change pas la pièce : il sert de support d'esquisse, de plan de symétrie ou de découpe.
 */
/**
 * Axe de construction : la droite passant par `position` le long de l'axe `direction` (`kind`
 * `line`), ou reprise d'une arête de la pièce (`edge` : la droite d'une arête droite, l'axe du
 * bord d'un trou). Il ne change pas la pièce : il sert d'axe de répétition ou de charnière.
 */
export interface DatumAxisParams {
  kind: 'line' | 'edge';
  position: { x: number; y: number; z: number };
  direction: 'X' | 'Y' | 'Z';
  edge?: EdgeRef;
}

export interface DatumPlaneParams {
  base: MirrorPlane;
  offset: number;
  angle: number;
  hinge: PatternAxis;
}

/**
 * Symétrie (miroir) : la copie symétrique de toute la pièce, ou du volume ajouté / retiré par une
 * étape (extrusion, poche, révolution), par rapport à un plan.
 */
export interface MirrorParams {
  source: { kind: 'part' } | { kind: 'feature'; featureId: Id };
  plane: MirrorPlane;
}

/**
 * Épaissir : toute la pièce est décalée de `distance` mm (positif : elle grossit ; négatif : elle
 * s'amincit), par exemple pour ajouter du jeu entre deux pièces imprimées. Coins arrondis
 * (décalage exact) ou vifs.
 */
/**
 * Tôle : le contour fermé d'une esquisse, d'une épaisseur, dans un matériau pliable. La pièce
 * devient une pièce de tôlerie : bords pliés et plis s'appliquent à la tôle à plat, qui reste son
 * développé (voir `domain/sheet-metal.ts`).
 */
export interface SheetParams {
  sketchId: Id;
  /** Épaisseur (mm). */
  thickness: number;
  /** Matériau (`SHEET_MATERIALS`) : rayon minimal, angle maximal, facteur K. */
  materialId: string;
  /** Rayon intérieur des plis par défaut (mm). */
  radius: number;
  /** Vrai : la tôle est sous le plan de l'esquisse (sinon au-dessus, côté normale). */
  reversed: boolean;
}

/**
 * Image de référence (calque) posée sur un plan ou une face, pour redessiner une pièce d'après une
 * photo ou un plan scanné. Elle ne change pas la pièce. Coordonnées dans le repère du support :
 * `center` (mm), largeur `width` (mm, la hauteur suit les proportions), rotation (degrés).
 */
export interface ImageParams {
  /** Ressource de l'image (PNG, JPEG, WebP) enregistrée dans le projet. */
  resourceId: Id;
  /** Taille de l'image d'origine (pixels). */
  pixels: { w: number; h: number };
  support: SketchSupport;
  center: { x: number; y: number };
  width: number;
  rotation: number;
  mirror: boolean;
  /** Opacité (0,1 à 1). */
  opacity: number;
  /**
   * Redressement (perspective) : les 4 coins d'un rectangle connu, en fraction de l'image (0 → 1,
   * y vers le haut), dans l'ordre bas-gauche, bas-droit, haut-droit, haut-gauche, et ses
   * proportions (largeur / hauteur). L'image redressée montre ce rectangle au centre, avec une
   * marge d'une demi-largeur et d'une demi-hauteur tout autour.
   */
  perspective?: { corners: [Vec2Like, Vec2Like, Vec2Like, Vec2Like]; aspect: number };
}

export interface Vec2Like {
  x: number;
  y: number;
}

/** Côté vers lequel un pli remonte : celui de la normale de la tôle (`up`) ou l'autre. */
export type BendDirection = 'up' | 'down';

/** Bord plié : un rebord ajouté le long d'arêtes droites du contour de la tôle, puis plié. */
export interface FlangeParams {
  edges: EdgeRef[];
  /** Longueur droite du rebord après le pli (mm). */
  length: number;
  /** Angle du pli (degrés, 0 à 180). */
  angle: number;
  direction: BendDirection;
  /** Rayon intérieur (mm) ; absent : celui de la tôle. */
  radius?: number;
}

/** Pli sur une ligne : la tôle se plie le long d'un trait d'esquisse posé sur elle. */
export interface FoldParams {
  sketchId: Id;
  /** Segment de l'esquisse qui sert de ligne de pli ; absent : le premier segment. */
  lineId?: string;
  angle: number;
  direction: BendDirection;
  /** Côté du trait qui se plie (en allant du premier au second point du segment). */
  side: 'left' | 'right';
  radius?: number;
}

export interface ThickenParams {
  distance: number;
  corners: 'round' | 'sharp';
}

/**
 * Dépouille : les faces choisies (planes ou cylindriques) sont inclinées de `angle` degrés autour
 * du plan neutre, où elles ne bougent pas ; la pièce rétrécit en s'éloignant de ce plan (dans le
 * sens +X, +Y ou +Z d'un plan d'origine, vers l'intérieur de la pièce pour une face), comme une
 * pièce qui doit sortir d'un moule. `reversed` inverse ce sens.
 */
export interface DraftParams {
  faces: FaceRef[];
  angle: number;
  neutral: MirrorPlane;
  reversed: boolean;
}

/** Côté gardé par une découpe : sous le plan, au-dessus, ou les deux morceaux écartés. */
export type SplitKeep = 'below' | 'above' | 'both';

/**
 * Découpe en deux par un plan. Le plan est un plan d'origine (normale +X, +Y ou +Z) placé à la
 * coordonnée `offset`, ou une face plane décalée de `offset` le long de sa normale (négatif :
 * dans la pièce). « Au-dessus » est le côté vers lequel pointe la normale. Avec `both`, le
 * morceau du dessus est écarté de `gap` mm pour que les deux morceaux restent séparés.
 */
export interface SplitParams {
  plane: MirrorPlane;
  offset: number;
  keep: SplitKeep;
  gap: number;
}

export type PrimitiveShape = 'box' | 'cylinder' | 'sphere' | 'torus';

/**
 * Ce que fait un volume dessiné avec la pièce : l'ajouter, le creuser, ou ne garder que la
 * matière commune aux deux (intersection, outil du niveau Expert).
 */
export type VolumeOperation = 'add' | 'cut' | 'common';

/**
 * Forme toute faite, ajoutée à la pièce ou creusée dedans (`cut`, comme un trou). Boîte : coin
 * en `position`, `width` (X) × `depth` (Y) × `height` (Z) ; cylindre : centre de la base,
 * `diameter` × `height` ; sphère : centre, `diameter` ; tore (anneau) : centre, `diameter` de la
 * ligne centrale et `thickness` (diamètre du tube). Les dimensions inutiles sont conservées pour
 * pouvoir changer de forme sans tout ressaisir.
 */
export interface PrimitiveParams {
  shape: PrimitiveShape;
  position: { x: number; y: number; z: number };
  width: number;
  depth: number;
  height: number;
  diameter: number;
  thickness: number;
  operation: VolumeOperation;
}

/**
 * Déplacer : toute la pièce (son volume à ce point de l'historique) tourne de `angle` degrés autour
 * de l'axe `axis` passant par `center`, puis se décale de `translation` (mm). Les faces gardent
 * leurs références. `copy` garde l'original et ajoute la copie déplacée.
 */
export interface MoveParams {
  translation: { x: number; y: number; z: number };
  axis: 'X' | 'Y' | 'Z';
  angle: number;
  center: { x: number; y: number; z: number };
  copy: boolean;
}

/** Générateur : roue dentée droite (développante), crémaillère, ou poulie crantée. */
export type GearKind = 'spur' | 'rack' | 'pulley';

/** Courroies crantées : GT2 (pas 2, 3, 5 mm) et T (pas 2,5, 5, 10 mm). */
export type BeltProfile = 'GT2-2' | 'GT2-3' | 'GT2-5' | 'T2.5' | 'T5' | 'T10';

/**
 * Pièce générée, extrudée selon Z sur `thickness` à partir de `position` : centre de la roue ou de
 * la poulie, ou point de la ligne primitive au début de la crémaillère (dents vers +Y). Roue et
 * crémaillère : `module` (mm) et `pressureAngle` (°) ; elles engrènent si ces deux valeurs sont
 * égales. Poulie : profil de courroie `belt` ; `flanges` ajoute deux joues (épaisseur 1 mm).
 * `bore` : alésage central (0 : aucun) ; `rackHeight` : hauteur du corps sous les dents.
 */
export interface GearParams {
  kind: GearKind;
  module: number;
  pressureAngle: number;
  teeth: number;
  belt: BeltProfile;
  thickness: number;
  bore: number;
  rackHeight: number;
  flanges: boolean;
  position: { x: number; y: number; z: number };
  operation: VolumeOperation;
}

export type GearFeature = FeatureBase<'gear', GearParams>;

/**
 * Coque : la pièce est vidée en gardant une paroi d'épaisseur `thickness` (mm). Les faces
 * `open` sont retirées (l'ouverture d'un pot, d'une boîte) ; sans face ouverte, la pièce est
 * creuse et fermée. `outward` ajoute la paroi à l'extérieur.
 */
export interface ShellParams {
  open: FaceRef[];
  thickness: number;
  outward: boolean;
}

/**
 * Lissage : un volume qui passe d'un contour à l'autre. Chaque esquisse donne un contour fermé
 * (sans trou) ; ils sont reliés dans l'ordre de l'historique. `ruled` : raccords droits.
 */
export interface LoftParams {
  sketchIds: Id[];
  ruled: boolean;
  operation: VolumeOperation;
}

/**
 * Balayage : le contour fermé de l'esquisse `profileId` suit le chemin dessiné dans l'esquisse
 * `pathId` (segments et arcs bout à bout, ouverts ou fermés). Le profil se dessine au début du
 * chemin, de préférence perpendiculaire à lui.
 */
export interface SweepParams {
  profileId: Id;
  pathId: Id;
  operation: VolumeOperation;
}

export interface ExtrudeParams {
  sketchId: Id;
  distance: number;
  direction: ExtentDirection;
  /**
   * Jusqu'à une face plane de la pièce (niveau Expert) : l'extrusion part de l'esquisse et s'arrête
   * sur le plan de cette face, du côté où elle se trouve ; `distance` et `direction` sont alors
   * ignorées. Absent : extrusion d'une longueur.
   */
  upTo?: FaceRef;
  /** Sens « deux côtés » : longueur du côté opposé à la normale (`distance` : côté normale). */
  distance2?: number;
}

export type PocketExtent = { kind: 'distance'; distance: number } | { kind: 'throughAll' };

export interface PocketParams {
  sketchId: Id;
  /** Profondeur dans le sens par défaut (dans la matière, contre la normale). */
  extent: PocketExtent;
  direction: ExtentDirection;
  /** Sens « deux côtés » : profondeur de l'autre côté du plan de l'esquisse (le long de la normale). */
  extent2?: PocketExtent;
}

/** Perçage : trou de passage, lamé (tête cylindrique noyée), fraisé (tête conique) ou à tarauder. */
export type HoleKind = 'clearance' | 'counterbore' | 'countersink' | 'tapped';

/**
 * Jeu d'un trou de passage : aucun (le diamètre de la vis), série fine, moyenne ou large d'ISO 273,
 * ou jeu choisi (`clearance`).
 */
export type HoleFit = 'none' | 'fine' | 'medium' | 'coarse' | 'custom';

/**
 * Perçage normalisé pour une vis métrique (`size`), ou d'un diamètre libre (`size` = `custom` :
 * `diameter` mm), à chaque point seul et à chaque centre de cercle de l'esquisse (le diamètre
 * dessiné ne compte pas). Le trou part du plan de
 * l'esquisse et entre dans la matière (`reversed` : de l'autre côté). `headDiameter` et
 * `headDepth` décrivent le lamage (diamètre, profondeur) ou la fraisure (diamètre, à 90°) ; ils
 * sont proposés par la norme et modifiables.
 */
export interface HoleParams {
  sketchId: Id;
  kind: HoleKind;
  size: MetricSize | 'custom';
  /** Diamètre du trou (mm) quand `size` vaut `custom`. */
  diameter?: number;
  /** Jeu choisi (mm, ajouté au diamètre de la vis) quand `fit` vaut `custom`. */
  clearance?: number;
  /**
   * Trou fileté (`kind` = `tapped`) : `tap` (perçage avant taraudage, ISO) ou `plastic` (la vis
   * forme elle-même son filet dans le plastique imprimé : 0,9 × diamètre de la vis).
   */
  thread?: 'tap' | 'plastic';
  fit: HoleFit;
  /** Vrai : traverse toute la pièce ; sinon profondeur `depth` (mm). */
  through: boolean;
  depth: number;
  reversed: boolean;
  headDiameter: number;
  headDepth: number;
}

export interface ImportedSolidParams {
  resourceId: Id;
  /** Rang du solide dans le fichier embarqué (ordre de lecture déterministe). */
  solidIndex: number;
}

/** Congé : arrondi de rayon constant sur des arêtes. */
export interface FilletParams {
  edges: EdgeRef[];
  radius: number;
}

/** Chanfrein : biseau symétrique de longueur constante sur des arêtes. */
export interface ChamferParams {
  edges: EdgeRef[];
  distance: number;
}

// ---------------------------------------------------------------------------
// Ressources embarquées

/** Fichier importé conservé dans le projet : STEP (formes exactes) ou STL (triangles). */
export interface StepResource {
  id: Id;
  /** Fichier importé : solide STEP ou STL, ou image d'un calque (`image`). */
  kind: 'step' | 'stl' | 'image';
  /** Type MIME d'une image (image/png, image/jpeg, image/webp). */
  mime?: string;
  fileName: string;
  /** `utf8` : texte STEP tel quel ; `base64` : octets bruts encodés. */
  encoding: 'utf8' | 'base64';
  data: string;
  byteLength: number;
  sha256: string;
  importedAt: string;
}

export type Resource = StepResource;
