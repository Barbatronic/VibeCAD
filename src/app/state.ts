/** État global de l'application (interface). Le document en est la seule partie enregistrée. */
import { DEFAULT_LIBRARIES, type LibraryCatalog } from './library';
import type { StepResource } from '../domain/model';
import type { TutorialId } from '../tutorials';
import type { Level } from './levels';
import type { SectionPlane } from '../geometry/protocol';
import type { RollbackState } from './rollback';
import { emptyHistory, type UndoHistory } from '../commands/history';
import { createDocument } from '../domain/document';
import type { CadDocument, Id, JointEnd } from '../domain/model';
import type { FastenerKind } from '../domain/fasteners';
import type { FeatureDraft } from '../features/panel-types';
import type { MeshData } from '../geometry/kernel';
import type { PartResult, StepInspection } from '../geometry/protocol';
import type { Vec3 } from '../math/vec';
import type { AutosaveStatus } from '../persistence/autosave';
import type { AutosaveRecord, ProjectSummary } from '../persistence/db';
import type { SaveTarget } from '../persistence/files';
import type { SketchSession } from '../sketch/session';
import type { Projection } from '../viewport/camera-rig';
import type { DisplayStyle } from '../viewport/part-meshes';
import type { ModelPick } from '../viewport/viewport';
import type { StudyOutput } from '../sim/study';
import type { TopologyOutput, TopologySurface } from '../sim/topology';
import type { ResultDisplay } from './simulation';

export interface MeasureInfo {
  title: string;
  lines: string[];
  segment?: { a: Vec3; b: Vec3; label: string };
}

export type Mode =
  | { kind: 'model' }
  | { kind: 'pick-support'; partId: Id; repairFeatureId: Id | null }
  | { kind: 'sketch'; session: SketchSession }
  | { kind: 'feature'; draft: FeatureDraft }
  | { kind: 'measure'; picks: ModelPick[]; info: MeasureInfo | null; busy: boolean }
  /** Création d'une liaison d'assemblage : repère de la pièce mobile, puis de la pièce de référence. */
  /** Création d'une liaison : repère déjà choisi sur la pièce qui bouge (et l'élément cliqué). */
  | {
      kind: 'joint';
      moving: JointEnd | null;
      movingPick?: { kind: 'face' | 'edge'; index: number };
      /** Face verrouillée (touche Maj maintenue) : on vise alors un de ses sommets. */
      lockedFace?: { instanceId: Id; index: number } | null;
    }
  /** Fabrication : choisir à la souris la face posée sur le plateau (impression) ou la face à découper (laser). */
  | { kind: 'pick-fab-face'; purpose: 'print' | 'laser'; partId: Id }
  /** Assemblage : poser de la visserie dans les trous (chaque clic sur un trou en pose un élément). */
  | { kind: 'fastener'; fastenerKind: FastenerKind }
  /** Simulation : cliquer les faces fixées ou chargées (un clic ajoute ou retire une face). */
  | { kind: 'pick-sim-face'; role: 'fixed' | 'load' | 'keep'; partId: Id };

/** Onglet de travail : modélisation des pièces, ou assemblage. */
export type Workspace = 'parts' | 'assembly' | 'fabrication' | 'simulation';

/** Calcul de simulation : en cours, terminé ou en échec, pour une signature (`studyKey`). */
export interface SimulationRun {
  partId: Id;
  key: string;
  status: 'running' | 'done' | 'error';
  progress: number;
  /** Taille (diagonale, mm) de ce qui est étudié : règle l'exagération de la déformée. */
  size: number;
  result?: StudyOutput;
  error?: string;
}

/**
 * Optimisation topologique (« Alléger la pièce ») de la pièce étudiée : densités calculées, et la
 * forme obtenue au seuil choisi. Affichage seulement : rien n'est enregistré dans le projet.
 */
