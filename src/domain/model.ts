/**
 * Modèle métier portable du document. Il ne dépend ni du DOM, ni de Three.js, ni du noyau
 * géométrique : c'est la source de vérité, sérialisée telle quelle dans le format natif.
 * La géométrie (solides, maillages) est toujours reconstruite à partir de ce modèle.
 */
import type { PlaneName } from '../math/frame';

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
  /** Préparation de la fabrication (facultatif : réglages de l'onglet Fabrication). */
  fabrication?: FabricationSettings;
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
}

export interface FabricationSettings {
  /** Les pièces qui ne tiennent pas sur un plateau passent sur le suivant. */
  print: { bed: { x: number; y: number; z: number }; spacing: number; items: PrintItem[] };
  laser: { materials: LaserMaterial[]; spacing: number; engraveNames?: boolean; items: LaserItem[] };
}

// ---------------------------------------------------------------------------
// Assemblage

/**
 * Repère local (LCS) posé sur une pièce, désigné de façon persistante :
 * - `face` : centre d'une face plane, axe Z = normale sortante ; ou centre d'une sphère (rotule) ;
 * - `circle` : centre d'un cercle ou d'un arc (bord d'un trou…), axe Z = axe du cercle ;
 * - `edge` : milieu d'une arête droite, axe Z = direction de l'arête ;
 * - `vertex` : sommet d'une face plane, axe Z = normale de la face.
 */
export type LcsRef =
  | { kind: 'face'; face: FaceRef }
  | { kind: 'circle'; edge: EdgeRef }
  | { kind: 'edge'; edge: EdgeRef }
  /** Sommet d'une face plane : point commun à deux de ses arêtes, axe Z = normale de la face. */
  | { kind: 'vertex'; face: FaceRef; edges: [EdgeRef, EdgeRef] };

/** Pièce insérée dans l'assemblage (une même pièce peut être insérée plusieurs fois). */
export interface AssemblyInstance {
  id: Id;
  partId: Id;
  name: string;
  /** Position (mm) tant que la pièce n'est tenue par aucune liaison. */
  position: { x: number; y: number; z: number };
}

export interface JointEnd {
  instanceId: Id;
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

export interface Assembly {
  /** La première pièce insérée est fixe. */
  instances: AssemblyInstance[];
  joints: AssemblyJoint[];
}

export interface Part {
  id: Id;
  name: string;
  /** Couleur d'affichage et d'export STEP, au format #rrggbb. */
  color: string;
  visible: boolean;
  /** Historique de construction, évalué dans l'ordre. */
  features: Feature[];
}

export type Feature = SketchFeature | ExtrudeFeature | PocketFeature | RevolveFeature | ImportedSolidFeature | FilletFeature | ChamferFeature | PatternFeature | MirrorFeature | PrimitiveFeature | ShellFeature | LoftFeature | SweepFeature | SplitFeature | DraftFeature;
export type FeatureType = Feature['type'];

interface FeatureBase<T extends string, P> {
  id: Id;
  type: T;
  name: string;
  params: P;
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

// ---------------------------------------------------------------------------
// Esquisses

/**
 * Support d'une esquisse :
 * - un plan d'origine, éventuellement décalé le long de sa normale ;
 * - une face plane désignée par une référence sémantique (jamais par un numéro de face).
 */
export type SketchSupport =
  | { kind: 'plane'; plane: PlaneName; offset: number }
  | { kind: 'face'; ref: FaceRef };

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

export type SketchEntity = SketchPoint | SketchLine | SketchCircle | SketchArc;
export type SketchCurve = SketchLine | SketchCircle | SketchArc;

interface ConstraintBase<T extends string> {
  id: string;
  type: T;
}

/** Position d'affichage d'une cote (décalage perpendiculaire en mm), sans effet géométrique. */
export interface DimensionPlacement {
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
export type ExtentDirection = 'default' | 'reversed' | 'symmetric';

/** Axe de révolution : un axe du repère de l'esquisse, ou l'un de ses segments (souvent de construction). */
export type RevolveAxis = { kind: 'sketch-x' } | { kind: 'sketch-y' } | { kind: 'line'; lineId: string };

/** Révolution d'un profil fermé autour d'un axe de son esquisse ; `angle` en degrés (0 < angle ≤ 360). */
export interface RevolveParams {
  sketchId: Id;
  axis: RevolveAxis;
  angle: number;
  /** Tourne dans l'autre sens (utile pour une révolution partielle). */
  reversed: boolean;
}

/** Direction ou axe d'une répétition : un axe du repère (passant par l'origine) ou une arête de la pièce. */
export type PatternAxis = { kind: 'axis'; axis: 'X' | 'Y' | 'Z' } | { kind: 'edge'; edge: EdgeRef };

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

/** Plan de symétrie : un plan d'origine (XY, XZ, YZ) ou une face plane de la pièce. */
export type MirrorPlane = { kind: 'plane'; plane: PlaneName } | { kind: 'face'; ref: FaceRef };

/**
 * Symétrie (miroir) : la copie symétrique de toute la pièce, ou du volume ajouté / retiré par une
 * étape (extrusion, poche, révolution), par rapport à un plan.
 */
export interface MirrorParams {
  source: { kind: 'part' } | { kind: 'feature'; featureId: Id };
  plane: MirrorPlane;
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
}

export type PocketExtent = { kind: 'distance'; distance: number } | { kind: 'throughAll' };

export interface PocketParams {
  sketchId: Id;
  extent: PocketExtent;
  direction: ExtentDirection;
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

export interface StepResource {
  id: Id;
  kind: 'step';
  fileName: string;
  /** `utf8` : texte STEP tel quel ; `base64` : octets bruts encodés. */
  encoding: 'utf8' | 'base64';
  data: string;
  byteLength: number;
  sha256: string;
  importedAt: string;
}

export type Resource = StepResource;