export interface TopologyRun {
  partId: Id;
  key: string;
  status: 'running' | 'done' | 'error';
  progress: number;
  /** Part de la matière gardée demandée. */
  volumeFraction: number;
  result?: TopologyOutput;
  /** Seuil de densité (0,2 à 0,8) et forme obtenue à ce seuil. */
  threshold: number;
  surface?: TopologySurface;
  error?: string;
}

/** Sous-onglet de Fabrication. */
export type FabricationTab = 'print' | 'laser' | 'docs';

/** Visserie : un ou plusieurs éléments (un groupe d'éléments identiques de la liste). */
export type AssemblySelection = { kind: 'instance'; id: Id } | { kind: 'joint'; id: Id } | { kind: 'fasteners'; ids: Id[] } | { kind: 'coupling'; id: Id } | null;

export type Selection =
  | { kind: 'part'; partId: Id }
  | { kind: 'feature'; partId: Id; featureId: Id }
  | { kind: 'face'; partId: Id; index: number }
  | { kind: 'edge'; partId: Id; index: number }
  | null;

export interface PartDisplay {
  /** Résultat du dernier recalcul (statuts, esquisses résolues…). */
  result: PartResult;
  /** Maillage affiché : le dernier valide si l'historique contient une erreur. */
  mesh: MeshData | null;
  meshKey: string | null;
  /** La géométrie affichée n'est plus à jour (une étape est en erreur). */
  stale: boolean;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
  detail?: string;
  actionLabel?: string;
  action?: () => void;
}

export type ThemeChoice = 'auto' | 'light' | 'dark';

export type Dialog =
  | { kind: 'preferences' }
  /** Bibliothèques de composants : `inserting` = composant en cours de chargement (source|id). */
  | { kind: 'components'; inserting: string | null }
  | { kind: 'open'; projects: ProjectSummary[]; drafts: Omit<AutosaveRecord, 'text'>[]; loading: boolean }
  | { kind: 'export'; format: ExportFormat; partIds: Id[]; busy: boolean; assembly?: boolean; /** Export d'un plateau d'impression (son rang) ou de tous. */ plate?: number | 'all' }
  | {
      kind: 'import-step';
      fileName: string;
      /** Format du fichier : STEP (formes exactes) ou STL (triangles). */
      format: 'step' | 'stl';
      bytes: Uint8Array;
      inspection: StepInspection | null;
      error: string | null;
      target: 'new-part' | 'active-part';
      busy: boolean;
    }
  | { kind: 'recovery'; autosave: Omit<AutosaveRecord, 'text'>; savedAt: string | null }
  | { kind: 'unsaved'; action: 'new' | 'open-project' | 'open-file' | 'open-draft'; payload?: string }
  | { kind: 'about' }
  | { kind: 'problem'; title: string; message: string; details: string[] }
  | { kind: 'confirm-leave-sketch' }
  /** Première ouverture : choix du niveau de l'interface. */
  | { kind: 'choose-level' };

export type OfflineState =
  | { status: 'dev' }
  | { status: 'unsupported' }
  | { status: 'preparing'; done: number; total: number }
  | { status: 'ready'; version: string }
  | { status: 'update-ready' }
  | { status: 'error'; message: string };

export interface ProjectMeta {
  /** Date du dernier enregistrement explicite (null : jamais enregistré). */
  savedAt: string | null;
  /** Révision du document au dernier enregistrement. */
  savedRevision: number | null;
  file: SaveTarget | null;
  autosave: AutosaveStatus;
  storageAvailable: boolean;
}

export type ExportFormat = 'step' | 'stl' | '3mf' | 'glb' | 'freecad' | 'fcstd';

export interface AppState {
  doc: CadDocument;
  history: UndoHistory;
  /** Incrémentée à chaque modification du document. */
  revision: number;
  activePartId: Id;
  mode: Mode;
  selection: Selection;
  hover: ModelPick | null;
  display: Record<Id, PartDisplay>;
  evaluating: boolean;
  lastEvaluation: { durationMs: number; memoryBytes: number } | null;
  /**
   * Chat assistant : masqué (préférence de l'appareil), réduit (bulle repliée), et dernier
   * conseil refermé par l'utilisateur (il ne se rouvre que si le conseil change).
   */
  mascot: { hidden: boolean; collapsed: boolean; dismissed: string | null };
  /** Niveau de l'interface (outils montrés), retenu sur l'appareil. */
  level: Level;
  /** Bulles d'explication présentées par le chat au survol (sinon info-bulles simples). */
  tips: boolean;
  /** Thème de l'interface : celui du système, ou clair / sombre imposé (retenu sur l'appareil). */
  theme: ThemeChoice;
  /** Aimantation à la grille au début de chaque esquisse (retenu sur l'appareil). */
  sketchGrid: boolean;
  /** Vue en coupe (affichage seulement) et pièces coupées reçues du moteur. */
  section: SectionPlane | null;
  /** Assemblage : recherche des collisions activée, et dernier résultat. */
  collisionCheck: boolean;
  collisions: { key: string; items: { a: Id; b: Id; volume: number; mesh: MeshData }[] } | null;
  /** Repère du centre de gravité de la pièce active dans la vue. */
  showCentroid: boolean;
  /** Plaques en grand (découpe laser) : matériau dont on édite le placement des pièces. */
  laserEditor: { materialId: Id } | null;
  /** Image en cours d'ajout (calque) : sa ressource n'entre dans le projet qu'à la validation. */
  pendingImage: StepResource | null;
  /** Incrémenté quand une image finit de se charger (nouveau rendu de la vue). */
  imageVersion: number;
  /** Tôlerie : les pièces pliées sont montrées à plat (développé), avec leurs lignes de pli. */
  unfolded: boolean;
  /**
   * Pièce isolée (onglet Pièces) : elle seule est affichée, quelle que soit la visibilité enregistrée
   * des pièces, qui reste intacte ; un second clic revient exactement à l'affichage d'avant.
   */
  isolatedPartId: Id | null;
  /** Incrémenté à l'arrivée des traits cachés exacts d'une mise en plan (l'affichage se refait). */
  drawingRevision: number;
  sectionParts: { key: string; parts: Record<Id, { mesh: MeshData | null; cutFaces: number[] }> } | null;
  workspace: Workspace;
  fabricationTab: FabricationTab;
  /** Pièce dont on prépare la mise en plan (onglet Fabrication › Documents). */
  fabricationPart: Id | null;
  /** Plateau d'impression affiché (0, 1, 2…). */
  printPlate: number;
  /** Pièce étudiée dans l'onglet Simulation. */
  simulationPart: Id | null;
  simulationRun: SimulationRun | null;
  /** Couleurs du résultat : contrainte ou déplacement ; pièce montrée déformée (exagérée). */
  simulationDisplay: ResultDisplay;
  simulationDeformed: boolean;
  /** Déformée animée (aller-retour), sauf si le système demande moins d'animations. */
  simulationAnimate: boolean;
  /** Optimisation topologique en cours ou affichée ; part de matière gardée choisie. */
  topologyRun: TopologyRun | null;
  topologyFraction: number;
  /** Forme symétrique imposée : axe normal au plan de symétrie (0 : x, 1 : y, 2 : z), ou null. */
  topologySymmetry: 0 | 1 | 2 | null;
  assemblySelection: AssemblySelection;
  /** Outil Main de l'assemblage : glisser attrape les pièces (sinon glisser tourne la vue). */
  assemblyHand: boolean;
  /** Vue éclatée de l'assemblage : écartement des pièces (0 : assemblées). Affichage seulement. */
  explode: number;
  /** Liaison qui mène l'animation du mécanisme en cours. */
  jointAnimation: Id | null;
  /** Barre de retour en arrière, par pièce (voir `rollback.ts`). */
  rollback: RollbackState;
  /** Demande de cadrage : incrémentée quand la vue doit cadrer le modèle affiché (premier solide, projet ouvert). */
  fitRequest: number;
  preview: { parts: Record<Id, PartResult>; tool: { partId: Id; key: string; mesh: MeshData; kind: 'add' | 'cut' } | null } | null;
  kernel: { status: 'loading' | 'ready' | 'error'; message?: string; initMs?: number };
  project: ProjectMeta;
  offline: OfflineState;
  projection: Projection;
  /** Mode d'affichage des pièces (préférence de l'appareil). */
  displayStyle: DisplayStyle;
  /** Épaisseur des arêtes des pièces, en pixels (préférence de l'appareil). */
  edgeWidth: number;
  dialog: Dialog | null;
  helpOpen: boolean;
  /** Écran étroit : panneau des pièces ouvert par-dessus la vue (tiroir). */
  leftPanelOpen: boolean;
  /** Écran large : panneau des pièces masqué pour agrandir la vue. */
  leftPanelHidden: boolean;
  /** Écran large : panneau de droite replié contre le bord (une languette le rouvre). */
  rightPanelHidden: boolean;
  /** Panneau Propriétés de la pièce active ouvert (matière, volume, masse, encombrement). */
  propertiesOpen: boolean;
  /** Bibliothèques de composants (adresses des dépôts), retenues sur l'appareil. */
  libraries: string[];
  /** Catalogues chargés, dans l'ordre des bibliothèques. */
  libraryCatalogs: LibraryCatalog[];
  toasts: Toast[];
  /** Parcours guidé : `id` null tant que l'utilisateur n'a pas choisi le parcours. */
  tutorial: { id: TutorialId | null; step: number } | null;
}

export function initialState(): AppState {
  const doc = createDocument();
  return {
    doc,
    history: emptyHistory(),
    revision: 0,
    activePartId: doc.parts[0]!.id,
    mode: { kind: 'model' },
    selection: null,
    hover: null,
    display: {},
    evaluating: false,
    lastEvaluation: null,
    fitRequest: 0,
    rollback: {},
    level: 'expert',
    tips: true,
    theme: 'auto',
    sketchGrid: true,
    section: null,
    showCentroid: false,
    unfolded: false,
    pendingImage: null,
    laserEditor: null,
    imageVersion: 0,
    isolatedPartId: null,
    drawingRevision: 0,
    collisionCheck: false,
    collisions: null,
    sectionParts: null,
    workspace: 'parts',
    fabricationTab: 'print',
    assemblyHand: false,
    explode: 0,
    jointAnimation: null,
    fabricationPart: null,
    printPlate: 0,
    simulationPart: null,
    simulationRun: null,
    simulationDisplay: 'stress',
    simulationDeformed: true,
    simulationAnimate: true,
    topologyRun: null,
    topologyFraction: 0.4,
    topologySymmetry: null,
    assemblySelection: null,
    // Le chat (Java) est un réglage de l'environnement des jeunes : masqué tant qu'on ne l'a pas coché.
    mascot: { hidden: true, collapsed: false, dismissed: null },
    preview: null,
    kernel: { status: 'loading' },
    project: { savedAt: null, savedRevision: null, file: null, autosave: { kind: 'idle' }, storageAvailable: true },
    offline: { status: 'dev' },
    projection: 'perspective',
    displayStyle: 'shaded-edges',
    edgeWidth: 1,
    dialog: null,
    helpOpen: false,
    leftPanelOpen: false,
    leftPanelHidden: false,
    rightPanelHidden: false,
    propertiesOpen: false,
    libraries: [...DEFAULT_LIBRARIES],
    libraryCatalogs: [],
    toasts: [],
    tutorial: null,
  };
}

export const isDirty = (s: AppState) => s.project.savedRevision !== s.revision && (s.revision > 0 || s.project.savedRevision !== null);

/** Pièce affichée dans l'onglet Pièces : la pièce isolée seule, sinon selon sa visibilité. */
export function partShown(s: Pick<AppState, 'isolatedPartId' | 'doc'>, part: { id: Id; visible: boolean }): boolean {
  const isolated = s.isolatedPartId && s.doc.parts.some((p) => p.id === s.isolatedPartId) ? s.isolatedPartId : null;
  return isolated ? part.id === isolated : part.visible;
}
