/**
 * Contrôleur de l'application : traduit les actions de l'utilisateur en transactions sur le
 * document (annulables), déclenche les recalculs dans le worker, gère les modes d'édition,
 * l'enregistrement, la sauvegarde automatique et les échanges de fichiers.
 */
import { emptyHistory, recordAction, redoAction, undoAction } from '../commands/history';
import {
  addFeature,
  addInstance,
  addJoint,
  addFastener,
  updateFastener,
  removeFasteners,
  insertFeatureAfter,
  removeInstance,
  removeJoint,
  addCoupling,
  updateCoupling,
  removeCoupling,
  updateInstance,
  updateJoint,
  addPart,
  addResource,
  createDocument,
  findFeature,
  findPart,
  makeExtrudeFeature,
  makeImageFeature,
  makeImportedSolidFeature,
  makeSketchFeature,
  newResourceId,
  removeFeaturesCascade,
  removePart,
  renameFeature,
  renamePart,
  replaceFeature,
  setPartColor,
  setPartMaterial,
  setPartVisible,
  updateFeature,
} from '../domain/document';
import type { AssemblyFastener, AssemblyJoint, CadDocument, JointEnd, FabricationSettings, Feature, FeatureType, Id, JointKind, LaserMaterial, MirrorFeature, ExtrudeFeature, PatternFeature, PlaneFeature, AxisFeature, SplitFeature, DraftFeature, ShellFeature, FaceRef, PlaneName, JointCoupling, ProjectParameter, SimulationStudy, StudyFace, SketchFeature, SketchSupport, ImageFeature, LaserPlacement, MechanismStudy } from '../domain/model';
import { ASSEMBLY_STUDY } from '../domain/model';
import { expressionNames, formatArea, formatLength, formatVolume, PARAMETER_NAME, setParameterScope } from '../domain/units';
import { applyParameters, parameterUses, renameParameterUses, resolveParameters } from '../features/parameters';
import type { FeatureDefinition, ToolInput } from '../features/definition';
import type { FeatureDraft, FieldUpdate } from '../features/panel-types';
import { FEATURE_DEFINITIONS, featureDependencies } from '../features/registry';
import { pickFaceReference } from '../features/sketch/support';
import type { GeometryClient } from '../geometry/client';
import type { PartResult } from '../geometry/protocol';
import { NATIVE_EXTENSION, NATIVE_MIME, parseNativeFile, serializeDocument } from '../io/native-format';
import { bytesToBase64, createStepResource, verifyResources } from '../io/resources';
import { meshesToBinaryStl, STL_UNIT_NOTE } from '../io/stl';
import { canonicalFrame, originPlaneFrame, type Frame3D } from '../math/frame';
import { distance3 } from '../math/vec';
import { AutosaveScheduler } from '../persistence/autosave';
import { isQuotaError, requestPersistentStorage, type ProjectStore } from '../persistence/db';
import { pickFile, readFileBytes, safeFileName, saveFile } from '../persistence/files';
import { createSession, setPixelSize, setProjectable, setTool, type ProjectableCurve, type SketchSession } from '../sketch/session';
import type { AdviceAction } from './advice';
import type { SectionPlane } from '../geometry/protocol';
import type { MeshData } from '../geometry/kernel';
import { allows, parseLevel, type Capability, type Level } from './levels';
import type { TutorialId } from '../tutorials';
import { applyUpdate } from './offline';
import { invertRigid4, transformDirection4, transformPoint4 } from '../math/mat4';
import { assemblyStepTree, clampToLimits, couplingPhase, endPart, flattenAssembly, isSphereLcs, type PlacedLeaf, type SolveOptions, JOINT_ISSUE_MESSAGES, jointFreedoms, lcsFromPick, rayAxisParam, rayPlane, solveAssembly, type AssemblyPlacement } from './assembly';
import { cross3, dot3, normalize3, scale3, sub3, type Vec3 } from '../math/vec';
import { projectableCurves } from './projection';
import { externalParts } from '../features/sketch/definition';
import { DISPLAY_STYLES, type DisplayStyle } from '../viewport/part-meshes';
import { importProjectAsSubassembly } from '../io/import-subassembly';
import { addSubassembly, addSubassemblyInstance, closedDocument, openSubassembly, removeSubassembly, renameSubassembly, subassemblyContains, subassemblyContent, subassemblyList, subassemblyUses } from '../domain/subassemblies';
import { fabricationSettings, newLaserMaterial, printLayout, type PrintLayout } from './fabrication';
import { findPlanarFace, laserLayout, optimizedPlacements, type LaserLayout } from './laser';
import { toDxf, toSvg, type VectorDocument } from '../io/vector';
import { billOfMaterials, bomCsv, technicalDrawing, templatePages, viewFromLines, VIEW_ORDER, VIEWS, type Bom, type ProjectedView, type ViewName } from './drawings';
import { drawingsToPdf, drawingToSvg, type DrawingPage } from '../io/drawing';
import { activeCount, insertionPoint, isRolledBack, normalizeRollback, rolledBackDocument, withRollbackAt } from './rollback';
import type { Projection, StandardView } from '../viewport/camera-rig';
import type { AssemblyDragEvent, ModelPick, Viewport } from '../viewport/viewport';
import { activePart, exportAvailability, measureAvailability, sketchAvailability, suggestedSketch, toolAvailability } from './availability';
import { blendIndexFromFacePick, edgeRefFromPick, toggleEdge } from './edges';
import type { Store } from './store';
import { FASTENER_COLOR, fastenerForHole, fastenerMesh, holeFromPick, holeOf, placeFasteners, type FastenerPlacement } from './fasteners';
import { toGlb, type GltfMesh, type GltfNode } from '../io/gltf';
import { APP_NAME, APP_VERSION } from '../meta';
import { designation, lengthsOf, type FastenerKind } from '../domain/fasteners';
import { meshSize, sameFaceRef, studyInput, studyKey, studyOf, topologyKey, withStudy, type ResultDisplay, type StudySource } from './simulation';
import { AbortedStudy, inlineSimRunner, type SimRunner } from '../sim/runner';
import { StudyError, type StudyErrorCode } from '../sim/study';
import { topologySurface } from '../sim/topology';
import { topologyOutline } from '../sim/topology-outline';
import { addClosedPolyline } from '../sketch/model';
import { fetchLibrary, libraryBaseUrl, type LibraryCatalog } from './library';
import { copyPartsInto } from '../domain/part-copy';
import { computeMechanism, defaultMechanismStudy, drivableJoints, MECHANISM_STUDY, mechanismStudyOf } from './mechanism';
import { massOf, partMaterial, partMaterialId } from '../domain/part-material';
import { activeContext, CONTEXT_PREFIX, contextOf, frameInFrame, syncContexts } from './assembly-context';
import { isDirty, type AppState, type Dialog, type ExportFormat, type Workspace, type FabricationTab, type Mode, type PartDisplay, type Selection, type ThemeChoice, type Toast } from './state';

export interface ControllerDeps {
  client: GeometryClient;
  projects: ProjectStore | null;
  /** Calcul de simulation (worker dédié) ; absent : calcul sur le fil principal. */
  simulation?: SimRunner;
  /** Téléchargement des bibliothèques de composants (par défaut : fetch du navigateur). */
  fetch?: typeof fetch;
}

const model: Mode = { kind: 'model' };

const STUDY_ERRORS: Record<StudyErrorCode, string> = {
  NO_FIXED: 'Les faces fixées sont trop petites pour la précision choisie : choisissez une précision plus fine.',
  NO_LOAD: 'Les faces chargées sont trop petites pour la précision choisie : choisissez une précision plus fine.',
  EMPTY: 'La pièce est trop fine pour être découpée en cubes : choisissez une précision plus fine.',
  LOAD_FLOATING: 'La charge appuie sur une pièce qui ne touche pas les pièces tenues (même par une autre pièce) : elle flotterait. Vérifiez que les pièces se touchent.',
};

function displayFor(prev: PartDisplay | undefined, result: PartResult): PartDisplay {
  const failed = result.failedFeatureId !== null;
  if (failed && prev?.mesh) return { result, mesh: prev.mesh, meshKey: prev.meshKey, stale: true };
  return { result, mesh: result.mesh, meshKey: result.meshKey, stale: failed };
}

export class AppController {
  private viewport: Viewport | null = null;
  private readonly autosave: AutosaveScheduler | null;
  private toastId = 1;
  private evalSeq = 0;
  private previewSeq = 0;
  private fitPending = true;
  /** Nouvelle esquisse en cours de création (pas encore dans le document). */
  private newSketch: SketchFeature | null = null;
  /** Derniers repères connus des esquisses (édition d'une esquisse bloquée). */
  private readonly lastFrames = new Map<Id, Frame3D>();

  constructor(
    readonly store: Store<AppState>,
    private readonly deps: ControllerDeps,
  ) {
    this.autosave = deps.projects ? new AutosaveScheduler(deps.projects, (autosave) => this.patchProject({ autosave })) : null;
  }

  get state(): AppState {
    return this.store.get();
  }

  private set(partial: Partial<AppState>): void {
    // Les champs numériques connaissent les paramètres du projet (équations comme « largeur/2 »).
    if (partial.doc && partial.doc.parameters !== this.state.doc.parameters) setParameterScope(resolveParameters(partial.doc.parameters ?? []).values);
    this.store.patch(partial);
  }

  private patchProject(partial: Partial<AppState['project']>): void {
    this.set({ project: { ...this.state.project, ...partial } });
  }

  attachViewport(viewport: Viewport | null): void {
    this.viewport = viewport;
  }

  // =========================================================================
  // Démarrage

  async start(): Promise<void> {
    this.deps.client.ready
      .then((info) => {
        this.set({ kernel: { status: 'ready', initMs: info.initMs } });
        void this.evaluate();
      })
      .catch((err: Error) => {
        this.set({ kernel: { status: 'error', message: err.message } });
      });
    await this.restoreLastSession();
    if (this.deps.projects) void requestPersistentStorage();
    const mascot = await this.deps.projects?.getSetting<{ hidden?: boolean; collapsed?: boolean }>('mascot').catch(() => undefined);
    if (mascot) this.set({ mascot: { ...this.state.mascot, hidden: mascot.hidden ?? true, collapsed: !!mascot.collapsed } });
    // Niveau : celui de l'adresse (?niveau=expert, pratique pour un lien donné en classe), sinon celui retenu.
    const fromUrl = parseLevel(new URLSearchParams(globalThis.location?.search ?? '').get('niveau'));
    const saved = parseLevel(await this.deps.projects?.getSetting<string>('level').catch(() => undefined));
    if (fromUrl) this.setLevel(fromUrl);
    else if (saved) this.setLevel(saved, false);
    // Première ouverture (aucun niveau retenu) : on propose de le choisir ; Expert par défaut.
    else if (this.deps.projects && !this.state.dialog) this.set({ dialog: { kind: 'choose-level' } });
    const tips = await this.deps.projects?.getSetting<boolean>('tips').catch(() => undefined);
    if (tips === false) this.set({ tips: false });
    const theme = await this.deps.projects?.getSetting<string>('theme').catch(() => undefined);
    if (theme === 'light' || theme === 'dark') this.set({ theme });
    const style = await this.deps.projects?.getSetting<string>('displayStyle').catch(() => undefined);
    if (DISPLAY_STYLES.includes(style as DisplayStyle)) this.set({ displayStyle: style as DisplayStyle });
    const edgeWidth = await this.deps.projects?.getSetting<number>('edgeWidth').catch(() => undefined);
    if (typeof edgeWidth === 'number' && edgeWidth >= 0.5 && edgeWidth <= 4) this.set({ edgeWidth });
    const grid = await this.deps.projects?.getSetting<boolean>('sketchGrid').catch(() => undefined);
    if (grid === false) this.set({ sketchGrid: false });
    const libraries = await this.deps.projects?.getSetting<string[]>('libraries').catch(() => undefined);
    if (Array.isArray(libraries) && libraries.every((l) => typeof l === 'string')) this.set({ libraries });
  }

  // ----- Bibliothèques de composants (voir docs/bibliotheques.md)

  /** Ouvre la fenêtre des composants ; les catalogues se chargent (une fois par session). */
  openComponents(): void {
    if (this.state.mode.kind !== 'model') return this.explain('Terminez d’abord l’opération en cours.');
    this.set({ dialog: { kind: 'components', inserting: null } });
    void this.loadLibraries();
  }

  /** Charge les catalogues pas encore chargés (tous si `force`, pour actualiser). */
  async loadLibraries(force = false): Promise<void> {
    const sources = this.state.libraries;
    const known = new Map(this.state.libraryCatalogs.map((c) => [c.source, c]));
    const todo = sources.filter((src) => force || !known.has(src) || known.get(src)!.status === 'error');
    const order = () => sources.map((src) => known.get(src)).filter((c): c is LibraryCatalog => !!c);
    for (const src of todo) known.set(src, { source: src, status: 'loading' });
    this.set({ libraryCatalogs: order() });
    await Promise.all(
      todo.map(async (src) => {
        const catalog = await fetchLibrary(src, this.deps.fetch ?? fetch);
        if (!this.state.libraries.includes(src)) return;
        known.set(src, catalog);
        this.set({ libraryCatalogs: this.state.libraries.map((l) => known.get(l) ?? this.state.libraryCatalogs.find((c) => c.source === l)).filter((c): c is LibraryCatalog => !!c) });
      }),
    );
  }

  /** Ajoute une bibliothèque (adresse d'un dépôt GitHub ou d'un dossier web avec index.json). */
  addLibrary(source: string): boolean {
    const src = source.trim().replace(/\/+$/, '');
    if (!libraryBaseUrl(src)) {
      this.explain('Adresse invalide : indiquez l’adresse https d’un dépôt GitHub (https://github.com/compte/dépôt) ou d’un dossier web contenant index.json.');
      return false;
    }
    if (this.state.libraries.includes(src)) return true;
    const libraries = [...this.state.libraries, src];
    this.set({ libraries });
    void this.deps.projects?.setSetting('libraries', libraries).catch(() => undefined);
    void this.loadLibraries();
    return true;
  }

  removeLibrary(source: string): void {
    const libraries = this.state.libraries.filter((l) => l !== source);
    this.set({ libraries, libraryCatalogs: this.state.libraryCatalogs.filter((c) => c.source !== source) });
    void this.deps.projects?.setSetting('libraries', libraries).catch(() => undefined);
  }

  /**
   * Insère un composant : sa pièce paramétrique (.vibecad, historique complet) est copiée dans le
   * projet ; dans l'atelier Assemblage, elle est aussi insérée dans l'assemblage. Un composant livré
   * seulement en STEP passe par la fenêtre d'import.
   */
  async insertComponent(source: string, componentId: string): Promise<void> {
    const catalog = this.state.libraryCatalogs.find((c) => c.source === source);
    const component = catalog?.status === 'ready' ? catalog.index.collections.flatMap((c) => c.components).find((k) => k.id === componentId) : undefined;
    if (!catalog || catalog.status !== 'ready' || !component) return;
    const fetcher = this.deps.fetch ?? fetch;
    this.set({ dialog: { kind: 'components', inserting: `${source}|${componentId}` } });
    try {
      if (!component.files.vibecad) {
        const res = await fetcher(`${catalog.base}${component.files.step}`);
        if (!res.ok) throw new Error(`Fichier STEP introuvable (réponse ${res.status}).`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        await this.beginImport(new File([bytes], `${component.id}.step`, { type: 'model/step' }));
        return;
      }
      const res = await fetcher(`${catalog.base}${component.files.vibecad}`);
      if (!res.ok) throw new Error(`Fichier du composant introuvable (réponse ${res.status}).`);
      const parsed = parseNativeFile(await res.text());
      if (!parsed.ok) throw new Error(parsed.error);
      if (this.state.mode.kind !== 'model') throw new Error('Terminez d’abord l’opération en cours.');
      // Esquisses masquées : seul le volume du composant s'affiche (l'œil de l'historique les remontre).
      const copy = copyPartsInto(this.state.doc, parsed.doc, parsed.doc.parts.slice(0, 1).map((p) => p.id), { hideSketches: true });
      const partId = copy.partIds[0]!;
      // Nom unique dans le projet : « Roulement 608-2RS (2) » pour un second exemplaire.
      const base = findPart(copy.doc, partId)!.name;
      const taken = new Set(this.state.doc.parts.map((p) => p.name));
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
      const doc = name === base ? copy.doc : renamePart(copy.doc, partId, name);
      const inAssembly = this.state.workspace === 'assembly';
      if (!inAssembly) this.fitPending = true;
      this.commit(doc, `Insérer le composant « ${name} »`, {
        dialog: null,
        ...(inAssembly ? {} : { activePartId: partId, selection: { kind: 'part' as const, partId } }),
      });
      this.toast('success', `« ${name} » ajouté au projet (${catalog.index.name}), avec son historique : il se modifie comme une pièce dessinée ici.`);
      if (inAssembly) await this.insertWhenComputed(partId);
    } catch (err) {
      const d = this.state.dialog;
      if (d?.kind === 'components') this.set({ dialog: { ...d, inserting: null } });
      this.toast('error', `Le composant « ${component.name} » n’a pas pu être inséré.`, { detail: (err as Error).message });
    }
  }

  /** Insère la pièce dans l'assemblage dès que son volume est calculé. */
  private async insertWhenComputed(partId: Id, timeout = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if ((this.state.display[partId]?.result.analysis?.solidCount ?? 0) > 0) return this.insertInstance(partId);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // ----- Collisions de l'assemblage

  private collisionBusy = false;
  private collisionAgain = false;

  /** Active ou coupe la recherche de collisions de l'assemblage (refaite après chaque changement). */
  toggleCollisions(on?: boolean): void {
    const check = on ?? !this.state.collisionCheck;
    this.set({ collisionCheck: check, collisions: check ? this.state.collisions : null });
    if (check) void this.refreshCollisions();
  }

  private async refreshCollisions(): Promise<void> {
    if (this.collisionBusy) {
      this.collisionAgain = true;
      return;
    }
    const placement = this.assemblyPlacement();
    if (!this.state.collisionCheck || !placement || this.state.kernel.status !== 'ready') return;
    const leaves = this.assemblyLeaves(placement);
    this.collisionBusy = true;
    const revision = this.state.revision;
    try {
      const placements = leaves.map((l) => ({ instanceId: l.key, partId: l.partId, matrix: [...l.matrix] }));
      const { collisions } = await this.deps.client.collisions(this.state.doc, placements);
      if (this.state.collisionCheck) this.set({ collisions: { key: `${revision}`, items: collisions } });
    } catch (err) {
      this.toast('error', 'La recherche de collisions a échoué.', { detail: (err as Error).message });
    } finally {
      this.collisionBusy = false;
      if (this.collisionAgain || revision !== this.state.revision) {
        this.collisionAgain = false;
        if (this.state.collisionCheck) void this.refreshCollisions();
      }
    }
  }

  /** Montre ou cache le centre de gravité de la pièce active. */
  /** Montre les pièces de tôlerie à plat (développé), ou pliées. */
  toggleUnfolded(on?: boolean): void {
    this.set({ unfolded: on ?? !this.state.unfolded, fitRequest: this.state.fitRequest + 1 });
  }

  toggleCentroid(on?: boolean): void {
    this.set({ showCentroid: on ?? !this.state.showCentroid });
  }

  // ----- Vue en coupe (affichage seulement)

  private sectionSeq = 0;
  private sectionBusy = false;
  private sectionAgain = false;

  /** Active, règle ou coupe la vue en coupe. Au premier affichage, le plan passe au milieu des pièces. */
  setSection(patch: Partial<SectionPlane> | null): void {
    if (patch === null) {
      this.set({ section: null, sectionParts: null });
      return;
    }
    const current = this.state.section ?? { plane: 'XZ' as const, offset: 0, flip: false };
    let next: SectionPlane = { ...current, ...patch };
    if (!this.state.section || (patch.plane && patch.plane !== current.plane && patch.offset === undefined)) {
      const range = this.sectionRange(next.plane);
      if (range) next = { ...next, offset: Math.round(((range[0] + range[1]) / 2) * 10) / 10 };
    }
    this.set({ section: next, hover: null });
    void this.refreshSection();
  }

  /** Étendue des pièces le long de l'axe perpendiculaire au plan de coupe (null : aucun volume). */
  sectionRange(plane: SectionPlane['plane']): [number, number] | null {
    const axis = plane === 'XY' ? 'z' : plane === 'XZ' ? 'y' : 'x';
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of Object.values(this.state.display)) {
      const b = d.result.analysis?.bbox;
      if (!b) continue;
      lo = Math.min(lo, b.min[axis]);
      hi = Math.max(hi, b.max[axis]);
    }
    return lo <= hi ? [lo, hi] : null;
  }

  /** Demande au moteur les pièces coupées (une seule demande à la fois, la dernière gagne). */
  private async refreshSection(): Promise<void> {
    if (this.sectionBusy) {
      this.sectionAgain = true;
      return;
    }
    const section = this.state.section;
    if (!section || this.state.kernel.status !== 'ready') return;
    this.sectionBusy = true;
    const seq = ++this.sectionSeq;
    try {
      const doc = rolledBackDocument(this.state.doc, this.state.rollback);
      const result = await this.deps.client.section(doc, section);
      if (seq === this.sectionSeq && this.state.section) {
        const parts: Record<Id, { mesh: MeshData | null; cutFaces: number[] }> = {};
        for (const p of result.parts) parts[p.partId] = { mesh: p.mesh, cutFaces: p.cutFaces };
        this.set({ sectionParts: { key: `${this.state.revision}|${section.plane}|${section.offset}|${section.flip}`, parts } });
      }
    } catch (err) {
      this.toast('error', 'La vue en coupe n’a pas pu être calculée.', { detail: (err as Error).message });
    } finally {
      this.sectionBusy = false;
      if (this.sectionAgain) {
        this.sectionAgain = false;
        void this.refreshSection();
      }
    }
  }

  /** Bulles d'explication du chat au survol : activées ou non (retenu sur l'appareil). */
  setTips(on: boolean): void {
    this.set({ tips: on });
    void this.deps.projects?.setSetting('tips', on).catch(() => undefined);
  }

  /** Thème de l'interface (automatique : celui du système). */
  /** Mode d'affichage des pièces, retenu sur l'appareil. */
  setDisplayStyle(displayStyle: DisplayStyle): void {
    this.set({ displayStyle });
    void this.deps.projects?.setSetting('displayStyle', displayStyle).catch(() => undefined);
  }

  /** Épaisseur des arêtes des pièces (0,5 à 4 px), retenue sur l'appareil. */
  setEdgeWidth(width: number): void {
    const edgeWidth = Math.max(0.5, Math.min(4, Math.round(width * 2) / 2));
    this.set({ edgeWidth });
    void this.deps.projects?.setSetting('edgeWidth', edgeWidth).catch(() => undefined);
  }

  setTheme(theme: ThemeChoice): void {
    this.set({ theme });
    void this.deps.projects?.setSetting('theme', theme).catch(() => undefined);
  }

  /** Aimantation à la grille au début des esquisses ; s'applique aussi à l'esquisse ouverte. */
  setSketchGrid(on: boolean): void {
    this.set({ sketchGrid: on });
    void this.deps.projects?.setSetting('sketchGrid', on).catch(() => undefined);
    const mode = this.state.mode;
    if (mode.kind === 'sketch' && mode.session.snapToGrid !== on) this.updateSession((x) => ({ ...x, snapToGrid: on }));
  }

  /** Préférences de l'appareil remises à leur valeur de départ. */
  resetPreferences(): void {
    this.setLevel('expert');
    this.setTips(true);
    this.setTheme('auto');
    this.setSketchGrid(true);
    this.setDisplayStyle('shaded-edges');
    this.setEdgeWidth(1);
    this.setMascot({ hidden: true, collapsed: false, dismissed: null });
  }

  /** Change le niveau de l'interface ; ce qui n'est plus montré est refermé. */
  setLevel(level: Level, persist = true): void {
    const s = this.state;
    const patch: Partial<AppState> = { level };
    // Les sous-assemblages ne sont plus montrés : on revient à l'assemblage principal.
    if (s.doc.editingSubassembly && !allows(level, 'assembly:subassemblies')) Object.assign(patch, { doc: closedDocument(s.doc), assemblySelection: null });
    if (s.workspace === 'assembly' && !allows(level, 'workspace:assembly')) Object.assign(patch, { workspace: 'parts', assemblySelection: null });
    if ((s.fabricationTab === 'laser' && !allows(level, 'fabrication:laser')) || (s.fabricationTab === 'docs' && !allows(level, 'fabrication:docs'))) {
      patch.fabricationTab = 'print';
    }
    this.set(patch);
    const mode = this.state.mode;
    if (mode.kind === 'sketch' && !allows(level, `sketch:${mode.session.tool}`)) this.updateSession((x) => setTool(x, 'select'));
    if (persist) void this.deps.projects?.setSetting('level', level).catch(() => undefined);
  }

  /** Vrai si le niveau actuel montre cet outil. */
  can(cap: Capability): boolean {
    return allows(this.state.level, cap);
  }

  private async restoreLastSession(): Promise<void> {
    const store = this.deps.projects;
    if (!store) {
      this.patchProject({ storageAvailable: false });
      return;
    }
    try {
      const lastId = await store.getSetting<string>('lastProjectId');
      const drafts = await store.listAutosaves();
      const draft = drafts.find((d) => d.projectId === lastId) ?? drafts[0];
      if (draft) {
        const saved = await store.getProject(draft.projectId);
        this.set({ dialog: { kind: 'recovery', autosave: draft, savedAt: saved?.savedAt ?? null } });
        return;
      }
      if (lastId) {
        const project = await store.getProject(lastId);
        if (project) this.loadFromText(project.text, { savedAt: project.savedAt, dirty: false });
      }
    } catch {
      this.patchProject({ storageAvailable: false });
    }
  }

  async recover(): Promise<void> {
    const d = this.state.dialog;
    if (d?.kind !== 'recovery' || !this.deps.projects) return;
    const rec = await this.deps.projects.getAutosave(d.autosave.projectId);
    this.set({ dialog: null });
    if (rec) {
      this.loadFromText(rec.text, { savedAt: d.savedAt, dirty: true });
      this.toast('success', 'Travail récupéré. Pensez à l’enregistrer.');
    }
  }

  async openSavedInsteadOfRecovery(): Promise<void> {
    const d = this.state.dialog;
    if (d?.kind !== 'recovery' || !this.deps.projects) return;
    const project = await this.deps.projects.getProject(d.autosave.projectId);
    await this.deps.projects.deleteAutosave(d.autosave.projectId);
    this.set({ dialog: null });
    if (project) this.loadFromText(project.text, { savedAt: project.savedAt, dirty: false });
  }

  async discardRecovery(): Promise<void> {
    const d = this.state.dialog;
    if (d?.kind !== 'recovery') return;
    await this.deps.projects?.deleteAutosave(d.autosave.projectId);
    this.set({ dialog: null });
  }

  // =========================================================================
  // Document, annuler / rétablir

  /** Applique une transaction annulable sur le document. */
  commit(doc: CadDocument, label: string, extra: Partial<AppState> = {}): void {
    // Une modification pendant l'animation d'un mécanisme l'arrête, à la position atteinte.
    if (this.animation) this.stopJointAnimation(false);
    const s = this.state;
    // Conception en contexte : les voisines suivent l'assemblage modifié (même étape d'annulation).
    doc = this.syncContexts(doc);
    this.set({ ...extra, doc, history: recordAction(s.history, s.doc, label), revision: s.revision + 1 });
    this.sanitize();
    this.afterChange();
  }

  /** Positions des voisines dans les références en contexte d'assemblage, recalculées. */
  private syncContexts(doc: CadDocument): CadDocument {
    return syncContexts(doc, (partId) => this.state.display[partId]?.mesh, this.sketchesOf);
  }

  private afterChange(): void {
    void this.evaluate();
    this.autosave?.schedule(this.state.doc, this.state.project.savedAt);
  }

  /** Corrige la pièce active et la sélection si elles n'existent plus. */
  private sanitize(): void {
    const s = this.state;
    const patch: Partial<AppState> = {};
    if (!findPart(s.doc, s.activePartId) && s.doc.parts[0]) patch.activePartId = s.doc.parts[0].id;
    const sel = s.selection;
    if (sel) {
      const part = findPart(s.doc, sel.partId);
      if (!part || (sel.kind === 'feature' && !part.features.some((f) => f.id === sel.featureId))) patch.selection = null;
    }
    if (Object.keys(patch).length > 0) this.set(patch);
  }

  undo(): void {
    if (this.animation) this.stopJointAnimation();
    const s = this.state;
    if (s.mode.kind === 'sketch') return;
    if (s.mode.kind !== 'model') {
      this.explain('Validez ou annulez d’abord l’opération en cours.');
      return;
    }
    const r = undoAction(s.history, s.doc);
    if (!r) {
      this.toast('info', 'Rien à annuler.');
      return;
    }
    this.set({ doc: r.doc, history: r.history, revision: s.revision + 1, selection: null });
    this.sanitize();
    this.toast('info', `Annulé : ${r.label}`);
    this.afterChange();
  }

  redo(): void {
    if (this.animation) this.stopJointAnimation();
    const s = this.state;
    if (s.mode.kind !== 'model') return;
    const r = redoAction(s.history, s.doc);
    if (!r) {
      this.toast('info', 'Rien à rétablir.');
      return;
    }
    this.set({ doc: r.doc, history: r.history, revision: s.revision + 1, selection: null });
    this.sanitize();
    this.toast('info', `Rétabli : ${r.label}`);
    this.afterChange();
  }

  private loadFromText(text: string, meta: { savedAt: string | null; dirty: boolean; fileName?: string }): boolean {
    const parsed = parseNativeFile(text);
    if (!parsed.ok) {
      this.set({ dialog: { kind: 'problem', title: 'Impossible d’ouvrir ce projet', message: parsed.error, details: parsed.details } });
      return false;
    }
    this.loadDocument(parsed.doc, meta);
    if (parsed.migratedFrom !== null) this.toast('info', `Projet converti depuis le format ${parsed.migratedFrom}. Enregistrez-le pour garder la nouvelle version.`);
    if (parsed.warnings.length > 0) this.toast('info', `Le projet a été ouvert avec ${parsed.warnings.length} avertissement(s).`, { detail: parsed.warnings.join('\n') });
    void verifyResources(parsed.doc.resources).then((altered) => {
      if (altered.length > 0) this.toast('error', `Les données importées de ${altered.join(', ')} semblent modifiées.`);
    });
    return true;
  }

  private loadDocument(docIn: CadDocument, meta: { savedAt: string | null; dirty: boolean; fileName?: string }): void {
    const doc = docIn.parts.length > 0 ? docIn : addPart(docIn).doc;
    this.autosave?.cancel();
    this.newSketch = null;
    this.lastFrames.clear();
    const revision = meta.dirty ? 1 : 0;
    this.set({
      doc,
      history: emptyHistory(),
      revision,
      activePartId: doc.parts[0]!.id,
      mode: model,
      selection: null,
      hover: null,
      rollback: {},
      display: {},
      preview: null,
      dialog: null,
      project: {
        ...this.state.project,
        savedAt: meta.savedAt,
        savedRevision: meta.dirty ? (meta.savedAt ? 0 : null) : 0,
        file: meta.fileName ? { name: meta.fileName } : null,
        autosave: { kind: 'idle' },
      },
    });
    this.fitPending = true;
    void this.deps.projects?.setSetting('lastProjectId', doc.id).catch(() => undefined);
    void this.evaluate();
    if (meta.dirty) this.autosave?.schedule(doc, meta.savedAt);
  }

  // =========================================================================
  // Barre de retour en arrière (frise de l'historique)

  /** Place la barre après les `count` premières étapes de la pièce (toutes : fin de l'historique). */
  setRollback(partId: Id, count: number): void {
    if (this.state.mode.kind !== 'model') return this.explain('Terminez d’abord l’opération en cours pour revenir en arrière dans l’historique.');
    const part = findPart(this.state.doc, partId);
    if (!part) return;
    const rollback = withRollbackAt(this.state.rollback, part, count);
    if (activeCount(part, rollback) === activeCount(part, this.state.rollback)) return;
    const sel = this.state.selection;
    // Faces et arêtes sélectionnées appartiennent à l'ancien état de la pièce.
    this.set({ rollback, activePartId: partId, hover: null, selection: sel && (sel.kind === 'face' || sel.kind === 'edge') ? null : sel });
    void this.evaluate();
  }

  stepRollback(partId: Id, delta: number): void {
    const part = findPart(this.state.doc, partId);
    if (part) this.setRollback(partId, activeCount(part, this.state.rollback) + delta);
  }

  rollbackToEnd(partId: Id): void {
    const part = findPart(this.state.doc, partId);
    if (part) this.setRollback(partId, part.features.length);
  }

  // =========================================================================
  // Recalcul

  async evaluate(): Promise<void> {
    if (this.state.kernel.status !== 'ready') return;
    const { doc, revision } = this.state;
    // Barre de retour en arrière : seules les étapes actives sont calculées et affichées.
    const rollback = normalizeRollback(doc, this.state.rollback);
    if (rollback !== this.state.rollback) this.set({ rollback });
    const seq = ++this.evalSeq;
    this.set({ evaluating: true });
    try {
      const result = await this.deps.client.evaluate(rolledBackDocument(doc, rollback));
      if (!result || seq !== this.evalSeq || revision !== this.state.revision || rollback !== this.state.rollback) return;
      const prev = this.state.display;
      const hadSolid = Object.values(prev).some((d) => (d.result.analysis?.solidCount ?? 0) > 0);
      const display: Record<Id, PartDisplay> = {};
      for (const part of result.parts) {
        display[part.partId] = displayFor(prev[part.partId], part);
        for (const sk of part.sketches) if (sk.frame) this.lastFrames.set(sk.featureId, sk.frame);
      }
      const hasSolid = result.parts.some((p) => (p.analysis?.solidCount ?? 0) > 0);
      if (!hadSolid && hasSolid) this.fitPending = true;
      // Le cadrage voyage avec les maillages : la vue cadre après les avoir reçus.
      const fitRequest = this.fitPending ? this.state.fitRequest + 1 : this.state.fitRequest;
      this.fitPending = false;
      this.set({ display, fitRequest, evaluating: this.deps.client.busy, lastEvaluation: { durationMs: result.durationMs, memoryBytes: result.memoryBytes } });
      // Une pièce a changé de forme : les repères des liaisons, donc la place des voisines, aussi.
      // Report silencieux (sans nouvelle étape d'annulation), puis recalcul.
      const synced = this.syncContexts(this.state.doc);
      if (synced !== this.state.doc) {
        this.set({ doc: synced, revision: this.state.revision + 1 });
        this.afterChange();
        return;
      }
      if (this.state.section) void this.refreshSection();
      if (this.state.collisionCheck) void this.refreshCollisions();
      // Esquisse ouverte : les arêtes projetables suivent la pièce recalculée.
      const mode = this.state.mode;
      if (mode.kind === 'sketch') {
        const session = setProjectable(mode.session, this.projectables(mode.session.partId, mode.session.frame, mode.session.featureId));
        if (session !== mode.session) this.set({ mode: { kind: 'sketch', session } });
      }
    } catch (err) {
      if (seq !== this.evalSeq) return;
      this.set({ evaluating: false });
      this.toast('error', 'Le recalcul de la géométrie a échoué.', { detail: (err as Error).message });
    }
  }

  // =========================================================================
  // Sélection

  select(selection: Selection): void {
    const patch: Partial<AppState> = { selection };
    if (selection) patch.activePartId = selection.partId;
    this.set(patch);
  }

  setHover(pick: ModelPick | null): void {
    // Vue en coupe : les faces affichées ne sont pas celles de la pièce, on ne les désigne pas.
    if (this.state.section && this.state.workspace === 'parts') pick = null;
    const h = this.state.hover;
    if (h === pick || (h && pick && h.partId === pick.partId && h.kind === pick.kind && h.index === pick.index)) return;
    this.set({ hover: pick });
  }

  handlePick(pick: ModelPick | null, info: { shift: boolean; double: boolean }): void {
    if (this.state.section && this.state.workspace === 'parts' && pick && this.state.mode.kind !== 'sketch') {
      return this.explain('Vue en coupe : quittez-la (bouton « Coupe ») pour choisir une face ou une arête.');
    }
    if (this.state.workspace === 'assembly') return this.assemblyPick(pick);
    if (this.state.workspace === 'fabrication') return this.fabricationPick(pick);
    if (this.state.workspace === 'simulation') return this.simulationPick(pick);
    const mode = this.state.mode;
    // Pièce voisine (conception en contexte d'assemblage) : seulement pour poser une esquisse.
    if (pick?.partId.startsWith(CONTEXT_PREFIX)) {
      const key = pick.partId.slice(CONTEXT_PREFIX.length);
      if (pick.kind === 'face' && mode.kind === 'pick-support') this.sketchOnContextFace(key, pick.index, mode.repairFeatureId, mode.partId);
      else if (pick.kind === 'face' && mode.kind === 'model' && info.double) this.sketchOnContextFace(key, pick.index, null, this.state.activePartId);
      else if (mode.kind === 'model' && !info.double) this.select(null);
      else if (mode.kind !== 'model') this.explain('Pièce voisine dans l’assemblage : elle sert d’appui à une esquisse (double-clic sur une de ses faces), pas aux autres outils.');
      return;
    }
    if (mode.kind === 'pick-support') {
      // La face peut être celle d'une autre pièce : l'esquisse reste dans la pièce choisie.
      if (pick?.kind === 'face') this.sketchOnFace(pick.partId, pick.index, mode.repairFeatureId, mode.partId);
      return;
    }
    if (mode.kind === 'measure') {
      if (pick) void this.measurePick(pick);
      return;
    }
    if (mode.kind === 'feature') {
      if (pick) this.pickForDraft(pick);
      return;
    }
    if (mode.kind !== 'model') return;
    if (!pick) {
      this.select(null);
      return;
    }
    if (pick.kind === 'vertex') return;
    this.select({ kind: pick.kind, partId: pick.partId, index: pick.index });
    if (info.double && pick.kind === 'face') this.sketchOnFace(pick.partId, pick.index, null);
  }

  // =========================================================================
  // Pièces et fonctions

  addPart(): void {
    if (this.state.mode.kind !== 'model') return this.explain('Terminez d’abord l’opération en cours.');
    const r = addPart(this.state.doc);
    this.commit(r.doc, 'Ajouter une pièce', { activePartId: r.partId, selection: { kind: 'part', partId: r.partId } });
  }

  /** Isoler une pièce (elle seule est affichée), ou revenir à l'affichage d'avant. */
  toggleIsolate(partId: Id): void {
    const part = findPart(this.state.doc, partId);
    if (!part) return;
    if (this.state.isolatedPartId === partId) return this.set({ isolatedPartId: null });
    this.set({ isolatedPartId: partId, ...(this.state.mode.kind === 'model' ? { activePartId: partId, selection: { kind: 'part' as const, partId } } : {}) });
  }

  setActivePart(partId: Id): void {
    if (this.state.mode.kind !== 'model') return;
    // Une autre pièce choisie : on quitte la conception dans l'assemblage.
    const ctx = this.state.assemblyContext;
    const keep = ctx && this.state.doc.assembly?.instances.find((i) => i.id === ctx.instanceId)?.partId === partId;
    this.set({ activePartId: partId, selection: { kind: 'part', partId }, ...(keep ? {} : { assemblyContext: null }) });
  }

  // ----- Conception en contexte d'assemblage (voir docs/conception-en-contexte.md)

  /** Modifie la pièce d'une insertion à sa place dans l'assemblage (onglet Pièces, voisines autour). */
  editInAssembly(instanceId: Id): void {
    const instance = this.state.doc.assembly?.instances.find((i) => i.id === instanceId);
    if (!instance) return;
    if (instance.subassemblyId) return this.explain('Un sous-assemblage se modifie depuis son propre assemblage (Assemblage ▾ en haut du panneau).');
    if (this.state.mode.kind !== 'model') return this.explain('Terminez d’abord l’opération en cours.');
    this.setWorkspace('parts');
    if (this.state.workspace !== 'parts') return;
    this.set({ assemblyContext: { instanceId }, activePartId: instance.partId, selection: { kind: 'part', partId: instance.partId }, fitRequest: this.state.fitRequest + 1 });
  }

  /** Quitte la conception dans l'assemblage et revient à l'onglet Assemblage, sur l'insertion. */
  leaveAssemblyContext(): void {
    const ctx = this.state.assemblyContext;
    if (this.state.mode.kind !== 'model') return this.explain('Terminez d’abord l’opération en cours.');
    this.set({ assemblyContext: null });
    this.setWorkspace('assembly');
    if (ctx && this.state.workspace === 'assembly') this.set({ assemblySelection: { kind: 'instance', id: ctx.instanceId } });
  }

  /**
   * Fige (ou libère) la place des voisines dans une esquisse en contexte d'assemblage : figée, elle
   * ne suit plus les changements de l'assemblage (la forme de la voisine, elle, est toujours suivie).
   */
  toggleContextFrozen(featureId: Id): void {
    const found = findFeature(this.state.doc, featureId);
    if (!found || found.feature.type !== 'sketch') return;
    const sketch = found.feature;
    const support = sketch.params.support;
    const current = support.kind === 'face' ? support.context : undefined;
    const refs = sketch.params.entities.filter((e) => (e.type === 'line' || e.type === 'circle') && e.reference?.context);
    if (!current && refs.length === 0) return;
    const frozen = !(current?.frozen ?? false);
    const set = <T extends { frozen?: boolean }>(c: T): T => {
      const { frozen: _f, ...rest } = c;
      return (frozen ? { ...rest, frozen: true } : rest) as T;
    };
    const params = {
      ...sketch.params,
      support: support.kind === 'face' && support.context ? { ...support, context: set(support.context) } : support,
      entities: sketch.params.entities.map((e) => ((e.type === 'line' || e.type === 'circle') && e.reference?.context ? { ...e, reference: { ...e.reference, context: set(e.reference.context) } } : e)),
    };
    this.commit(updateFeature<SketchFeature>(this.state.doc, featureId, (f) => ({ ...f, params })), frozen ? `Figer « ${sketch.name} » dans l’assemblage` : `Suivre l’assemblage pour « ${sketch.name} »`);
  }

  /** Esquisse de la pièce `targetPartId` posée sur la face d'une pièce voisine dans l'assemblage. */
  sketchOnContextFace(leafKey: string, faceIndex: number, repairFeatureId: Id | null, targetPartId: Id): boolean {
    const ctx = activeContext(this.state);
    const leaf = ctx?.leaves.find((l) => l.key === leafKey);
    if (!ctx || !leaf) return false;
    const display = this.state.display[leaf.partId];
    const face = display?.mesh?.faces[faceIndex];
    const part = findPart(this.state.doc, leaf.partId);
    if (!display || !face || !part) return false;
    if (face.surface !== 'plane' || !face.plane) {
      this.explain('Cette face n’est pas plane : une esquisse se pose sur une face plate ou sur un plan d’origine.');
      return false;
    }
    if (leaf.partId === targetPartId) {
      this.explain('C’est une autre insertion de la même pièce : une pièce ne peut pas s’appuyer sur elle-même.');
      return false;
    }
    if (partDependsOn(this.state.doc, leaf.partId, targetPartId)) {
      this.explain(`« ${part.name} » reprend déjà cette pièce : s’appuyer sur elle ferait une boucle. Choisissez une autre face ou un plan.`);
      return false;
    }
    const ref = pickFaceReference(face.tags, part);
    if (!ref) return false;
    // Repère de la face dans le repère de la pièce modifiée (la voisine placée comme dans l'assemblage).
    const frame = canonicalFrame(transformPoint4(leaf.local, face.plane.origin), transformDirection4(leaf.local, face.plane.normal));
    this.beginSketchOn(targetPartId, { kind: 'face', ref, partId: leaf.partId, context: contextOf(ctx.instanceId, leaf) }, frame, repairFeatureId);
    return true;
  }

  renamePart(partId: Id, name: string): void {
    const trimmed = name.trim();
    const part = findPart(this.state.doc, partId);
    if (!part || !trimmed || trimmed === part.name) return;
    this.commit(renamePart(this.state.doc, partId, trimmed), `Renommer la pièce « ${trimmed} »`);
  }

  togglePartVisible(partId: Id): void {
    const part = findPart(this.state.doc, partId);
    if (!part) return;
    this.commit(setPartVisible(this.state.doc, partId, !part.visible), part.visible ? `Masquer « ${part.name} »` : `Afficher « ${part.name} »`);
  }

  setPartColor(partId: Id, color: string): void {
    const part = findPart(this.state.doc, partId);
    if (!part || part.color === color) return;
    this.commit(setPartColor(this.state.doc, partId, color), `Changer la couleur de « ${part.name} »`);
  }

  /** Matière de la pièce : masse (Propriétés), matériau par défaut de ses études de simulation. */
  setPartMaterial(partId: Id, material: string): void {
    const part = findPart(this.state.doc, partId);
    if (!part || part.material === material) return;
    this.commit(setPartMaterial(this.state.doc, partId, material), `Matière de « ${part.name} »`);
  }

  /** Ouvre ou ferme le panneau Propriétés de la pièce active. */
  toggleProperties(open?: boolean): void {
    const next = open ?? !this.state.propertiesOpen;
    this.set({ propertiesOpen: next, ...(next ? { rightPanelHidden: false } : {}) });
  }

  deletePart(partId: Id): void {
    const part = findPart(this.state.doc, partId);
    if (!part || this.state.mode.kind !== 'model') return;
    let doc = removePart(this.state.doc, partId);
    if (doc.parts.length === 0) doc = addPart(doc).doc;
    this.commit(doc, `Supprimer la pièce « ${part.name} »`, { selection: null });
    this.toast('info', `Pièce « ${part.name} » supprimée.`, { actionLabel: 'Annuler', action: () => this.undo() });
  }

  renameFeature(featureId: Id, name: string): void {
    const found = findFeature(this.state.doc, featureId);
    const trimmed = name.trim();
    if (!found || !trimmed || trimmed === found.feature.name) return;
    this.commit(renameFeature(this.state.doc, featureId, trimmed), `Renommer « ${trimmed} »`);
  }

  /** Afficher ou masquer une esquisse ou une image de référence. */
  toggleSketchVisible(featureId: Id): void {
    const found = findFeature(this.state.doc, featureId);
    if (!found || (found.feature.type !== 'sketch' && found.feature.type !== 'image')) return;
    const visible = !found.feature.visible;
    this.commit(
      updateFeature<SketchFeature | ImageFeature>(this.state.doc, featureId, (f) => ({ ...f, visible })),
      visible ? `Afficher « ${found.feature.name} »` : `Masquer « ${found.feature.name} »`,
    );
  }

  deleteFeature(featureId: Id): void {
    const found = findFeature(this.state.doc, featureId);
    if (!found || this.state.mode.kind !== 'model') return;
    const { doc, removed } = removeFeaturesCascade(this.state.doc, found.part.id, [featureId], featureDependencies);
    const names = removed.map((id) => found.part.features.find((f) => f.id === id)?.name ?? id);
    const label = names.length > 1 ? `Supprimer « ${names[0]} » et ${names.length - 1} étape(s) dépendante(s)` : `Supprimer « ${names[0]} »`;
    this.commit(doc, label, { selection: null });
    const text = names.length > 1 ? `Supprimé : ${names.join(', ')} (ces étapes dépendaient de « ${names[0]} »).` : `« ${names[0]} » supprimé.`;
    this.toast('info', text, { actionLabel: 'Annuler', action: () => this.undo() });
  }

  deleteSelection(): void {
    const sel = this.state.selection;
    if (!sel) return this.explain('Sélectionnez d’abord une étape de l’historique ou une pièce à supprimer.');
    if (sel.kind === 'feature') return this.deleteFeature(sel.featureId);
    if (sel.kind === 'part') return this.deletePart(sel.partId);
    this.explain('Une face ou une arête ne se supprime pas directement : pour retirer de la matière, dessinez une esquisse puis faites une poche.');
  }

  /** Ouvre l'édition d'une étape existante (double-clic dans l'historique). */
  editFeature(featureId: Id): void {
    if (this.state.mode.kind !== 'model') return this.explain('Terminez d’abord l’opération en cours.');
    const found = findFeature(this.state.doc, featureId);
    if (!found) return;
    const { feature, part } = found;
    if (part.features.indexOf(feature) >= activeCount(part, this.state.rollback)) {
      return this.explain(`« ${feature.name} » est après la barre de retour : avancez la barre (frise en bas de la vue) pour la recalculer avant de la modifier.`);
    }
    if (feature.type === 'sketch') {
      const result = this.state.display[part.id]?.result.sketches.find((s) => s.featureId === featureId);
      const frame = result?.frame ?? this.lastFrames.get(featureId) ?? null;
      const status = this.state.display[part.id]?.result.statuses.find((s) => s.featureId === featureId);
      if (!frame || status?.code === 'SUPPORT_LOST' || status?.code === 'SUPPORT_NOT_PLANAR' || status?.code === 'SUPPORT_AMBIGUOUS') {
        this.set({ mode: { kind: 'pick-support', partId: part.id, repairFeatureId: featureId }, selection: null, activePartId: part.id });
        this.toast('info', `Choisissez le nouveau plan ou la nouvelle face de « ${feature.name} » : son dessin sera conservé.`);
        return;
      }
      // Les éléments repris de la pièce ont pu bouger au recalcul : on part de la géométrie résolue.
      const params = result?.converged ? { ...feature.params, entities: result.solved.entities } : feature.params;
      this.openSession(part.id, featureId, false, frame, params);
      return;
    }
    const def = FEATURE_DEFINITIONS[feature.type] as unknown as FeatureDefinition;
    if (def.tool) {
      // Un champ lié à un paramètre se rouvre avec son équation.
      this.openDraft({ partId: part.id, isNew: false, feature, fields: { ...def.tool.initialFields(feature), ...(feature.expressions ?? {}) }, errors: {} });
      return;
    }
    this.toast('info', 'Un solide importé n’a pas de paramètres modifiables : sa forme vient du fichier STEP.');
  }

  /** Change le support d'une esquisse (réparation d'une référence perdue). */
  repairSketch(featureId: Id): void {
    const found = findFeature(this.state.doc, featureId);
    if (!found || this.state.mode.kind !== 'model') return;
    this.set({ mode: { kind: 'pick-support', partId: found.part.id, repairFeatureId: featureId }, selection: null, activePartId: found.part.id });
  }

  // =========================================================================
  // Esquisses

  startSketch(): void {
    const avail = sketchAvailability(this.state);
    if (!avail.ok) return this.explain(avail.reason);
    const sel = this.state.selection;
    if (sel?.kind === 'face' && this.sketchOnFace(sel.partId, sel.index, null)) return;
    this.set({ mode: { kind: 'pick-support', partId: this.state.activePartId, repairFeatureId: null }, selection: null });
  }

  cancelPickSupport(): void {
    if (this.state.mode.kind === 'pick-support') this.set({ mode: model });
  }

  pickPlane(plane: PlaneName): void {
    const mode = this.state.mode;
    if (mode.kind !== 'pick-support') return;
    this.beginSketchOn(mode.partId, { kind: 'plane', plane, offset: 0 }, originPlaneFrame(plane), mode.repairFeatureId);
  }

  /** Esquisse sur un plan de construction de la pièce. */
  pickDatum(featureId: Id): void {
    const mode = this.state.mode;
    if (mode.kind !== 'pick-support') return;
    const frame = this.state.display[mode.partId]?.result.planes.find((p) => p.featureId === featureId)?.frame;
    if (!frame) return this.explain('Ce plan de construction n’a pas pu être calculé : corrigez-le d’abord.');
    this.beginSketchOn(mode.partId, { kind: 'datum', featureId }, frame, mode.repairFeatureId);
  }

  /**
   * Esquisse sur une face : dans la pièce de la face, ou dans `targetPartId` si c'est une autre
   * pièce (la face d'appui est alors désignée avec la pièce qui la porte, et suit sa forme finale).
   */
  sketchOnFace(partId: Id, faceIndex: number, repairFeatureId: Id | null, targetPartId: Id = partId): boolean {
    const display = this.state.display[partId];
    const face = display?.mesh?.faces[faceIndex];
    const part = findPart(this.state.doc, partId);
    if (!display || !face || !part) return false;
    if (display.stale) {
      this.explain('La pièce affichée n’est pas à jour : corrigez d’abord l’étape en erreur avant de dessiner sur ses faces.');
      return false;
    }
    if (face.surface !== 'plane' || !face.plane) {
      this.explain('Cette face n’est pas plane : une esquisse se pose sur une face plate ou sur un plan d’origine.');
      return false;
    }
    const ref = pickFaceReference(face.tags, part);
    if (!ref) return false;
    if (targetPartId !== partId) {
      if (partDependsOn(this.state.doc, partId, targetPartId)) {
        this.explain(`« ${part.name} » reprend déjà la pièce active : s’appuyer sur elle ferait une boucle. Choisissez une autre face ou un plan.`);
        return false;
      }
      this.beginSketchOn(targetPartId, { kind: 'face', ref, partId }, canonicalFrame(face.plane.origin, face.plane.normal), repairFeatureId);
      return true;
    }
    if (repairFeatureId) {
      const index = part.features.findIndex((f) => f.id === repairFeatureId);
      const refIndex = part.features.findIndex((f) => f.id === ref.featureId);
      if (refIndex >= index) {
        this.explain('Cette face est créée après l’esquisse dans l’historique : choisissez une face plus ancienne ou un plan.');
        return false;
      }
    }
    this.beginSketchOn(partId, { kind: 'face', ref }, canonicalFrame(face.plane.origin, face.plane.normal), repairFeatureId);
    return true;
  }

  private beginSketchOn(partId: Id, support: SketchSupport, frame: Frame3D, repairFeatureId: Id | null): void {
    const s = this.state;
    const part = findPart(s.doc, partId);
    if (!part) return;
    if (repairFeatureId) {
      const found = findFeature(s.doc, repairFeatureId);
      if (!found || found.feature.type !== 'sketch') return;
      this.openSession(partId, repairFeatureId, false, frame, { ...found.feature.params, support }, true);
      return;
    }
    const feature = makeSketchFeature(s.doc, part, support);
    this.newSketch = feature;
    this.openSession(partId, feature.id, true, frame, feature.params);
  }

  /**
   * Arêtes reprenables par « Projeter » : celles de la pièce (avant l'esquisse) et celles des autres
   * pièces visibles du projet, sauf celles qui dépendent de cette pièce (boucle).
   */
  private projectables(partId: Id, frame: Frame3D, featureId: Id): ProjectableCurve[] {
    const s = this.state;
    const part = findPart(s.doc, partId);
    if (!part) return [];
    const own = projectableCurves(s.display[partId]?.mesh, frame, part, featureId);
    // Conception dans l'assemblage : les arêtes des voisines, à leur place (repère de l'esquisse
    // exprimé dans celui de la voisine), reprises avec le contexte.
    const ctx = activeContext(s);
    if (ctx && ctx.partId === partId) {
      const neighbours = ctx.leaves.flatMap((leaf) => {
        const p = findPart(s.doc, leaf.partId);
        if (!p || p.id === partId || s.display[p.id]?.stale || partDependsOn(s.doc, p.id, partId)) return [];
        const local = frameInFrame(invertRigid4(leaf.local), frame);
        const context = contextOf(ctx.instanceId, leaf);
        return projectableCurves(s.display[p.id]?.mesh, local, p, featureId, true).map((c) => ({ ...c, context }));
      });
      return [...own, ...neighbours];
    }
    const others = s.doc.parts
      .filter((p) => p.id !== partId && p.visible && !s.display[p.id]?.stale && !partDependsOn(s.doc, p.id, partId))
      .flatMap((p) => projectableCurves(s.display[p.id]?.mesh, frame, p, featureId, true));
    return [...own, ...others];
  }

  private openSession(partId: Id, featureId: Id, isNew: boolean, frame: Frame3D, params: SketchFeature['params'], supportChanged = false): void {
    const projectable = this.projectables(partId, frame, featureId);
    let session = createSession({ featureId, partId, isNew, frame, sketch: params, projectable });
    if (!this.state.sketchGrid) session = { ...session, snapToGrid: false };
    if (supportChanged) session = { ...session, dirty: true };
    const px = this.viewport?.pixelSize();
    if (px) session = setPixelSize(session, px);
    this.set({ mode: { kind: 'sketch', session }, activePartId: partId, selection: null, hover: null });
  }

  /** Applique une transformation à la session d'esquisse en cours. */
  updateSession(fn: (session: SketchSession) => SketchSession): void {
    const mode = this.state.mode;
    if (mode.kind !== 'sketch') return;
    const next = fn(mode.session);
    if (next !== mode.session) this.set({ mode: { kind: 'sketch', session: next } });
  }

  finishSketch(): void {
    const mode = this.state.mode;
    if (mode.kind !== 'sketch') return;
    const session = mode.session;
    const s = this.state;
    if (session.isNew) {
      const feature = this.newSketch;
      this.newSketch = null;
      if (!feature || session.sketch.entities.length === 0) {
        this.set({ mode: model });
        this.toast('info', 'Esquisse vide : rien n’a été ajouté.');
        return;
      }
      const sketch: SketchFeature = { ...feature, params: session.sketch };
      this.commit(this.insertAtMarker(s.doc, session.partId, sketch), `Créer « ${sketch.name} »`, {
        mode: model,
        selection: { kind: 'feature', partId: session.partId, featureId: sketch.id },
        ...this.markerAfterInsert(session.partId, sketch.id),
      });
      return;
    }
    const found = findFeature(s.doc, session.featureId);
    if (!found || found.feature.type !== 'sketch') {
      this.set({ mode: model });
      return;
    }
    if (!session.dirty) {
      this.set({ mode: model, selection: { kind: 'feature', partId: session.partId, featureId: session.featureId } });
      return;
    }
    const updated: SketchFeature = { ...found.feature, params: session.sketch };
    this.commit(replaceFeature(s.doc, updated), `Modifier « ${updated.name} »`, {
      mode: model,
      selection: { kind: 'feature', partId: session.partId, featureId: updated.id },
    });
  }

  cancelSketch(force = false): void {
    const mode = this.state.mode;
    if (mode.kind !== 'sketch') return;
    if (mode.session.dirty && !force) {
      this.set({ dialog: { kind: 'confirm-leave-sketch' } });
      return;
    }
    this.newSketch = null;
    this.set({ mode: model, dialog: null });
  }

  // =========================================================================
  // Opérations volumiques (extrusion, poche…) : panneau de paramètres avec aperçu

  /** Démarre une opération proposée par la barre d'outils (voir `FeatureDefinition.tool`). */
  startFeature(type: FeatureType): void {
    if (!this.can(`feature:${type}`)) return this.explain('Cet outil n’est pas disponible à ce niveau (en bas à droite : « Niveau »).');
    if (type === 'image') return void this.startImage();
    const avail = toolAvailability(this.state, type);
    if (!avail.ok) return this.explain(avail.reason);
    const def = FEATURE_DEFINITIONS[type] as unknown as FeatureDefinition;
    const tool = def.tool!;
    const sel = this.state.selection;
    const part = (sel && findPart(this.state.doc, sel.partId)) || activePart(this.state)!;
    const result = this.state.display[part.id]?.result;
    let input: ToolInput;
    let sketchFrame = null;
    if (tool.input === 'sketch') {
      const sketch = suggestedSketch(this.state, part, type)!;
      input = { kind: 'sketch', sketchId: sketch.id };
      sketchFrame = result?.sketches.find((x) => x.featureId === sketch.id)?.frame ?? null;
    } else if (tool.input === 'part') {
      input = { kind: 'part' };
    } else if (tool.input === 'faces') {
      // Face déjà sélectionnée dans la vue : elle devient la première face de l'opération.
      const mesh = this.state.display[part.id]?.mesh;
      const face = sel?.kind === 'face' && mesh ? mesh.faces[sel.index] : undefined;
      const ref = face ? pickFaceReference(face.tags, part) : null;
      input = { kind: 'faces', faces: ref ? [ref] : [] };
    } else {
      // Arête déjà sélectionnée dans la vue : elle devient la première arête de l'opération.
      const mesh = this.state.display[part.id]?.mesh;
      const pick = sel?.kind === 'edge' && mesh ? edgeRefFromPick(mesh, sel.index, part, null) : null;
      input = { kind: 'edges', edges: pick?.kind === 'ref' ? [pick.ref] : [] };
    }
    const feature = tool.create(this.state.doc, part, input, { sketchFrame, partBounds: result?.analysis?.bbox ?? null });
    this.openDraft({ partId: part.id, isNew: true, feature, fields: tool.initialFields(feature), errors: {} });
  }

  /** Maillage affiché d'une pièce (l'aperçu pendant l'édition d'une opération). */
  private displayedMesh(partId: Id) {
    const s = this.state;
    if (s.mode.kind === 'feature' && s.mode.draft.partId === partId) {
      const preview = s.preview?.parts[partId];
      if (preview?.mesh) return preview.mesh;
    }
    return s.display[partId]?.mesh ?? null;
  }

  /** Clic dans la vue pendant l'édition d'un congé ou d'un chanfrein : ajoute ou retire une arête. */
  private pickForDraft(pick: ModelPick): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    const { draft } = mode;
    const feature = draft.feature;
    if (feature.type === 'pattern') return this.pickPatternAxis(pick, feature);
    if (feature.type === 'mirror') return this.pickMirrorPlane(pick, feature);
    if (feature.type === 'split') return this.pickSplitPlane(pick, feature);
    if (feature.type === 'plane') return this.pickDatumPlane(pick, feature);
    if (feature.type === 'axis') return this.pickDatumAxis(pick, feature);
    if (feature.type === 'draft') return this.pickDraftFace(pick, feature);
    if (feature.type === 'extrude') return this.pickExtrudeUpTo(pick, feature);
    if (feature.type === 'shell') return this.pickShellFace(pick, feature);
    if (feature.type !== 'fillet' && feature.type !== 'chamfer' && feature.type !== 'flange') return;
    if (pick.partId !== draft.partId) return this.explain('Choisissez des arêtes de la pièce en cours de modification.');
    const mesh = this.displayedMesh(pick.partId);
    const part = findPart(this.state.doc, pick.partId);
    if (!mesh || !part) return;
    let edges = feature.params.edges;
    if (pick.kind === 'face' && feature.type === 'flange') return this.explain('Cliquez une arête du bord de la tôle (le trait entre le dessus et le côté) pour y ajouter un bord plié.');
    if (pick.kind === 'face') {
      const index = blendIndexFromFacePick(mesh, pick.index, feature.id);
      if (index === null) return this.explain('Cliquez une arête (le trait entre deux faces) pour l’ajouter.');
      edges = edges.filter((_e, i) => i !== index);
    } else {
      const r = edgeRefFromPick(mesh, pick.index, part, feature.id);
      if (r.kind === 'invalid') return this.explain(r.reason);
      edges = r.kind === 'blend' ? edges.filter((_e, i) => i !== r.index) : toggleEdge(edges, r.ref);
    }
    this.updateDraft((f) => ({ ...f, params: { ...f.params, edges } }) as Feature);
  }

  /** Clic dans la vue pendant l'édition d'une coque : la face cliquée est ouverte, ou refermée. */
  private pickShellFace(pick: ModelPick, feature: ShellFeature): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    if (pick.partId !== mode.draft.partId) return this.explain('Choisissez une face de la pièce en cours de modification.');
    if (pick.kind !== 'face') return this.explain('Cliquez une face (pas une arête) pour l’ouvrir ou la refermer.');
    const part = findPart(this.state.doc, pick.partId);
    const shown = this.displayedMesh(pick.partId);
    const face = shown?.faces[pick.index];
    if (!part || !face) return;
    let tags = face.tags.filter((t) => t.featureId !== feature.id);
    if (tags.length === 0) {
      // Clic sur la paroi intérieure de l'aperçu : la face d'origine la plus proche du point cliqué,
      // sur la pièce telle qu'elle était avant la coque.
      const before = this.state.display[pick.partId]?.mesh;
      const nearest = before ? nearestFace(before, pick.point) : -1;
      tags = nearest >= 0 ? before!.faces[nearest]!.tags.filter((t) => t.featureId !== feature.id) : [];
    }
    const ref = pickFaceReference(tags, part);
    if (!ref) return this.explain('Cette face appartient à la paroi intérieure : cliquez une face de la pièce d’origine.');
    const same = (a: FaceRef, b: FaceRef) => a.featureId === b.featureId && a.role === b.role && (a.entityId ?? null) === (b.entityId ?? null) && (a.index ?? null) === (b.index ?? null);
    const open = feature.params.open.some((f) => same(f, ref)) ? feature.params.open.filter((f) => !same(f, ref)) : [...feature.params.open, ref];
    this.updateDraft((f) => ({ ...f, params: { ...(f as ShellFeature).params, open } }) as Feature);
  }

  /** Clic dans la vue pendant « Jusqu'à une face… » d'une extrusion : la face plane cliquée devient l'arrivée. */
  private pickExtrudeUpTo(pick: ModelPick, feature: ExtrudeFeature): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature' || mode.draft.fields.pick !== 'upTo') return;
    if (pick.partId !== mode.draft.partId) return this.explain('Choisissez une face de la pièce en cours de modification.');
    if (pick.kind !== 'face') return this.explain('Cliquez une face plane : l’extrusion s’arrêtera sur son plan.');
    const part = findPart(this.state.doc, pick.partId);
    const face = this.displayedMesh(pick.partId)?.faces[pick.index];
    if (!part || !face) return;
    if (!face.plane) return this.explain('Cette face est courbe : choisissez une face plane.');
    const ref = pickFaceReference(face.tags.filter((t) => t.featureId !== feature.id), part);
    if (!ref) return this.explain('Choisissez une face de la pièce, pas de l’extrusion elle-même.');
    this.setDraftField('pick', '', { feature: { ...feature, params: { ...feature.params, upTo: ref } } });
  }

  /**
   * Clic dans la vue pendant l'édition d'une dépouille : la face cliquée est ajoutée aux faces à
   * incliner (ou retirée), ou devient le plan neutre quand on choisit « Face… ».
   */
  private pickDraftFace(pick: ModelPick, feature: DraftFeature): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    if (pick.partId !== mode.draft.partId) return this.explain('Choisissez une face de la pièce en cours de modification.');
    if (pick.kind !== 'face') return this.explain('Cliquez une face (pas une arête).');
    const part = findPart(this.state.doc, pick.partId);
    const face = this.displayedMesh(pick.partId)?.faces[pick.index];
    if (!part || !face) return;
    const ref = pickFaceReference(face.tags, part);
    if (!ref) return this.explain('Cette face ne peut pas être désignée : choisissez-en une autre.');
    if (mode.draft.fields.pick === 'neutral') {
      if (!face.plane) return this.explain('Cette face est courbe : le plan neutre doit être une face plane.');
      return this.setDraftField('pick', '', { feature: { ...feature, params: { ...feature.params, neutral: { kind: 'face', ref } } } });
    }
    if (face.surface !== 'plane' && face.surface !== 'cylinder' && face.surface !== 'cone') return this.explain('Seules les faces planes ou cylindriques peuvent être inclinées.');
    const same = (a: FaceRef, b: FaceRef) => a.featureId === b.featureId && a.role === b.role && (a.entityId ?? null) === (b.entityId ?? null) && (a.index ?? null) === (b.index ?? null);
    const faces = feature.params.faces.some((f) => same(f, ref)) ? feature.params.faces.filter((f) => !same(f, ref)) : [...feature.params.faces, ref];
    this.updateDraft((f) => ({ ...f, params: { ...(f as DraftFeature).params, faces } }) as Feature);
  }

  /** Clic dans la vue pendant l'édition d'une symétrie : la face plane cliquée devient le plan. */
  private pickMirrorPlane(pick: ModelPick, feature: MirrorFeature): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    if (pick.partId !== mode.draft.partId) return this.explain('Choisissez une face de la pièce en cours de modification.');
    if (pick.kind !== 'face') return this.explain('Cliquez une face plane : elle servira de miroir.');
    const mesh = this.displayedMesh(pick.partId);
    const part = findPart(this.state.doc, pick.partId);
    const face = mesh?.faces[pick.index];
    if (!face || !part) return;
    if (!face.plane) return this.explain('Cette face est courbe : choisissez une face plane.');
    const ref = pickFaceReference(face.tags.filter((t) => t.featureId !== feature.id), part);
    if (!ref) return this.explain('Choisissez une face de la pièce, pas du reflet.');
    this.setDraftField('pick', '', { feature: { ...feature, params: { ...feature.params, plane: { kind: 'face', ref } } } });
  }

  /**
   * Clic dans la vue pendant l'édition d'une découpe : la face plane cliquée donne le plan, placé
   * d'abord à mi-épaisseur de la pièce (décalage négatif, vers l'intérieur).
   */
  private pickSplitPlane(pick: ModelPick, feature: SplitFeature): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    if (pick.partId !== mode.draft.partId) return this.explain('Choisissez une face de la pièce en cours de modification.');
    if (pick.kind !== 'face') return this.explain('Cliquez une face plane : le plan de découpe lui sera parallèle.');
    const mesh = this.displayedMesh(pick.partId);
    const part = findPart(this.state.doc, pick.partId);
    const face = mesh?.faces[pick.index];
    if (!mesh || !face || !part) return;
    if (!face.plane) return this.explain('Cette face est courbe : choisissez une face plane.');
    const ref = pickFaceReference(face.tags.filter((t) => t.featureId !== feature.id), part);
    if (!ref) return this.explain('Choisissez une face de la pièce d’origine, pas une face de coupe.');
    const { origin, normal } = face.plane;
    let depth = 0;
    const pos = mesh.positions;
    for (let k = 0; k < pos.length; k += 3) depth = Math.max(depth, -((pos[k]! - origin.x) * normal.x + (pos[k + 1]! - origin.y) * normal.y + (pos[k + 2]! - origin.z) * normal.z));
    const offset = -Math.round((depth / 2) * 10) / 10;
    const next: SplitFeature = { ...feature, params: { ...feature.params, plane: { kind: 'face', ref }, offset } };
    this.setDraftField('offset', String(offset).replace('.', ','), { feature: next });
    this.setDraftField('pick', '', { feature: next });
  }

  /**
   * Clic dans la vue pendant l'édition d'un plan de construction : une face plane devient le plan
   * de départ, une arête droite la charnière autour de laquelle il s'incline.
   */
  private pickDatumPlane(pick: ModelPick, feature: PlaneFeature): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    if (pick.partId !== mode.draft.partId) return this.explain('Choisissez une face ou une arête de la pièce en cours de modification.');
    const mesh = this.displayedMesh(pick.partId);
    const part = findPart(this.state.doc, pick.partId);
    if (!mesh || !part) return;
    if (pick.kind === 'face') {
      const face = mesh.faces[pick.index];
      if (!face) return;
      if (!face.plane) return this.explain('Cette face est courbe : choisissez une face plane.');
      const ref = pickFaceReference(face.tags, part);
      if (!ref) return;
      this.setDraftField('pick', '', { feature: { ...feature, params: { ...feature.params, base: { kind: 'face', ref } } } });
      return;
    }
    if (mesh.edges[pick.index]?.curve !== 'line') return this.explain('Pour incliner le plan, choisissez une arête droite (la charnière).');
    const r = edgeRefFromPick(mesh, pick.index, part, feature.id);
    if (r.kind !== 'ref') return this.explain(r.kind === 'invalid' ? r.reason : 'Choisissez une arête de la pièce.');
    this.setDraftField('pick', '', { feature: { ...feature, params: { ...feature.params, hinge: { kind: 'edge', edge: r.ref } } } });
  }

  /** Clic dans la vue pendant l'édition d'un axe de construction : l'arête cliquée (droite, ou bord d'un trou) le définit. */
  private pickDatumAxis(pick: ModelPick, feature: AxisFeature): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    if (pick.partId !== mode.draft.partId) return this.explain('Choisissez une arête de la pièce en cours de modification.');
    if (pick.kind !== 'edge') return this.explain('Cliquez une arête : un trait droit, ou le bord d’un trou pour prendre son axe.');
    const mesh = this.displayedMesh(pick.partId);
    const part = findPart(this.state.doc, pick.partId);
    if (!mesh || !part) return;
    const curve = mesh.edges[pick.index]?.curve;
    if (curve !== 'line' && curve !== 'circle') return this.explain('Cette arête est courbe : choisissez un trait droit ou le bord rond d’un trou.');
    const r = edgeRefFromPick(mesh, pick.index, part, feature.id);
    if (r.kind !== 'ref') return this.explain(r.kind === 'invalid' ? r.reason : 'Choisissez une arête de la pièce.');
    this.updateDraft(() => ({ ...feature, params: { ...feature.params, kind: 'edge', edge: r.ref } }));
  }

  /** Clic dans la vue pendant l'édition d'une répétition : l'arête cliquée devient la direction ou l'axe. */
  private pickPatternAxis(pick: ModelPick, feature: PatternFeature): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    const target = mode.draft.fields.pick === 'second' && feature.params.second ? 'second' : 'axis';
    if (pick.partId !== mode.draft.partId) return this.explain('Choisissez une arête de la pièce en cours de modification.');
    if (pick.kind !== 'edge') return this.explain('Cliquez une arête : un trait droit (direction) ou le bord d’un trou (axe).');
    const mesh = this.displayedMesh(pick.partId);
    const part = findPart(this.state.doc, pick.partId);
    if (!mesh || !part) return;
    const curve = mesh.edges[pick.index]?.curve;
    if (curve !== 'line' && curve !== 'circle') return this.explain('Cette arête est courbe : choisissez un trait droit ou le bord rond d’un trou.');
    const r = edgeRefFromPick(mesh, pick.index, part, feature.id);
    if (r.kind !== 'ref') return this.explain(r.kind === 'invalid' ? r.reason : 'Choisissez une arête de la pièce, pas d’un exemplaire répété.');
    if (r.ref.faces.some((f) => f.featureId === feature.id)) return this.explain('Choisissez une arête de la pièce, pas d’un exemplaire répété.');
    const axis = { kind: 'edge' as const, edge: r.ref };
    const next: PatternFeature =
      target === 'second' ? { ...feature, params: { ...feature.params, second: { ...feature.params.second!, axis } } } : { ...feature, params: { ...feature.params, axis } };
    this.setDraftField('pick', '', { feature: next });
  }

  private openDraft(draft: FeatureDraft): void {
    this.set({ mode: { kind: 'feature', draft }, activePartId: draft.partId, selection: null, preview: null });
    void this.previewDraft();
  }

  private draftDocument(draft: FeatureDraft): CadDocument {
    // Image en cours d'ajout : son fichier rejoint le projet avec l'étape.
    const pending = this.state.pendingImage;
    const base = pending && draft.feature.type === 'image' && draft.feature.params.resourceId === pending.id ? addResource(this.state.doc, pending) : this.state.doc;
    return draft.isNew ? this.insertAtMarker(base, draft.partId, draft.feature) : replaceFeature(base, draft.feature);
  }

  /**
   * Image de référence : choix du fichier (PNG, JPEG, WebP), puis l'étape « Image » s'ouvre sur la
   * face sélectionnée, ou sur le plan XY, à 100 mm de large (réglages dans le panneau).
   */
  async startImage(): Promise<void> {
    const avail = toolAvailability(this.state, 'image');
    if (!avail.ok) return this.explain(avail.reason);
    const file = await pickFile('image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp');
    if (!file) return;
    const bytes = await readFileBytes(file);
    const mime = file.type || (/\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.webp$/i.test(file.name) ? 'image/webp' : 'image/png');
    let pixels: { w: number; h: number };
    try {
      const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
      pixels = { w: bitmap.width, h: bitmap.height };
      bitmap.close();
    } catch {
      return this.explain(`« ${file.name} » n’est pas une image lisible (PNG, JPEG ou WebP).`);
    }
    if (this.state.mode.kind !== 'model') return this.explain('Terminez d’abord l’opération en cours.');
    const resource = { ...(await createStepResource(newResourceId(this.state.doc), file.name, bytes, undefined, 'image')), encoding: 'base64' as const, mime };
    resource.data = bytesToBase64(bytes);
    const sel = this.state.selection;
    const part = (sel && findPart(this.state.doc, sel.partId)) || activePart(this.state)!;
    // Face plane sélectionnée : l'image s'y pose ; sinon le plan XY.
    const mesh = this.state.display[part.id]?.mesh;
    const face = sel?.kind === 'face' && mesh ? mesh.faces[sel.index] : undefined;
    const ref = face?.plane ? pickFaceReference(face.tags, part) : null;
    const feature = makeImageFeature(this.state.doc, part, resource.id, pixels, ref ? { kind: 'face', ref } : { kind: 'plane', plane: 'XY', offset: 0 });
    this.set({ pendingImage: resource });
    this.openDraft({ partId: part.id, isNew: true, feature, fields: FEATURE_DEFINITIONS.image.tool!.initialFields(feature), errors: {} });
  }

  /** Une image vient de se charger : la vue est redessinée. */
  imagesChanged(): void {
    this.set({ imageVersion: this.state.imageVersion + 1 });
  }

  /** Ajoute une étape à la position de la barre de retour (à la fin si elle n'est pas utilisée). */
  private insertAtMarker(doc: CadDocument, partId: Id, feature: Feature): CadDocument {
    const part = findPart(doc, partId);
    const after = part ? insertionPoint(part, this.state.rollback) : undefined;
    return after === undefined ? addFeature(doc, partId, feature) : insertFeatureAfter(doc, partId, after, feature);
  }

  /** Après une insertion en arrière, la barre se place juste après la nouvelle étape. */
  private markerAfterInsert(partId: Id, featureId: Id): Partial<AppState> {
    const part = findPart(this.state.doc, partId);
    if (!part || !isRolledBack(part, this.state.rollback)) return {};
    return { rollback: { ...this.state.rollback, [partId]: featureId } };
  }

  /** Document de l'aperçu : en cas de retour en arrière, calculé jusqu'à l'étape éditée. */
  private previewDocument(draft: FeatureDraft): CadDocument {
    const doc = this.draftDocument(draft);
    const part = findPart(this.state.doc, draft.partId);
    if (!part || !isRolledBack(part, this.state.rollback)) return rolledBackDocument(doc, this.state.rollback);
    return rolledBackDocument(doc, { ...this.state.rollback, [draft.partId]: draft.feature.id });
  }

  private async previewDraft(): Promise<void> {
    const mode = this.state.mode;
    if (mode.kind !== 'feature' || this.state.kernel.status !== 'ready') return;
    const draft = mode.draft;
    const seq = ++this.previewSeq;
    try {
      const result = await this.deps.client.evaluate(this.previewDocument(draft), draft.feature.id);
      const now = this.state.mode;
      if (!result || seq !== this.previewSeq || now.kind !== 'feature') return;
      const parts: Record<Id, PartResult> = {};
      for (const p of result.parts) parts[p.partId] = p;
      const toolPart = result.parts.find((p) => p.previewTool);
      const baseKind = (FEATURE_DEFINITIONS[draft.feature.type] as unknown as FeatureDefinition).tool?.previewKind ?? 'add';
      // Une étape qui peut ajouter ou creuser : volume vert (ajouté) ou rouge (retiré).
      const op = (draft.feature.params as { operation?: string }).operation;
      const previewKind = baseKind === 'add' && op === 'cut' ? 'cut' : baseKind === 'add' && op === 'common' ? 'modify' : baseKind;
      const tool = toolPart?.previewTool && previewKind !== 'modify'
        ? {
            partId: toolPart.partId,
            key: `${toolPart.previewTool.featureId}|${toolPart.meshKey}|${JSON.stringify(now.draft.feature.params)}`,
            mesh: toolPart.previewTool.mesh,
            kind: previewKind,
          }
        : null;
      this.set({ preview: { parts, tool }, evaluating: this.deps.client.busy });
    } catch (err) {
      this.toast('error', 'L’aperçu n’a pas pu être calculé.', { detail: (err as Error).message });
    }
  }

  /** Modifie l'opération en cours puis recalcule l'aperçu. */
  updateDraft(change: (feature: Feature) => Feature): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    this.set({ mode: { kind: 'feature', draft: { ...mode.draft, feature: change(mode.draft.feature) } } });
    void this.previewDraft();
  }

  /** Mémorise la saisie d'un champ ; une saisie valide met à jour l'opération et l'aperçu. */
  setDraftField(name: string, text: string, result: FieldUpdate<Feature>): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    const fields = { ...mode.draft.fields, [name]: text };
    const errors = { ...mode.draft.errors };
    if ('error' in result) {
      errors[name] = result.error;
      this.set({ mode: { kind: 'feature', draft: { ...mode.draft, fields, errors } } });
      return;
    }
    delete errors[name];
    // Une saisie qui utilise des paramètres du projet est retenue : elle suivra leurs changements.
    const { [name]: _old, ...others } = result.feature.expressions ?? {};
    const expressions = expressionNames(text).length > 0 ? { ...others, [name]: text.trim() } : others;
    const { expressions: _e, ...bare } = result.feature;
    const feature = (Object.keys(expressions).length ? { ...bare, expressions } : bare) as Feature;
    this.set({ mode: { kind: 'feature', draft: { ...mode.draft, feature, fields, errors } } });
    void this.previewDraft();
  }

  /** Statut de l'opération en cours d'après le dernier aperçu (null : pas encore calculé). */
  draftStatus() {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return null;
    const part = this.state.preview?.parts[mode.draft.partId];
    return part?.statuses.find((s) => s.featureId === mode.draft.feature.id) ?? null;
  }

  /** Raison qui empêche de valider l'opération en cours (null : validation possible). */
  draftBlockReason(): string | null {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return null;
    const firstError = Object.values(mode.draft.errors)[0];
    if (firstError) return firstError;
    const status = this.draftStatus();
    return status?.state === 'error' ? (status.message ?? 'Cette opération est impossible avec ces paramètres.') : null;
  }

  confirmDraft(): void {
    const mode = this.state.mode;
    if (mode.kind !== 'feature') return;
    const { draft } = mode;
    const reason = this.draftBlockReason();
    if (reason) return this.explain(reason);
    let doc = this.draftDocument(draft);
    // Comme dans FreeCAD, l'esquisse utilisée par un nouveau volume est masquée (elle reste dans l'historique).
    if (draft.isNew) {
      for (const dep of featureDependencies(draft.feature)) {
        doc = updateFeature<SketchFeature>(doc, dep, (f) => (f.type === 'sketch' ? { ...f, visible: false } : f));
      }
    }
    const label = draft.isNew ? `Créer « ${draft.feature.name} »` : `Modifier « ${draft.feature.name} »`;
    this.commit(doc, label, {
      mode: model,
      preview: null,
      pendingImage: null,
      selection: { kind: 'feature', partId: draft.partId, featureId: draft.feature.id },
      ...(draft.isNew ? this.markerAfterInsert(draft.partId, draft.feature.id) : {}),
    });
  }

  cancelDraft(): void {
    if (this.state.mode.kind !== 'feature') return;
    this.previewSeq++;
    this.set({ mode: model, preview: null, pendingImage: null });
  }

  // =========================================================================
  // Mesure

  startMeasure(): void {
    const avail = measureAvailability(this.state);
    if (!avail.ok) return this.explain(avail.reason);
    this.set({ mode: { kind: 'measure', picks: [], info: null, busy: false }, selection: null });
  }

  exitMeasure(): void {
    if (this.state.mode.kind === 'measure') this.set({ mode: model });
  }

  private async measurePick(pick: ModelPick): Promise<void> {
    const mode = this.state.mode;
    if (mode.kind !== 'measure' || pick.kind === 'vertex') return;
    const picks = (mode.picks.length >= 2 ? [pick] : [...mode.picks, pick]) as (ModelPick & { kind: 'face' | 'edge' })[];
    const single = this.describePick(pick);
    if (picks.length === 1) {
      this.set({ mode: { kind: 'measure', picks, info: single, busy: false } });
      return;
    }
    this.set({ mode: { kind: 'measure', picks, info: null, busy: true } });
    try {
      const [a, b] = picks as [ModelPick & { kind: 'face' | 'edge' }, ModelPick & { kind: 'face' | 'edge' }];
      const r = await this.deps.client.measure(this.state.doc, { partId: a.partId, kind: a.kind, index: a.index }, { partId: b.partId, kind: b.kind, index: b.index });
      const now = this.state.mode;
      if (now.kind !== 'measure') return;
      const lines = [`Distance minimale : ${formatLength(r.distance)}`];
      const dx = Math.abs(r.pointB.x - r.pointA.x);
      const dy = Math.abs(r.pointB.y - r.pointA.y);
      const dz = Math.abs(r.pointB.z - r.pointA.z);
      lines.push(`Écarts : X ${formatLength(dx)} · Y ${formatLength(dy)} · Z ${formatLength(dz)}`);
      this.set({
        mode: {
          kind: 'measure',
          picks,
          busy: false,
          info: { title: 'Distance entre les deux éléments', lines, segment: { a: r.pointA, b: r.pointB, label: formatLength(r.distance) } },
        },
      });
    } catch (err) {
      this.set({ mode: { kind: 'measure', picks: [], info: { title: 'Mesure impossible', lines: [(err as Error).message] }, busy: false } });
    }
  }

  describePick(pick: ModelPick): { title: string; lines: string[] } {
    const mesh = this.state.display[pick.partId]?.mesh;
    if (pick.kind === 'face') {
      const f = mesh?.faces[pick.index];
      if (!f) return { title: 'Face', lines: [] };
      const lines = [`Aire : ${formatArea(f.area)}`];
      if (f.surface === 'cylinder' && f.cylinder) lines.unshift(`Face cylindrique — diamètre ${formatLength(f.cylinder.radius * 2)}`);
      if (f.surface === 'plane' && f.plane) lines.unshift('Face plane');
      const volume = this.state.display[pick.partId]?.result.analysis?.volume;
      if (volume !== undefined) lines.push(`Volume de la pièce : ${formatVolume(volume)}`);
      return { title: 'Face sélectionnée', lines };
    }
    const e = mesh?.edges[pick.index];
    if (!e) return { title: 'Arête', lines: [] };
    const lines = [`Longueur : ${formatLength(e.length)}`];
    if (e.curve === 'circle' && e.circle) lines.unshift(`Arête circulaire — diamètre ${formatLength(e.circle.radius * 2)}`);
    if (e.curve === 'line' && e.line) lines.unshift(`Arête droite de ${formatLength(distance3(e.line.start, e.line.end))}`);
    return { title: 'Arête sélectionnée', lines };
  }

  // =========================================================================
  // Projet et fichiers

  renameProject(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === this.state.doc.name) return;
    this.commit({ ...this.state.doc, name: trimmed }, `Renommer le projet « ${trimmed} »`);
  }

  private guardUnsaved(action: Extract<Dialog, { kind: 'unsaved' }>['action'], payload?: string): boolean {
    if (!isDirty(this.state)) return false;
    this.set({ dialog: { kind: 'unsaved', action, ...(payload ? { payload } : {}) } });
    return true;
  }

  async resolveUnsaved(choice: 'save' | 'discard'): Promise<void> {
    const d = this.state.dialog;
    if (d?.kind !== 'unsaved') return;
    if (choice === 'save' && !(await this.save())) return;
    if (choice === 'discard') await this.deps.projects?.deleteAutosave(this.state.doc.id).catch(() => undefined);
    this.set({ dialog: null });
    if (d.action === 'new') this.newProject(true);
    else if (d.action === 'open-project' && d.payload) void this.openProject(d.payload, true);
    else if (d.action === 'open-draft' && d.payload) void this.openAutosaveDraft(d.payload, true);
    else if (d.action === 'open-file') void this.openFile(true);
  }

  newProject(force = false): void {
    if (this.state.mode.kind !== 'model') this.set({ mode: model });
    if (!force && this.guardUnsaved('new')) return;
    this.loadDocument(createDocument(), { savedAt: null, dirty: false });
    this.toast('info', 'Nouveau projet créé.');
  }

  async showOpenDialog(): Promise<void> {
    this.set({ dialog: { kind: 'open', projects: [], drafts: [], loading: true } });
    try {
      const [projects, drafts] = await Promise.all([this.deps.projects?.listProjects() ?? [], this.deps.projects?.listAutosaves() ?? []]);
      if (this.state.dialog?.kind === 'open') this.set({ dialog: { kind: 'open', projects, drafts, loading: false } });
    } catch {
      this.set({ dialog: { kind: 'open', projects: [], drafts: [], loading: false } });
    }
  }

  async openProject(id: Id, force = false): Promise<void> {
    if (!force && id !== this.state.doc.id && this.guardUnsaved('open-project', id)) return;
    const rec = await this.deps.projects?.getProject(id);
    if (!rec) return this.toast('error', 'Ce projet est introuvable dans le navigateur.');
    if (this.loadFromText(rec.text, { savedAt: rec.savedAt, dirty: false })) this.toast('success', `Projet « ${rec.name} » ouvert.`);
  }

  async openAutosaveDraft(projectId: Id, force = false): Promise<void> {
    if (!force && projectId !== this.state.doc.id && this.guardUnsaved('open-draft', projectId)) return;
    const rec = await this.deps.projects?.getAutosave(projectId);
    if (!rec) return;
    const saved = await this.deps.projects?.getProject(projectId);
    if (this.loadFromText(rec.text, { savedAt: saved?.savedAt ?? null, dirty: true })) this.toast('success', 'Brouillon récupéré. Pensez à l’enregistrer.');
  }

  async deleteProject(id: Id): Promise<void> {
    await this.deps.projects?.deleteProject(id);
    await this.showOpenDialog();
  }

  async openFile(force = false): Promise<void> {
    if (!force && this.guardUnsaved('open-file')) return;
    this.set({ dialog: null });
    const file = await pickFile(`${NATIVE_EXTENSION},.json,application/json,.step,.stp,.stl`);
    if (!file) return;
    if (/\.(step|stp|stl)$/i.test(file.name)) {
      await this.beginImport(file);
      return;
    }
    const text = await file.text();
    if (this.loadFromText(text, { savedAt: new Date(file.lastModified || Date.now()).toISOString(), dirty: false, fileName: file.name })) {
      // Le projet ouvert rejoint la liste « Mes projets » du navigateur.
      await this.save(true);
      this.toast('success', `Fichier « ${file.name} » ouvert.`);
    }
  }

  /** Enregistre dans le navigateur (et dans le fichier choisi si le navigateur le permet). */
  async save(silent = false): Promise<boolean> {
    const s = this.state;
    const savedAt = new Date().toISOString();
    const text = serializeDocument({ ...s.doc, modifiedAt: savedAt }, savedAt);
    if (!this.deps.projects) {
      if (!silent) return this.saveAs();
      return false;
    }
    try {
      await this.deps.projects.putProject({ id: s.doc.id, name: s.doc.name, savedAt, text, size: text.length });
      await this.deps.projects.setSetting('lastProjectId', s.doc.id);
      if (s.project.file?.handle) {
        await saveFile(new Blob([text], { type: NATIVE_MIME }), s.project.file.name, {
          description: 'Projet VibeCAD',
          mime: NATIVE_MIME,
          extension: NATIVE_EXTENSION,
          reuse: s.project.file,
        });
      }
      this.autosave?.cancel();
      await this.deps.projects.deleteAutosave(s.doc.id);
      this.patchProject({ savedAt, savedRevision: s.revision, autosave: { kind: 'idle' } });
      if (!silent) {
        const first = !(await this.deps.projects.getSetting<boolean>('downloadHintShown'));
        this.toast(
          'success',
          first
            ? 'Projet enregistré dans ce navigateur. Pour en garder une copie sûre, utilisez aussi « Enregistrer sous… » (fichier).'
            : `Projet enregistré${s.project.file?.handle ? ` (navigateur et fichier « ${s.project.file.name} »)` : ' dans ce navigateur'}.`,
        );
        if (first) await this.deps.projects.setSetting('downloadHintShown', true);
      }
      return true;
    } catch (err) {
      this.toast(
        'error',
        isQuotaError(err)
          ? 'Le stockage du navigateur est plein : utilisez « Enregistrer sous… » pour télécharger le projet.'
          : 'L’enregistrement dans le navigateur a échoué : utilisez « Enregistrer sous… » pour télécharger le projet.',
        { detail: (err as Error).message },
      );
      return false;
    }
  }

  /** Télécharge le projet (ou l'écrit dans un fichier choisi, si le navigateur le permet). */
  async saveAs(): Promise<boolean> {
    const s = this.state;
    const savedAt = new Date().toISOString();
    const text = serializeDocument({ ...s.doc, modifiedAt: savedAt }, savedAt);
    try {
      const target = await saveFile(new Blob([text], { type: NATIVE_MIME }), safeFileName(s.doc.name, NATIVE_EXTENSION), {
        description: 'Projet VibeCAD',
        mime: NATIVE_MIME,
        extension: NATIVE_EXTENSION,
        forcePicker: true,
      });
      if (!target) return false;
      this.patchProject({ file: target });
      await this.save(true);
      this.toast('success', target.handle ? `Projet enregistré dans « ${target.name} ».` : `Fichier « ${target.name} » téléchargé.`);
      return true;
    } catch (err) {
      this.toast('error', 'Le fichier n’a pas pu être enregistré.', { detail: (err as Error).message });
      return false;
    }
  }

  // =========================================================================
  // Import et export

  async importStep(): Promise<void> {
    if (!this.can('import-step')) return this.explain('L’import de fichiers STEP et STL est disponible au niveau Expert (en bas à droite : « Niveau »).');
    if (this.state.mode.kind !== 'model') return this.explain('Terminez d’abord l’opération en cours.');
    const file = await pickFile('.step,.stp,.stl,model/step,application/step,model/stl');
    if (file) await this.beginImport(file);
  }

  async beginImport(file: File): Promise<void> {
    const bytes = await readFileBytes(file);
    const format = /\.stl$/i.test(file.name) ? 'stl' : 'step';
    this.set({ dialog: { kind: 'import-step', fileName: file.name, format, bytes, inspection: null, error: null, target: 'new-part', busy: true } });
    try {
      await this.deps.client.ready;
      const inspection = await this.deps.client.inspectStep(bytes, format);
      const d = this.state.dialog;
      if (d?.kind === 'import-step') this.set({ dialog: { ...d, inspection, busy: false } });
    } catch (err) {
      const d = this.state.dialog;
      if (d?.kind === 'import-step') this.set({ dialog: { ...d, busy: false, error: (err as Error).message } });
    }
  }

  setImportTarget(target: 'new-part' | 'active-part'): void {
    const d = this.state.dialog;
    if (d?.kind === 'import-step') this.set({ dialog: { ...d, target } });
  }

  async confirmImport(): Promise<void> {
    const d = this.state.dialog;
    if (d?.kind !== 'import-step' || !d.inspection) return;
    let doc = this.state.doc;
    const resource = await createStepResource(newResourceId(doc), d.fileName, d.bytes, undefined, d.format);
    doc = addResource(doc, resource);
    const baseName = d.fileName.replace(/\.(step|stp|stl)$/i, '');
    let partId = this.state.activePartId;
    if (d.target === 'new-part') {
      const r = addPart(doc, d.inspection.productNames.length === 1 ? d.inspection.productNames[0]! : baseName);
      doc = r.doc;
      partId = r.partId;
    }
    let lastId: Id | null = null;
    d.inspection.solids.forEach((_s, i) => {
      const part = findPart(doc, partId)!;
      const name = d.inspection!.solids.length > 1 ? `${baseName} (solide ${i + 1})` : baseName;
      const feature = makeImportedSolidFeature(doc, part, resource.id, i, name);
      const after = lastId ?? insertionPoint(findPart(this.state.doc, partId) ?? part, this.state.rollback);
      doc = after === undefined ? addFeature(doc, partId, feature) : insertFeatureAfter(doc, partId, after, feature);
      lastId = feature.id;
    });
    this.fitPending = true;
    this.commit(doc, `Importer « ${d.fileName} »`, {
      dialog: null,
      activePartId: partId,
      selection: { kind: 'part', partId },
      ...(lastId ? this.markerAfterInsert(partId, lastId) : {}),
    });
    this.toast(
      'success',
      d.format === 'stl'
        ? `« ${d.fileName} » importé : ${d.inspection.solids.length} solide(s). Le fichier est conservé dans le projet ; les surfaces courbes restent en facettes.`
        : `« ${d.fileName} » importé : ${d.inspection.solids.length} solide(s). Le fichier est conservé dans le projet ; ses étapes de construction d’origine ne sont pas récupérables.`,
    );
  }

  /** Format proposé à l'ouverture de la fenêtre d'export : le dernier choisi. */
  private lastExportFormat: ExportFormat = 'step';

  /** Ouvre la fenêtre d'export (format au choix dans la fenêtre ; le dernier utilisé par défaut). */
  showExportDialog(format?: ExportFormat): void {
    if (!format) format = this.state.workspace === 'assembly' && this.lastExportFormat === 'stl' ? 'step' : this.lastExportFormat;
    const avail = exportAvailability(this.state);
    if (!avail.ok) return this.explain(avail.reason);
    const s = this.state;
    const withSolid = s.doc.parts.filter((p) => (s.display[p.id]?.result.analysis?.solidCount ?? 0) > 0).map((p) => p.id);
    if (s.workspace === 'fabrication' && format === '3mf') {
      const layout = this.printLayout();
      if (layout.placements.length === 0) return this.explain('Le plateau est vide : indiquez au moins un exemplaire à imprimer.');
      this.set({ dialog: { kind: 'export', format, partIds: Array.from(new Set(layout.placements.map((p) => p.partId))), busy: false, plate: this.printPlate() } });
      return;
    }
    if (s.workspace === 'assembly') {
      if (!s.doc.assembly?.instances.length) return this.explain('L’assemblage est vide : insérez d’abord des pièces.');
      this.set({ dialog: { kind: 'export', format, partIds: Array.from(new Set(this.assemblyLeaves().map((l) => l.partId))), busy: false, assembly: true } });
      return;
    }
    // Impression : la pièce active par défaut ; STEP et GLB : toutes les pièces.
    const partIds = (format === 'stl' || format === '3mf') && withSolid.includes(s.activePartId) ? [s.activePartId] : withSolid;
    this.set({ dialog: { kind: 'export', format, partIds, busy: false } });
  }

  /** Change le format dans la fenêtre d'export (les pièces cochées sont gardées). */
  setExportFormat(format: ExportFormat): void {
    const d = this.state.dialog;
    if (d?.kind !== 'export' || d.plate !== undefined) return;
    if (d.assembly && format === 'stl') return;
    this.lastExportFormat = format;
    this.set({ dialog: { ...d, format } });
  }

  /** Choix du plateau exporté (dialogue d'export du plateau d'impression). */
  setExportPlate(plate: number | 'all'): void {
    const d = this.state.dialog;
    if (d?.kind === 'export' && d.plate !== undefined) this.set({ dialog: { ...d, plate } });
  }

  /** Export 3MF d'un plateau d'impression, ou de tous (un fichier par plateau). */
  private async exportPlates(which: number | 'all'): Promise<void> {
    const s = this.state;
    const layout = this.printLayout();
    const plates = which === 'all' ? Array.from({ length: layout.plates }, (_v, i) => i) : [which];
    try {
      for (const plate of plates) {
        const on = layout.placements.filter((p) => p.plate === plate);
        const partIds = Array.from(new Set(on.map((p) => p.partId)));
        const { bytes, warnings } = await this.deps.client.export3mf(
          s.doc,
          partIds,
          on.map((p) => ({ partId: p.partId, name: p.name, matrix: p.matrix })),
        );
        const name = layout.plates > 1 ? `${s.doc.name} - plateau ${plate + 1}` : `${s.doc.name} - plateau`;
        const target = await saveFile(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/3mf' }), safeFileName(name, '.3mf'), {
          description: 'Fichier 3MF',
          mime: 'model/3mf',
          extension: '.3mf',
          download: true,
        });
        if (target) {
          this.toast('success', `Fichier 3MF « ${target.name} » téléchargé : ${on.length} pièce(s)${layout.plates > 1 ? ` (plateau ${plate + 1} sur ${layout.plates})` : ''}, en millimètres.`, warnings.length ? { detail: warnings.join('\n') } : {});
        }
      }
      this.set({ dialog: null });
    } catch (err) {
      const now = this.state.dialog;
      if (now?.kind === 'export') this.set({ dialog: { ...now, busy: false } });
      this.toast('error', 'L’export a échoué.', { detail: (err as Error).message });
    }
  }

  /**
   * Contenu GLB : les maillages d'affichage des pièces ; pour l'assemblage, chaque pièce insérée à
   * sa place et la visserie.
   */
  private glbBytes(partIds: readonly Id[], assembly: boolean): Uint8Array {
    const s = this.state;
    const meshes: GltfMesh[] = [];
    const nodes: GltfNode[] = [];
    const addPart = (partId: Id) => {
      const part = findPart(s.doc, partId);
      const mesh = s.display[partId]?.mesh;
      if (!part || !mesh || meshes.some((m) => m.key === partId)) return;
      meshes.push({ key: partId, name: part.name, color: part.color, positions: mesh.positions, normals: mesh.normals, indices: mesh.indices });
    };
    if (assembly && s.doc.assembly) {
      for (const leaf of this.assemblyLeaves()) {
        addPart(leaf.partId);
        nodes.push({ name: leaf.name, mesh: leaf.partId, matrix: leaf.matrix });
      }
      const fasteners = this.fastenerPlacement();
      for (const f of s.doc.assembly.fasteners ?? []) {
        const matrix = fasteners?.matrices.get(f.id);
        if (!matrix) continue;
        const { key, mesh } = fastenerMesh(f.kind, f.size, f.length);
        if (!meshes.some((m) => m.key === key)) meshes.push({ key, name: designation(f.kind, f.size, f.length), color: FASTENER_COLOR, positions: mesh.positions, normals: mesh.normals, indices: mesh.indices });
        nodes.push({ name: designation(f.kind, f.size, f.length), mesh: key, matrix });
      }
    } else {
      for (const id of partIds) {
        addPart(id);
        nodes.push({ name: findPart(s.doc, id)?.name ?? id, mesh: id });
      }
    }
    return toGlb(meshes, nodes, `${APP_NAME} ${APP_VERSION}`);
  }

  toggleExportPart(partId: Id): void {
    const d = this.state.dialog;
    if (d?.kind !== 'export') return;
    const partIds = d.partIds.includes(partId) ? d.partIds.filter((id) => id !== partId) : [...d.partIds, partId];
    this.set({ dialog: { ...d, partIds } });
  }

  async confirmExport(): Promise<void> {
    const d = this.state.dialog;
    if (d?.kind !== 'export' || d.partIds.length === 0) return;
    this.set({ dialog: { ...d, busy: true } });
    const s = this.state;
    const parts = s.doc.parts.filter((p) => d.partIds.includes(p.id));
    if (d.plate !== undefined && d.format === '3mf') return this.exportPlates(d.plate);
    const baseName = d.assembly ? `${s.doc.name} - assemblage` : parts.length === 1 ? parts[0]!.name : s.doc.name;
    // Assemblage : chaque pièce insérée est exportée à sa place.
    const placement = d.assembly ? this.assemblyPlacement() : null;
    const placements = placement ? this.assemblyLeaves(placement).map((l) => ({ partId: l.partId, name: l.name, matrix: l.matrix })) : undefined;
    try {
      if (d.format === 'step') {
        // Avec des sous-assemblages : arborescence à plusieurs niveaux (un nœud par bloc).
        const withBlocks = d.assembly && placement && s.doc.assembly?.instances.some((i) => i.subassemblyId);
        const tree = withBlocks ? assemblyStepTree(s.doc.assembly!, placement, (partId) => s.display[partId]?.mesh, this.solveOptions()) : undefined;
        const { text, warnings } = await this.deps.client.exportStep(s.doc, d.partIds, tree ? undefined : placements, tree);
        const target = await saveFile(new Blob([text], { type: 'model/step' }), safeFileName(baseName, '.step'), {
          description: 'Fichier STEP',
          mime: 'model/step',
          extension: '.step',
          download: true,
        });
        this.set({ dialog: null });
        if (target) this.toast('success', `Fichier STEP « ${target.name} » téléchargé : ${parts.length} pièce(s), en millimètres.`, warnings.length ? { detail: warnings.join('\n') } : {});
      } else if (d.format === 'freecad' || d.format === 'fcstd') {
        // FreeCAD : script qui reconstruit l'historique, ou document des formes finales.
        const blocks = new Map((s.doc.assembly?.instances ?? []).filter((i) => i.subassemblyId).map((i) => [i.id, i.name]));
        const leaves = d.assembly && placement ? this.assemblyLeaves(placement).map((l) => ({ name: l.name, partId: l.partId, matrix: [...l.matrix], group: blocks.get(l.instanceId) ?? null })) : [];
        const { script, fcstd, warnings } = await this.deps.client.exportFreecad(s.doc, d.assembly ? [] : d.partIds, leaves);
        const isScript = d.format === 'freecad';
        const target = await saveFile(
          isScript ? new Blob([script], { type: 'text/x-python' }) : new Blob([fcstd as Uint8Array<ArrayBuffer>], { type: 'application/x-freecad' }),
          safeFileName(baseName, isScript ? '.py' : '.FCStd'),
          { description: isScript ? 'Script FreeCAD (Python)' : 'Document FreeCAD', mime: isScript ? 'text/x-python' : 'application/x-freecad', extension: isScript ? '.py' : '.FCStd', download: true },
        );
        this.set({ dialog: null });
        if (target) {
          this.toast(
            'success',
            isScript
              ? `Script FreeCAD « ${target.name} » téléchargé. Dans FreeCAD : Macro → Macros…, choisissez son dossier puis « Exécuter » : le projet est reconstruit (et enregistré en .FCStd à côté).`
              : `Document FreeCAD « ${target.name} » téléchargé : formes finales, sans historique.`,
            warnings.length ? { detail: warnings.join('\n') } : {},
          );
        }
      } else if (d.format === 'glb') {
        const bytes = this.glbBytes(d.partIds, !!d.assembly);
        const target = await saveFile(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }), safeFileName(baseName, '.glb'), {
          description: 'Fichier GLB (glTF)',
          mime: 'model/gltf-binary',
          extension: '.glb',
          download: true,
        });
        this.set({ dialog: null });
        if (target) this.toast('success', `Fichier GLB « ${target.name} » téléchargé : ${d.assembly ? `${s.doc.assembly?.instances.length ?? 0} pièce(s) insérée(s)` : `${parts.length} pièce(s)`}, en mètres comme le veut le glTF.`);
      } else if (d.format === '3mf') {
        const { bytes, warnings } = await this.deps.client.export3mf(s.doc, d.partIds, placements);
        const mime = 'model/3mf';
        const target = await saveFile(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }), safeFileName(baseName, '.3mf'), {
          description: 'Fichier 3MF',
          mime,
          extension: '.3mf',
          download: true,
        });
        this.set({ dialog: null });
        if (target) this.toast('success', `Fichier 3MF « ${target.name} » téléchargé : ${parts.length} pièce(s), en millimètres.`, warnings.length ? { detail: warnings.join('\n') } : {});
      } else {
        const { bytes, warnings } = await this.deps.client.exportStl(s.doc, d.partIds);
        const target = await saveFile(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/stl' }), safeFileName(baseName, '.stl'), {
          description: 'Fichier STL',
          mime: 'model/stl',
          extension: '.stl',
          download: true,
        });
        this.set({ dialog: null });
        if (target) this.toast('success', `Fichier STL « ${target.name} » téléchargé. ${STL_UNIT_NOTE}`, warnings.length ? { detail: warnings.join('\n') } : {});
      }
    } catch (err) {
      const now = this.state.dialog;
      if (now?.kind === 'export') this.set({ dialog: { ...now, busy: false } });
      this.toast('error', 'L’export a échoué.', { detail: (err as Error).message });
    }
  }

  // =========================================================================
  // Vue

  setView(view: StandardView): void {
    this.viewport?.setStandardView(view);
  }

  fitAll(): void {
    this.viewport?.fitAll();
  }

  setProjection(projection: Projection): void {
    this.viewport?.setProjection(projection);
    this.set({ projection });
  }

  lookAtSketch(): void {
    this.viewport?.lookAtSketch();
  }

  // =========================================================================
  // Interface

  setDialog(dialog: Dialog | null): void {
    this.set({ dialog });
  }

  toggleHelp(open?: boolean): void {
    this.set({ helpOpen: open ?? !this.state.helpOpen });
  }

  /**
   * Bouton du panneau des pièces : sur écran étroit, ouvre ou ferme le tiroir ; sur écran large,
   * masque ou réaffiche le panneau (la vue 3D prend la place).
   */
  toggleLeftPanel(open?: boolean, narrow = false): void {
    if (narrow) this.set({ leftPanelOpen: open ?? !this.state.leftPanelOpen });
    else this.set({ leftPanelHidden: open === undefined ? !this.state.leftPanelHidden : !open });
  }

  /** Replie ou rouvre le panneau de droite (réglages de l'opération, de la liaison…). */
  toggleRightPanel(open?: boolean): void {
    this.set({ rightPanelHidden: open === undefined ? !this.state.rightPanelHidden : !open });
  }

  // =========================================================================
  // Assemblage (voir docs/assemblage.md)

  /** Document au début d'un réglage en continu (curseur, glisser) : une seule action à annuler. */
  private liveStart: CadDocument | null = null;
  private drag: {
    jointId: Id;
    rotate: boolean;
    /** Rotule : centre, point attrapé (direction et rayon) et axe de la pièce au départ. */
    ball?: { center: Vec3; grab: Vec3; radius: number; axis0: Vec3; flip: boolean; base: { x: Vec3; y: Vec3; z: Vec3 } };
    origin: Vec3;
    axis: Vec3;
    startAngle: number;
    startOffset: number;
    ref: Vec3 | null;
    s0: number;
    lastDelta: number;
  } | null = null;

  setWorkspace(workspace: Workspace): void {
    if (this.state.workspace === workspace) return;
    if (this.animation) this.stopJointAnimation();
    if (workspace === 'assembly' && !this.can('workspace:assembly')) return this.explain('L’assemblage est disponible à partir du niveau Intermédiaire (en bas à droite : « Niveau »).');
    if (workspace === 'simulation' && !this.can('workspace:simulation')) return this.explain('La simulation est disponible à partir du niveau Intermédiaire (en bas à droite : « Niveau »).');
    if (!['model', 'joint', 'fastener', 'pick-fab-face', 'pick-sim-face'].includes(this.state.mode.kind)) return this.explain('Terminez d’abord l’opération en cours.');
    // Les autres onglets (fabrication, simulation…) travaillent sur l'assemblage principal.
    const closed = workspace !== 'assembly' && this.state.doc.editingSubassembly ? { doc: closedDocument(this.state.doc), explode: 0 } : {};
    this.set({ workspace, mode: model, selection: null, hover: null, assemblySelection: null, fitRequest: this.state.fitRequest + 1, ...closed, ...(workspace !== 'parts' ? { assemblyContext: null } : {}) });
  }

  // ----- Paramètres du projet

  /** Ajoute un paramètre (nom libre suivant : p1, p2…). */
  addParameter(): void {
    const params = this.state.doc.parameters ?? [];
    const taken = new Set(params.map((p) => p.name.toLowerCase()));
    let n = params.length + 1;
    while (taken.has(`p${n}`)) n++;
    this.commit({ ...this.state.doc, parameters: [...params, { name: `p${n}`, expression: '10' }] }, 'Ajouter un paramètre');
  }

  /**
   * Change un paramètre : son nom (repris dans toutes les équations qui l'utilisent) ou sa valeur.
   * Les cotes et les champs qui en dépendent sont recalculés.
   */
  updateParameter(index: number, patch: Partial<ProjectParameter>): void {
    const params = [...(this.state.doc.parameters ?? [])];
    const old = params[index];
    if (!old) return;
    const next = { ...old, ...patch };
    if (patch.name !== undefined && patch.name !== old.name) {
      if (!PARAMETER_NAME.test(patch.name)) return this.explain('Un nom de paramètre commence par une lettre et ne contient que des lettres, des chiffres et _ (pas d’espace).');
      if (params.some((p, i) => i !== index && p.name.toLowerCase() === patch.name!.toLowerCase())) return this.explain(`Le nom « ${patch.name} » est déjà utilisé.`);
    }
    params[index] = next;
    let doc: CadDocument = { ...this.state.doc, parameters: params };
    if (patch.name !== undefined && patch.name !== old.name) doc = renameParameterUses(doc, old.name, patch.name);
    this.commit(applyParameters(doc), patch.name !== undefined && patch.name !== old.name ? `Renommer le paramètre « ${old.name} »` : `Paramètre « ${next.name} »`);
  }

  /** Supprime un paramètre, s'il n'est utilisé nulle part. */
  removeParameter(index: number): void {
    const params = this.state.doc.parameters ?? [];
    const p = params[index];
    if (!p) return;
    const users = parameterUses(this.state.doc, p.name);
    if (users.length) return this.explain(`« ${p.name} » est utilisé par : ${users.slice(0, 4).join(', ')}${users.length > 4 ? '…' : ''}. Remplacez-le d’abord par un nombre.`);
    const rest = params.filter((_q, i) => i !== index);
    const { parameters: _p, ...bare } = this.state.doc;
    this.commit(rest.length ? { ...this.state.doc, parameters: rest } : (bare as CadDocument), `Supprimer le paramètre « ${p.name} »`);
  }

  // ----- Simulation

  /**
   * Pièce étudiée (ou `ASSEMBLY_STUDY`) : celle choisie, sinon la pièce active, sinon la première
   * qui a un volume. L'assemblage n'est étudiable qu'au niveau Expert, avec au moins une pièce.
   */
  simulationPartId(): Id | null {
    const s = this.state;
    if (s.simulationPart === ASSEMBLY_STUDY && this.simulationSource(ASSEMBLY_STUDY)) return ASSEMBLY_STUDY;
    if (s.simulationPart === MECHANISM_STUDY && drivableJoints(s.doc.assembly).length > 0) return MECHANISM_STUDY;
    const ok = (id: Id | null): id is Id => !!id && !!s.display[id]?.mesh && s.doc.parts.some((p) => p.id === id);
    if (ok(s.simulationPart)) return s.simulationPart;
    if (ok(s.activePartId)) return s.activePartId;
    return s.doc.parts.find((p) => ok(p.id))?.id ?? null;
  }

  // ----- Étude « Mécanisme » (voir docs/mecanisme.md)

  /** Étude enregistrée si sa liaison mène encore, sinon l'étude par défaut de la première liaison. */
  mechanismStudy(): MechanismStudy | null {
    return mechanismStudyOf(this.state.doc)?.study ?? null;
  }

  /** Change un réglage de l'étude (une autre liaison repart de ses réglages par défaut). */
  setMechanismStudy(patch: Partial<MechanismStudy>): void {
    const current = this.mechanismStudy();
    if (!current) return;
    let next: MechanismStudy = { ...current, ...patch };
    if (patch.jointId && patch.jointId !== current.jointId) {
      const d = drivableJoints(this.state.doc.assembly).find((x) => x.joint.id === patch.jointId);
      if (!d) return;
      next = { ...defaultMechanismStudy(d.joint, d.kind), friction: current.friction, acceleration: current.acceleration, safety: current.safety };
    }
    const simulation = { studies: [], ...this.state.doc.simulation, mechanism: next };
    this.commit({ ...this.state.doc, simulation }, 'Étude du mécanisme', { mechanismHover: null });
  }

  /** Masse (kg) et centre de gravité d'une pièce, d'après son volume et sa matière. */
  private massOf = (partId: Id) => {
    const part = findPart(this.state.doc, partId);
    const a = this.state.display[partId]?.result.analysis;
    if (!part || !a?.centroid || a.solidCount === 0) return null;
    const material = partMaterial(partMaterialId(part));
    // Inertie : mm⁵ (masse volumique 1) × g/cm³ → kg·m² (facteur 10⁻¹²).
    const inertia = a.inertia ? a.inertia.map((v) => v * material.density * 1e-12) : null;
    return { mass: massOf(a.volume, material) / 1000, centroid: a.centroid, inertia };
  };

  /** Clé du calcul : l'étude, l'assemblage et les formes (un changement rend le résultat périmé). */
  mechanismKey(): string | null {
    const study = this.mechanismStudy();
    const assembly = this.state.doc.assembly;
    if (!study || !assembly) return null;
    const shapes = assembly.instances.map((i) => `${i.partId}:${this.state.display[i.partId]?.meshKey ?? '-'}:${findPart(this.state.doc, i.partId)?.material ?? ''}`).join('|');
    return JSON.stringify([study, assembly.joints, assembly.instances.map((i) => [i.id, i.position]), assembly.couplings ?? [], shapes]);
  }

  /** Calcule le couple sur toute la plage de la liaison motrice. */
  async runMechanism(): Promise<void> {
    const study = this.mechanismStudy();
    const assembly = this.state.doc.assembly;
    const key = this.mechanismKey();
    if (!study || !assembly || !key) return this.explain('Il faut un assemblage avec au moins une liaison pivot ou glissière.');
    this.set({ mechanismRun: { key, result: null, busy: true } });
    // Laisse l'affichage indiquer « calcul… » avant le calcul (sur le fil principal, quelques centaines de placements).
    await new Promise((r) => setTimeout(r, 30));
    try {
      const result = computeMechanism(assembly, study, (id) => this.state.display[id]?.mesh, this.massOf, this.solveOptions());
      this.set({ mechanismRun: { key, result, busy: false, ...(result ? {} : { error: 'Liaison motrice introuvable.' }) } });
    } catch (err) {
      this.set({ mechanismRun: { key, result: null, busy: false, error: (err as Error).message } });
    }
  }

  /** Position survolée sur la courbe : l'assemblage y est montré (null : position du projet). */
  setMechanismHover(at: number | null): void {
    if (this.state.mechanismHover !== at) this.set({ mechanismHover: at });
  }

  /** Ce qu'on étudie : le maillage de la pièce, ou les pièces de l'assemblage à leur place. */
  simulationSource(partId: Id): StudySource | null {
    const s = this.state;
    if (partId !== ASSEMBLY_STUDY) {
      const d = s.display[partId];
      return d?.mesh && d.meshKey ? { kind: 'part', mesh: d.mesh, key: d.meshKey } : null;
    }
    const assembly = s.doc.assembly;
    if (!assembly || !this.can('simulation:assembly')) return null;
    const items = this.assemblyLeaves().flatMap((leaf) => {
      const d = s.display[leaf.partId];
      return d?.mesh && d.meshKey ? [{ instanceId: leaf.key, mesh: d.mesh, matrix: leaf.matrix, meshKey: d.meshKey }] : [];
    });
    if (items.length === 0) return null;
    const key = items.map((i) => `${i.instanceId}:${i.meshKey}:${i.matrix.map((v) => v.toFixed(4)).join(',')}`).join('|');
    return { kind: 'assembly', items: items.map(({ meshKey: _k, ...rest }) => rest), key };
  }

  setSimulationPart(partId: Id): void {
    if (this.simulationPartId() === partId) return;
    this.cancelSimulation();
    this.closeTopology();
    this.set({ simulationPart: partId, mode: this.state.mode.kind === 'pick-sim-face' ? model : this.state.mode, fitRequest: this.state.fitRequest + 1 });
  }

  updateStudy(partId: Id, change: (s: SimulationStudy) => SimulationStudy, label: string): void {
    this.commit(withStudy(this.state.doc, change(studyOf(this.state.doc, partId))), label);
  }

  /** Choisir à la souris les faces fixées ou chargées (un second appel termine). */
  pickSimulationFaces(role: 'fixed' | 'load' | 'keep'): void {
    const partId = this.simulationPartId();
    if (!partId) return;
    const m = this.state.mode;
    this.set({ mode: m.kind === 'pick-sim-face' && m.role === role ? model : { kind: 'pick-sim-face', role, partId } });
  }

  cancelSimulationPick(): void {
    if (this.state.mode.kind === 'pick-sim-face') this.set({ mode: model });
  }

  clearSimulationFaces(role: 'fixed' | 'load' | 'keep'): void {
    const partId = this.simulationPartId();
    if (!partId) return;
    if (role === 'keep') return this.updateStudy(partId, ({ keep: _k, ...st }) => st, 'Retirer les faces à garder');
    this.updateStudy(partId, (st) => (role === 'fixed' ? { ...st, fixed: [] } : { ...st, load: { ...st.load, faces: [] } }), role === 'fixed' ? 'Retirer les faces fixées' : 'Retirer les faces chargées');
  }

  /** Clic en mode « faces » : ajoute la face à la liste, ou la retire si elle y est déjà. */
  private simulationPick(pick: ModelPick | null): void {
    const mode = this.state.mode;
    if (mode.kind !== 'pick-sim-face' || !pick || pick.kind !== 'face') return;
    // Étude de l'assemblage : la face est repérée sur une pièce insérée.
    const instance = mode.partId === ASSEMBLY_STUDY ? this.state.doc.assembly?.instances.find((i) => i.id === pick.partId) : undefined;
    if (mode.partId !== ASSEMBLY_STUDY && pick.partId !== mode.partId) return this.explain('Cliquez une face de la pièce étudiée.');
    const partId = instance ? instance.partId : pick.partId;
    const part = findPart(this.state.doc, partId);
    const face = this.state.display[partId]?.mesh?.faces[pick.index];
    const faceRef = part && face ? pickFaceReference(face.tags, part) : null;
    if (!faceRef) return;
    const ref: StudyFace = instance ? { ...faceRef, instanceId: instance.id } : faceRef;
    const role = mode.role;
    // Faces à garder (allègement) : indépendantes des faces fixées et chargées.
    if (role === 'keep') {
      return this.updateStudy(
        mode.partId,
        (st) => {
          const list = st.keep ?? [];
          const next = list.some((r) => sameFaceRef(r, ref)) ? list.filter((r) => !sameFaceRef(r, ref)) : [...list, ref];
          const { keep: _k, ...rest } = st;
          return next.length ? { ...rest, keep: next } : rest;
        },
        'Choisir les faces à garder',
      );
    }
    this.updateStudy(
      mode.partId,
      (st) => {
        const list = role === 'fixed' ? st.fixed : st.load.faces;
        const other = role === 'fixed' ? st.load.faces : st.fixed;
        const has = list.some((r) => sameFaceRef(r, ref));
        // Une face est fixée ou chargée, pas les deux.
        const mine = has ? list.filter((r) => !sameFaceRef(r, ref)) : [...list, ref];
        const theirs = has ? other : other.filter((r) => !sameFaceRef(r, ref));
        return role === 'fixed' ? { ...st, fixed: mine, load: { ...st.load, faces: theirs } } : { ...st, fixed: theirs, load: { ...st.load, faces: mine } };
      },
      role === 'fixed' ? 'Choisir les faces fixées' : 'Choisir les faces chargées',
    );
  }

  /** Lance le calcul de la pièce étudiée (dans le worker de simulation). */
  async runSimulation(): Promise<void> {
    const partId = this.simulationPartId();
    const source = partId ? this.simulationSource(partId) : null;
    if (!partId || !source) return this.explain('Choisissez une pièce qui a un volume.');
    const stale = partId === ASSEMBLY_STUDY ? (this.state.doc.assembly?.instances ?? []).some((i) => this.state.display[i.partId]?.stale) : this.state.display[partId]?.stale;
    if (stale) return this.explain('Une pièce a une erreur : corrigez-la dans l’onglet Pièces avant de lancer le calcul.');
    const study = studyOf(this.state.doc, partId);
    const problem = studyInput(study, source);
    if (!problem.ok) return this.explain(problem.message);
    const key = studyKey(study, source.key);
    // Un seul calcul à la fois dans le worker : une optimisation en cours est abandonnée.
    if (this.state.topologyRun?.status === 'running') this.set({ topologyRun: null });
    this.set({ mode: this.state.mode.kind === 'pick-sim-face' ? model : this.state.mode, simulationRun: { partId, key, status: 'running', progress: 0, size: meshSize(problem.input.positions) }, topologyRun: null });
    const runner = this.deps.simulation ?? inlineSimRunner;
    const current = () => {
      const r = this.state.simulationRun;
      return r?.key === key ? r : null;
    };
    try {
      const result = await runner.run(problem.input, (progress) => {
        const r = current();
        if (r?.status === 'running') this.set({ simulationRun: { ...r, progress } });
      });
      const r = current();
      if (r) this.set({ simulationRun: { ...r, status: 'done', progress: 1, result } });
    } catch (err) {
      if (err instanceof AbortedStudy) return;
      const r = current();
      if (r) this.set({ simulationRun: { ...r, status: 'error', error: err instanceof StudyError ? STUDY_ERRORS[err.code] : 'Le calcul a échoué.' } });
    }
  }

  cancelSimulation(): void {
    if (this.state.simulationRun?.status === 'running') this.deps.simulation?.cancel();
    if (this.state.simulationRun) this.set({ simulationRun: null });
  }

  // ----- Optimisation topologique (« Alléger la pièce »)

  /** Part de la matière à garder (10 à 90 %). */
  setTopologyFraction(fraction: number): void {
    this.set({ topologyFraction: Math.min(0.9, Math.max(0.1, fraction)) });
  }

  /** Forme symétrique (plan médian de la pièce normal à cet axe), ou forme libre. */
  setTopologySymmetry(axis: 0 | 1 | 2 | null): void {
    this.set({ topologySymmetry: axis });
  }

  /**
   * Cherche où la matière de la pièce étudiée est utile, avec ses faces fixées et sa charge (dans
   * le worker de simulation ; une étude de déformation en cours est abandonnée).
   */
  async runTopology(): Promise<void> {
    const partId = this.simulationPartId();
    const source = partId ? this.simulationSource(partId) : null;
    if (!partId || !source) return this.explain('Choisissez une pièce qui a un volume.');
    if (partId === ASSEMBLY_STUDY) return this.explain('L’allègement se fait sur une pièce à la fois : choisissez une pièce dans la liste.');
    if (this.state.display[partId]?.stale) return this.explain('La pièce a une erreur : corrigez-la dans l’onglet Pièces avant de lancer le calcul.');
    const study = studyOf(this.state.doc, partId);
    const problem = studyInput(study, source);
    if (!problem.ok) return this.explain(problem.message);
    const volumeFraction = this.state.topologyFraction;
    const symmetry = this.state.topologySymmetry;
    const key = topologyKey(study, source.key, volumeFraction, symmetry);
    if (this.state.simulationRun?.status === 'running') this.set({ simulationRun: null });
    const threshold = this.state.topologyRun?.threshold ?? 0.5;
    this.set({ mode: this.state.mode.kind === 'pick-sim-face' ? model : this.state.mode, topologyRun: { partId, key, status: 'running', progress: 0, volumeFraction, threshold } });
    const runner = this.deps.simulation ?? inlineSimRunner;
    const current = () => {
      const r = this.state.topologyRun;
      return r?.key === key ? r : null;
    };
    try {
      const result = await runner.optimize({ ...problem.input, volumeFraction, ...(symmetry !== null ? { symmetry: [symmetry] } : {}) }, (progress) => {
        const r = current();
        if (r?.status === 'running') this.set({ topologyRun: { ...r, progress } });
      });
      const r = current();
      if (r) this.set({ topologyRun: { ...r, status: 'done', progress: 1, result, surface: topologySurface(result, r.threshold) } });
    } catch (err) {
      if (err instanceof AbortedStudy) return;
      const r = current();
      if (r) this.set({ topologyRun: { ...r, status: 'error', error: err instanceof StudyError ? STUDY_ERRORS[err.code] : 'Le calcul a échoué.' } });
    }
  }

  /** Seuil de densité de la forme montrée : plus haut, seule la matière la plus utile reste. */
  setTopologyThreshold(threshold: number): void {
    const r = this.state.topologyRun;
    if (!r) return;
    const t = Math.min(0.8, Math.max(0.2, threshold));
    this.set({ topologyRun: { ...r, threshold: t, ...(r.result ? { surface: topologySurface(r.result, t) } : {}) } });
  }

  /** Arrête le calcul, ou referme la forme obtenue (retour à la pièce). */
  closeTopology(): void {
    if (this.state.topologyRun?.status === 'running') this.deps.simulation?.cancel();
    if (this.state.topologyRun) this.set({ topologyRun: null });
  }

  /** La forme obtenue, en STL (à redessiner proprement ou à imprimer telle quelle). */
  async exportTopologyStl(): Promise<void> {
    const r = this.state.topologyRun;
    if (!r?.surface || r.surface.cells === 0) return this.explain('Lancez d’abord « Alléger la pièce ».');
    const part = findPart(this.state.doc, r.partId);
    const bytes = meshesToBinaryStl([r.surface], 'VibeCAD - piece allegee');
    const target = await saveFile(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/stl' }), safeFileName(`${part?.name ?? 'Pièce'} allégée`, '.stl'), {
      description: 'Fichier STL',
      mime: 'model/stl',
      extension: '.stl',
      download: true,
    });
    if (target) this.toast('success', `Fichier STL « ${target.name} » téléchargé. ${STL_UNIT_NOTE}`);
  }

  /**
   * La forme obtenue devient une nouvelle pièce du projet. Pièce plate : une esquisse (le contour
   * de la forme) extrudée de l'épaisseur de la plaque, modifiable et découpable au laser ; sinon,
   * la forme en STL, par la fenêtre d'import.
   */
  async keepTopologyAsPart(): Promise<void> {
    const r = this.state.topologyRun;
    if (!r?.surface || r.surface.cells === 0) return this.explain('Lancez d’abord « Alléger la pièce ».');
    const part = findPart(this.state.doc, r.partId);
    const outline = r.result ? topologyOutline(r.result, r.threshold) : null;
    if (outline) {
      const name = `${part?.name ?? 'Pièce'} allégée`;
      const added = addPart(this.state.doc, name);
      let doc = added.doc;
      const partId = added.partId;
      // Plan XZ : normale −Y ; l'esquisse est posée sur la face arrière et extrudée vers l'avant.
      const offset = outline.plane === 'XZ' ? -outline.end : outline.start;
      const sketch = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: outline.plane, offset });
      let params = sketch.params;
      for (const loop of outline.loops) params = addClosedPolyline(params, loop).sketch;
      doc = addFeature(doc, partId, { ...sketch, params });
      const thickness = Math.round((outline.end - outline.start) * 1000) / 1000;
      doc = addFeature(doc, partId, makeExtrudeFeature(doc, findPart(doc, partId)!, sketch.id, thickness));
      this.commit(doc, 'Garder la pièce allégée', { activePartId: partId, selection: { kind: 'part', partId } });
      this.toast('success', `« ${name} » ajoutée : le contour de la forme, dessiné dans une esquisse et extrudé de ${formatLength(thickness)}. Elle est à la place de « ${part?.name ?? 'la pièce'} » (masquez celle-ci pour mieux la voir), se modifie comme une autre pièce et se découpe au laser.`);
      return;
    }
    const bytes = meshesToBinaryStl([r.surface], 'VibeCAD - piece allegee');
    await this.beginImport(new File([bytes as Uint8Array<ArrayBuffer>], `${part?.name ?? 'Pièce'} allégée.stl`, { type: 'model/stl' }));
  }

  setSimulationDisplay(display: ResultDisplay): void {
    this.set({ simulationDisplay: display });
  }

  setSimulationDeformed(on: boolean): void {
    this.set({ simulationDeformed: on });
  }

  setSimulationAnimate(on: boolean): void {
    this.set({ simulationAnimate: on });
  }

  // ----- Fabrication

  setFabricationTab(tab: FabricationTab): void {
    if ((tab === 'laser' && !this.can('fabrication:laser')) || (tab === 'docs' && !this.can('fabrication:docs'))) {
      return this.explain('Cet outil est disponible à partir du niveau Intermédiaire (en bas à droite : « Niveau »).');
    }
    this.set({ fabricationTab: tab, mode: this.state.mode.kind === 'pick-fab-face' ? model : this.state.mode, fitRequest: this.state.fitRequest + 1 });
  }

  /** Réglages de fabrication complétés (une ligne par pièce ayant un volume). */
  fabrication(): FabricationSettings {
    return fabricationSettings(this.state.doc, (id) => (this.state.display[id]?.result.analysis?.solidCount ?? 0) > 0);
  }

  /** Modifie les réglages de fabrication (enregistrés dans le projet, annulables). */
  updateFabrication(change: (f: FabricationSettings) => FabricationSettings, label: string): void {
    const next = change(this.fabrication());
    this.commit({ ...this.state.doc, fabrication: next }, label);
  }

  pickFabricationFace(purpose: 'print' | 'laser', partId: Id): void {
    this.set({ mode: { kind: 'pick-fab-face', purpose, partId } });
  }

  cancelFabricationPick(): void {
    if (this.state.mode.kind === 'pick-fab-face') this.set({ mode: model });
  }

  /** Disposition actuelle des pièces à découper au laser. */
  laserLayout(): LaserLayout {
    const s = this.state;
    // Tôle pliée : on découpe son développé (la tôle à plat), avec ses lignes de pli.
    return laserLayout(
      this.fabrication().laser,
      s.doc.parts,
      (id) => s.display[id]?.result.flat?.mesh ?? s.display[id]?.mesh,
      (id) => s.display[id]?.result.flat?.bends.flatMap((b) => b.lines.map((l) => ({ point: l.point, dir: l.dir, angle: b.angle }))),
    );
  }

  /** Plaques en grand (édition du placement des pièces d'un matériau), ou fermeture. */
  openLaserEditor(materialId: Id | null): void {
    this.set({ laserEditor: materialId ? { materialId } : null });
  }

  private setLaserPlacements(materialId: Id, placements: LaserPlacement[] | null, label: string): void {
    this.updateFabrication(
      (f) => ({
        ...f,
        laser: {
          ...f.laser,
          materials: f.laser.materials.map((m) => {
            if (m.id !== materialId) return m;
            const { placements: _old, ...rest } = m;
            return placements ? { ...rest, placements } : rest;
          }),
        },
      }),
      label,
    );
  }

  /**
   * Déplace ou tourne un exemplaire de pièce sur les plaques d'un matériau. La première fois, la
   * disposition actuelle de toutes les pièces est figée (elles ne bougent plus d'elles-mêmes).
   */
  placeLaserPiece(materialId: Id, partId: Id, copy: number, placement: { sheet: number; x: number; y: number; angle: number }, label = 'Déplacer une pièce sur la plaque'): void {
    const group = this.laserLayout().materials.find((g) => g.material.id === materialId);
    if (!group) return;
    const current: LaserPlacement[] = group.placed.map((p) => ({ partId: p.partId, copy: p.copy, sheet: p.sheet, ...p.placement }));
    const next = current.map((p) => (p.partId === partId && p.copy === copy ? { partId, copy, ...placement, angle: ((placement.angle % 360) + 360) % 360 } : p));
    this.setLaserPlacements(materialId, next, label);
  }

  /** Imbrication serrée de toutes les pièces d'un matériau (rotations par quart de tour). */
  optimizeLaser(materialId: Id): void {
    const placements = optimizedPlacements(this.laserLayout(), materialId, this.fabrication().laser.spacing);
    if (!placements.length) return this.explain('Aucune pièce à placer pour ce matériau.');
    const before = this.laserLayout().materials.find((g) => g.material.id === materialId)?.sheets ?? 0;
    this.setLaserPlacements(materialId, placements, 'Optimiser le placement');
    const after = this.laserLayout().materials.find((g) => g.material.id === materialId)?.sheets ?? 0;
    this.toast('success', `Pièces imbriquées au plus serré : ${after} plaque${after > 1 ? 's' : ''}${before !== after ? ` (au lieu de ${before})` : ''}.`);
  }

  /** Retour au rangement automatique par rangées. */
  resetLaserPlacements(materialId: Id): void {
    this.setLaserPlacements(materialId, null, 'Ranger automatiquement les pièces');
  }

  /** Fichier de découpe laser (SVG ou DXF) des plaques d'un matériau. */
  laserDocument(materialId: Id): VectorDocument | null {
    const f = this.fabrication().laser;
    const group = this.laserLayout().materials.find((g) => g.material.id === materialId);
    if (!group) return null;
    const sheets = Array.from({ length: group.sheets }, (_v, i) => ({
      items: group.placed.filter((p) => p.sheet === i).map((p) => ({ loops: p.loops, label: { at: p.labelAt, text: p.name }, ...(p.bends ? { bends: p.bends } : {}) })),
    }));
    return { sheet: group.material.sheet, sheets, engraveNames: !!f.engraveNames };
  }

  /** Export laser : un fichier par matériau (celui demandé, ou chacun de ceux qui ont des pièces). */
  async exportLaser(format: 'svg' | 'dxf', materialId?: Id): Promise<void> {
    const layout = this.laserLayout();
    const groups = layout.materials.filter((g) => g.placed.length > 0 && (!materialId || g.material.id === materialId));
    if (groups.length === 0) return this.explain('Aucune pièce à découper : indiquez au moins un exemplaire.');
    const mime = format === 'svg' ? 'image/svg+xml' : 'application/dxf';
    try {
      for (const g of groups) {
        const doc = this.laserDocument(g.material.id)!;
        const text = format === 'svg' ? toSvg(doc) : toDxf(doc);
        const target = await saveFile(new Blob([text], { type: mime }), safeFileName(`${this.state.doc.name} - laser - ${g.material.name}`, `.${format}`), {
          description: format === 'svg' ? 'Fichier SVG' : 'Fichier DXF',
          mime,
          extension: `.${format}`,
          download: true,
        });
        if (target) {
          this.toast(
            'success',
            `Fichier ${format.toUpperCase()} « ${target.name} » téléchargé : ${g.placed.length} pièce(s) sur ${g.sheets} plaque(s) de ${g.material.name}, à l’échelle 1:1 en millimètres (rouge : découpe, bleu : gravure).`,
          );
        }
      }
    } catch (err) {
      this.toast('error', 'L’export a échoué.', { detail: (err as Error).message });
    }
  }

  addLaserMaterial(): Id {
    const material = newLaserMaterial(this.fabrication().laser.materials);
    this.updateFabrication((f) => ({ ...f, laser: { ...f.laser, materials: [...f.laser.materials, material] } }), 'Ajouter un matériau');
    return material.id;
  }

  updateLaserMaterial(id: Id, patch: Partial<Omit<LaserMaterial, 'id'>>, label: string): void {
    this.updateFabrication((f) => ({ ...f, laser: { ...f.laser, materials: f.laser.materials.map((m) => (m.id === id ? { ...m, ...patch } : m)) } }), label);
  }

  /** Supprime un matériau (sauf le dernier) : ses pièces reprennent le matériau automatique. */
  removeLaserMaterial(id: Id): void {
    const materials = this.fabrication().laser.materials;
    if (materials.length <= 1) return this.explain('Il faut garder au moins un matériau.');
    const name = materials.find((m) => m.id === id)?.name ?? '';
    this.updateFabrication(
      (f) => ({
        ...f,
        laser: {
          ...f.laser,
          materials: f.laser.materials.filter((m) => m.id !== id),
          items: f.laser.items.map((i) => (i.materialId === id ? { partId: i.partId, copies: i.copies, ...(i.face ? { face: i.face } : {}) } : i)),
        },
      }),
      `Supprimer le matériau « ${name} »`,
    );
  }

  /** Plateau d'impression affiché (et exporté par défaut). */
  setPrintPlate(plate: number): void {
    const plates = this.printLayout().plates;
    this.set({ printPlate: Math.max(0, Math.min(plate, plates - 1)), fitRequest: this.state.fitRequest + 1 });
  }

  /** Plateau affiché, ramené dans les plateaux existants. */
  printPlate(): number {
    return Math.max(0, Math.min(this.state.printPlate, this.printLayout().plates - 1));
  }

  // ----- Documents (mise en plan, gabarit, nomenclature)

  private drawingCache = new Map<string, { page: DrawingPage; scale: number }>();

  setFabricationPart(partId: Id): void {
    this.set({ fabricationPart: partId });
  }

  private hasSolid(partId: Id): boolean {
    return (this.state.display[partId]?.result.analysis?.solidCount ?? 0) > 0;
  }

  /** Pièce dont la mise en plan est affichée : celle choisie, sinon la première ayant un volume. */
  docsPart(): Id | null {
    const s = this.state;
    if (s.fabricationPart && this.hasSolid(s.fabricationPart)) return s.fabricationPart;
    return s.doc.parts.find((p) => this.hasSolid(p.id))?.id ?? null;
  }

  /** Vues exactes (traits cachés calculés par le noyau) par version de maillage de pièce. */
  private exactViews = new Map<string, Record<ViewName, ProjectedView> | 'pending' | 'failed'>();

  /**
   * Demande au worker les vues exactes d'une pièce (une fois par version) ; à leur arrivée, la
   * mise en plan affichée est refaite avec elles.
   */
  private ensureExactViews(partId: Id): Promise<void> {
    const s = this.state;
    const d = s.display[partId];
    if (!d?.meshKey) return Promise.resolve();
    const key = d.meshKey;
    const known = this.exactViews.get(key);
    if (known && known !== 'pending') return Promise.resolve();
    const pending = this.exactRequests.get(key);
    if (pending) return pending;
    this.exactViews.set(key, 'pending');
    const request = this.deps.client
      .hiddenLines(s.doc, partId, VIEW_ORDER.map((v) => ({ u: VIEWS[v].u, toViewer: VIEWS[v].toViewer })))
      .then((r) => {
        if (r.views.length !== VIEW_ORDER.length) return void this.exactViews.set(key, 'failed');
        const views = Object.fromEntries(VIEW_ORDER.map((v, i) => [v, viewFromLines(r.views[i]!)])) as Record<ViewName, ProjectedView>;
        if (this.exactViews.size > 40) this.exactViews.clear();
        this.exactViews.set(key, views);
        this.set({ drawingRevision: this.state.drawingRevision + 1 });
      })
      .catch(() => void this.exactViews.set(key, 'failed'))
      .finally(() => this.exactRequests.delete(key));
    this.exactRequests.set(key, request);
    return request;
  }

  private exactRequests = new Map<string, Promise<void>>();

  /**
   * Mise en plan d'une pièce (mise en cache par maillage). Les traits cachés exacts arrivent du
   * worker ; en attendant, ceux déduits du maillage s'affichent.
   */
  drawingOf(partId: Id): { page: DrawingPage; scale: number } | null {
    const s = this.state;
    const part = findPart(s.doc, partId);
    const d = s.display[partId];
    if (!part || !d?.mesh || !this.hasSolid(partId)) return null;
    const exact = d.meshKey ? this.exactViews.get(d.meshKey) : undefined;
    const views = exact && exact !== 'pending' && exact !== 'failed' ? exact : undefined;
    if (!exact) void this.ensureExactViews(partId);
    const key = `${d.meshKey}|${part.name}|${s.doc.name}|${views ? 'exact' : 'mesh'}`;
    let drawing = this.drawingCache.get(key);
    if (!drawing) {
      drawing = technicalDrawing(d.mesh, { partName: part.name, projectName: s.doc.name }, views);
      if (this.drawingCache.size > 20) this.drawingCache.clear();
      this.drawingCache.set(key, drawing);
    }
    return drawing;
  }

  /** Mise en plan : PDF de toutes les pièces (une page chacune) ou SVG de la pièce affichée. */
  async exportDrawing(format: 'pdf' | 'svg'): Promise<void> {
    const s = this.state;
    const ids = format === 'pdf' ? s.doc.parts.filter((p) => this.hasSolid(p.id)).map((p) => p.id) : [this.docsPart()].filter((id): id is Id => !!id);
    // Les fichiers exportés portent les traits cachés exacts.
    await Promise.all(ids.map((id) => this.ensureExactViews(id)));
    const pages = ids.map((id) => this.drawingOf(id)?.page).filter((p): p is DrawingPage => !!p);
    if (pages.length === 0) return this.explain('Aucune pièce avec un volume à mettre en plan.');
    const name = format === 'svg' ? `${findPart(s.doc, ids[0]!)?.name ?? s.doc.name} - mise en plan` : `${s.doc.name} - mise en plan`;
    const blob =
      format === 'pdf'
        ? new Blob([drawingsToPdf(pages, `Mise en plan — ${s.doc.name}`) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
        : new Blob([drawingToSvg(pages[0]!, name)], { type: 'image/svg+xml' });
    await this.download(blob, name, format, `Mise en plan téléchargée (${pages.length} page${pages.length > 1 ? 's' : ''}, A4 paysage) : imprimez-la en « taille réelle ».`);
  }

  /** Gabarits papier 1:1 de toutes les pièces (PDF, une page par pièce). */
  async exportTemplate(): Promise<void> {
    const s = this.state;
    const laser = this.fabrication().laser.items;
    const res = templatePages(
      s.doc.parts.filter((p) => this.hasSolid(p.id)),
      (id) => s.display[id]?.mesh,
      (id, mesh) => {
        const ref = laser.find((i) => i.partId === id)?.face;
        return ref ? findPlanarFace(mesh, ref) : -1;
      },
    );
    for (const w of res.warnings) this.toast('info', w);
    if (res.pages.length === 0) return;
    const formats = [...new Set(res.formats)].join(' et ');
    await this.download(
      new Blob([drawingsToPdf(res.pages, `Gabarits — ${s.doc.name}`) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      `${s.doc.name} - gabarit`,
      'pdf',
      `Gabarit téléchargé (${res.pages.length} page${res.pages.length > 1 ? 's' : ''} ${formats}) : imprimez en « taille réelle » et vérifiez le trait de 50 mm.`,
    );
  }

  /** Nomenclature : pièces de l'assemblage et quantités (ou une de chaque pièce). */
  billOfMaterials(): Bom {
    const s = this.state;
    return billOfMaterials(
      s.doc,
      (id) => this.hasSolid(id),
      (id) => s.display[id]?.mesh,
      (id) => s.display[id]?.result.analysis?.volume,
    );
  }

  async exportBom(): Promise<void> {
    const bom = this.billOfMaterials();
    if (bom.rows.length === 0) return this.explain('Aucune pièce avec un volume : la nomenclature est vide.');
    await this.download(new Blob([bomCsv(bom)], { type: 'text/csv' }), `${this.state.doc.name} - nomenclature`, 'csv', 'Nomenclature téléchargée (CSV) : elle s’ouvre dans un tableur.');
  }

  private async download(blob: Blob, baseName: string, extension: 'pdf' | 'svg' | 'csv', message: string): Promise<void> {
    const descriptions = { pdf: 'Document PDF', svg: 'Fichier SVG', csv: 'Tableau CSV' };
    try {
      const target = await saveFile(blob, safeFileName(baseName, `.${extension}`), { description: descriptions[extension], mime: blob.type, extension: `.${extension}`, download: true });
      if (target) this.toast('success', `« ${target.name} » — ${message}`);
    } catch (err) {
      this.toast('error', 'L’export a échoué.', { detail: (err as Error).message });
    }
  }

  /** Disposition actuelle du plateau d'impression. */
  printLayout(): PrintLayout {
    const s = this.state;
    return printLayout(this.fabrication().print, s.doc.parts, (id) => s.display[id]?.mesh, (id) => s.display[id]?.result.analysis);
  }

  private fabricationPick(pick: ModelPick | null): void {
    const mode = this.state.mode;
    if (mode.kind !== 'pick-fab-face' && this.state.fabricationTab === 'docs') {
      if (pick?.kind === 'face') this.setFabricationPart(pick.partId.split(':')[1] ?? pick.partId);
      return;
    }
    if (mode.kind !== 'pick-fab-face' || !pick || pick.kind !== 'face') return;
    const partId = pick.partId.split(':')[1] ?? pick.partId;
    if (partId !== mode.partId) return this.explain('Cliquez une face de la pièce choisie.');
    const part = findPart(this.state.doc, partId);
    const face = this.state.display[partId]?.mesh?.faces[pick.index];
    if (!part || !face) return;
    if (!face.plane) return this.explain('Choisissez une face plate.');
    const ref = pickFaceReference(face.tags, part);
    if (!ref) return;
    const purpose = mode.purpose;
    this.updateFabrication(
      (f) =>
        purpose === 'print'
          ? { ...f, print: { ...f.print, items: f.print.items.map((i) => (i.partId === partId ? { ...i, downFace: ref } : i)) } }
          : { ...f, laser: { ...f.laser, items: f.laser.items.map((i) => (i.partId === partId ? { ...i, face: ref } : i)) } },
      purpose === 'print' ? `Poser « ${part.name} » sur une autre face` : `Contour de découpe de « ${part.name} »`,
    );
    this.set({ mode: model });
  }

  /** Placement actuel des pièces de l'assemblage. */
  assemblyPlacement(): AssemblyPlacement | null {
    const assembly = this.state.doc.assembly;
    if (!assembly) return null;
    return solveAssembly(assembly, (partId) => this.state.display[partId]?.mesh, this.solveOptions());
  }

  /** Options du solveur : esquisses des pièces (repères sur un point) et contenu des sous-assemblages. */
  solveOptions(): SolveOptions {
    return {
      sketchesOf: this.sketchesOf,
      subassemblyOf: (id) => subassemblyContent(this.state.doc, id),
      subassemblyNameOf: (id) => subassemblyList(this.state.doc).find((x) => x.id === id)?.name,
    };
  }

  /** Pièces placées de l'assemblage, sous-assemblages dépliés (vue, exports, collisions, simulation). */
  assemblyLeaves(placement = this.assemblyPlacement()): PlacedLeaf[] {
    const assembly = this.state.doc.assembly;
    if (!assembly || !placement) return [];
    return flattenAssembly(assembly, placement, (partId) => this.state.display[partId]?.mesh, this.solveOptions());
  }

  selectInAssembly(selection: AppState['assemblySelection']): void {
    if (this.animation && !(selection?.kind === 'joint' && selection.id === this.animation.jointId)) this.stopJointAnimation();
    this.set({ assemblySelection: selection });
  }

  insertInstance(partId: Id): void {
    const s = this.state;
    const part = findPart(s.doc, partId);
    if (!part) return;
    if ((s.display[partId]?.result.analysis?.solidCount ?? 0) === 0) return this.explain(`« ${part.name} » n’a pas encore de volume : construisez-la d’abord dans l’onglet Pièces.`);
    // Posée à droite des pièces déjà insérées (sans se chevaucher), en attendant une liaison.
    const placement = this.assemblyPlacement();
    let x = 0;
    for (const inst of s.doc.assembly?.instances ?? []) {
      const bbox = s.display[inst.partId]?.result.analysis?.bbox;
      const m = placement?.matrices.get(inst.id);
      if (bbox && m) x = Math.max(x, m[12]! + bbox.max.x + 20);
    }
    const first = !(s.doc.assembly?.instances.length);
    const bbox = s.display[partId]?.result.analysis?.bbox;
    const position = first ? { x: 0, y: 0, z: 0 } : { x: x - (bbox?.min.x ?? 0), y: 0, z: 0 };
    const r = addInstance(s.doc, partId, position);
    this.commit(r.doc, `Insérer « ${part.name} » dans l’assemblage`, {
      assemblySelection: { kind: 'instance', id: r.instanceId },
      fitRequest: s.fitRequest + 1,
    });
    if (first) this.toast('info', `« ${part.name} » est la pièce fixe de l’assemblage (punaise). Insérez une autre pièce, puis reliez-les avec « Liaison ».`);
  }

  // ----- Sous-assemblages

  /** Crée un sous-assemblage vide et l'ouvre pour le construire. */
  createSubassembly(): void {
    if (!this.can('assembly:subassemblies')) return;
    const r = addSubassembly(closedDocument(this.state.doc));
    this.commit(openSubassembly(r.doc, r.id), 'Créer un sous-assemblage', { assemblySelection: null, mode: model, explode: 0, fitRequest: this.state.fitRequest + 1 });
  }

  /** Ouvre un sous-assemblage pour le modifier, ou revient à l'assemblage principal (`null`). */
  editSubassembly(id: Id | null): void {
    if (this.animation) this.stopJointAnimation();
    const doc = id ? openSubassembly(this.state.doc, id) : closedDocument(this.state.doc);
    if (doc === this.state.doc) return;
    // Simple changement de vue : ni action dans l'historique, ni modification du projet.
    this.set({ doc, assemblySelection: null, mode: model, explode: 0, collisions: null, fitRequest: this.state.fitRequest + 1 });
  }

  renameSubassemblyTo(id: Id, name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.commit(renameSubassembly(this.state.doc, id, clean), 'Renommer un sous-assemblage');
  }

  /** Supprime un sous-assemblage, s'il n'est inséré nulle part. */
  deleteSubassembly(id: Id): void {
    const uses = subassemblyUses(this.state.doc, id);
    const name = subassemblyList(this.state.doc).find((s) => s.id === id)?.name ?? 'Ce sous-assemblage';
    if (uses.length) return this.explain(`« ${name} » est inséré dans ${uses.join(', ')} : retirez-le d’abord de ${uses.length > 1 ? 'ces assemblages' : 'cet assemblage'}.`);
    this.commit(removeSubassembly(this.state.doc, id), `Supprimer le sous-assemblage « ${name} »`, { assemblySelection: null, explode: 0 });
  }

  /**
   * Importe un autre projet `.vibecad` comme sous-assemblage : ses pièces rejoignent le projet,
   * son assemblage devient un bloc à insérer (« Insérer ▾ »).
   */
  async importSubassemblyFile(): Promise<void> {
    if (!this.can('assembly:subassemblies')) return;
    if (this.state.mode.kind !== 'model') return this.explain('Terminez d’abord l’opération en cours.');
    const file = await pickFile(`${NATIVE_EXTENSION},application/json`);
    if (!file) return;
    const r = importProjectAsSubassembly(this.state.doc, await file.text(), file.name);
    if (!r.ok) return this.set({ dialog: { kind: 'problem', title: 'Import impossible', message: r.error, details: [] } });
    this.commit(r.doc, `Importer « ${r.name} » comme sous-assemblage`);
    this.toast('success', `« ${r.name} » est maintenant un sous-assemblage (${r.parts} pièce${r.parts > 1 ? 's' : ''} ajoutée${r.parts > 1 ? 's' : ''}) : insérez-le avec « Insérer ▾ ».`, r.warnings.length ? { detail: r.warnings.join('\n') } : {});
  }

  /** Insère un sous-assemblage comme un bloc rigide dans l'assemblage ouvert. */
  insertSubassembly(id: Id): void {
    const s = this.state;
    const editing = s.doc.editingSubassembly;
    if (editing && subassemblyContains(s.doc, id, editing)) return this.explain('Un sous-assemblage ne peut pas s’insérer dans lui-même, ni dans un bloc qu’il contient.');
    const content = subassemblyContent(s.doc, id);
    if (!content?.instances.length) return this.explain('Ce sous-assemblage est vide : ouvrez-le et insérez-y des pièces d’abord.');
    // Posé à droite de ce qui est déjà inséré, en attendant une liaison.
    let x = 0;
    for (const leaf of this.assemblyLeaves()) {
      const bbox = s.display[leaf.partId]?.result.analysis?.bbox;
      if (bbox) x = Math.max(x, leaf.matrix[12]! + bbox.max.x + 20);
    }
    const first = !s.doc.assembly?.instances.length;
    const r = addSubassemblyInstance(s.doc, id, first ? { x: 0, y: 0, z: 0 } : { x, y: 0, z: 0 });
    const name = r.doc.assembly!.instances.find((i) => i.id === r.instanceId)!.name;
    this.commit(r.doc, `Insérer « ${name} » dans l’assemblage`, { assemblySelection: { kind: 'instance', id: r.instanceId }, fitRequest: s.fitRequest + 1 });
  }

  removeInstance(instanceId: Id): void {
    const inst = this.state.doc.assembly?.instances.find((i) => i.id === instanceId);
    if (!inst) return;
    this.commit(removeInstance(this.state.doc, instanceId), `Retirer « ${inst.name} » de l’assemblage`, { assemblySelection: null });
  }

  moveInstance(instanceId: Id, position: { x: number; y: number; z: number }): void {
    this.commit(updateInstance(this.state.doc, instanceId, (i) => ({ ...i, position })), 'Déplacer une pièce de l’assemblage');
  }

  startJoint(): void {
    if ((this.state.doc.assembly?.instances.length ?? 0) < 2) return this.explain('Insérez d’abord deux pièces : une liaison relie une pièce mobile à une pièce de référence.');
    this.set({ mode: { kind: 'joint', moving: null }, assemblySelection: null });
  }

  cancelJoint(): void {
    if (this.state.mode.kind === 'joint') this.set({ mode: model });
  }

  /** Esquisses calculées d'une pièce (repères d'assemblage posés sur un point d'esquisse). */
  private sketchesOf = (partId: Id) => this.state.display[partId]?.result.sketches;

  private assemblyPick(pick: ModelPick | null): void {
    const s = this.state;
    const mode = s.mode;
    if (mode.kind === 'fastener') return this.fastenerPick(pick, mode.fastenerKind);
    if (mode.kind !== 'joint') {
      // Une pièce (ou une vis) d'un sous-assemblage désigne le bloc entier (clé « bloc/… »).
      const fastener = pick?.partId.startsWith('fs:') ? pick.partId.slice(3) : null;
      if (fastener && !fastener.includes('/')) return this.set({ assemblySelection: { kind: 'fasteners', ids: [fastener] } });
      const key = fastener ?? pick?.partId;
      this.set({ assemblySelection: key ? { kind: 'instance', id: key.split('/')[0]! } : null });
      return;
    }
    if (pick?.partId.startsWith('fs:')) return this.explain('Choisissez un repère sur une pièce, pas sur une vis.');
    if (!pick) return;
    const leaf = this.assemblyLeaves().find((l) => l.key === pick.partId);
    const part = leaf && findPart(s.doc, leaf.partId);
    const mesh = leaf && s.display[leaf.partId]?.mesh;
    if (!leaf || !part || !mesh) return;
    // Un sommet est désigné dans le monde : on le ramène dans les coordonnées de la pièce.
    const local = pick.kind === 'vertex' ? transformPoint4(invertRigid4(leaf.matrix), pick.point) : pick.point;
    const r = lcsFromPick(mesh, pick.kind, pick.index, part, local);
    if ('reason' in r) return this.explain(r.reason);
    this.jointEndChosen({ instanceId: leaf.instanceId, ...(leaf.member.length ? { member: leaf.member } : {}), lcs: r.ref }, { kind: pick.kind === 'vertex' ? 'face' : pick.kind, index: pick.index });
  }

  /** Clic sur un point seul d'esquisse pendant la création d'une liaison : il devient le repère. */
  pickJointPoint(leafKey: string, sketchId: Id, pointId: string): void {
    if (this.state.mode.kind !== 'joint') return;
    const leaf = this.assemblyLeaves().find((l) => l.key === leafKey);
    if (!leaf) return;
    this.jointEndChosen({ instanceId: leaf.instanceId, ...(leaf.member.length ? { member: leaf.member } : {}), lcs: { kind: 'point', sketchId, pointId } });
  }

  /** Repère choisi pendant la création d'une liaison : premier (pièce qui bouge) ou second (référence). */
  private jointEndChosen(end: JointEnd, movingPick?: { kind: 'face' | 'edge'; index: number }): void {
    const s = this.state;
    const mode = s.mode;
    if (mode.kind !== 'joint') return;
    const inst = s.doc.assembly?.instances.find((i) => i.id === end.instanceId);
    if (!inst) return;
    if (!mode.moving) {
      this.set({ mode: { kind: 'joint', moving: end, ...(movingPick ? { movingPick } : {}), lockedFace: null } });
      return;
    }
    if (mode.moving.instanceId === inst.id) {
      return this.explain(inst.subassemblyId ? 'Ce sous-assemblage est un seul bloc : choisissez un repère sur une autre pièce ou un autre bloc.' : 'Choisissez un repère sur une autre pièce : la pièce de référence.');
    }
    // La pièce fixe ne bouge jamais : si elle a été choisie en premier, les rôles sont échangés.
    const fixedId = s.doc.assembly!.instances[0]!.id;
    // Pièces déjà tenues (la fixe, et celles placées par une liaison). Si la pièce choisie en
    // premier l'est déjà et pas l'autre, les rôles sont échangés ; si les deux le sont, la
    // nouvelle liaison referme une boucle (quadrilatère articulé…) : le solveur la satisfait.
    const held = new Set([fixedId, ...s.doc.assembly!.joints.map((j) => j.moving.instanceId)]);
    const swap = mode.moving.instanceId === fixedId || (held.has(mode.moving.instanceId) && !held.has(end.instanceId));
    const [moving, base] = swap ? [end, mode.moving] : [mode.moving, end];
    const closesLoop = held.has(moving.instanceId);
    const meshOf = (end: JointEnd) => {
      const part = endPart(s.doc.assembly!, end, (partId) => s.display[partId]?.mesh, this.solveOptions());
      return part ? s.display[part.partId]?.mesh : undefined;
    };
    const sphere = [moving, base].some((e) => {
      const m = meshOf(e);
      return !!m && isSphereLcs(m, e.lcs);
    });
    // Une sphère donne une rotule ; deux bords circulaires, un pivot ; sinon une liaison fixe.
    const kind: JointKind = sphere ? 'spherical' : moving.lcs.kind === 'circle' && base.lcs.kind === 'circle' ? 'revolute' : 'fixed';
    const added = addJoint(s.doc, { kind, moving, base, flip: false, angle: 0, offset: 0 });
    this.commit(this.settleLoops(added.doc), 'Créer une liaison', { mode: model, assemblySelection: { kind: 'joint', id: added.jointId } });
    if (closesLoop) {
      const issue = this.assemblyPlacement()?.issues.get(added.jointId);
      this.toast(issue ? 'error' : 'success', issue ? JOINT_ISSUE_MESSAGES[issue] : 'Boucle refermée : faites tourner une pièce de la boucle, les autres suivent.');
    }
  }

  // ----- Visserie

  /** Poser de la visserie : chaque clic sur un trou pose un élément (Échap termine). */
  startFastener(kind: FastenerKind): void {
    if (!(this.state.doc.assembly?.instances.length ?? 0)) return this.explain('Insérez d’abord une pièce percée dans l’assemblage.');
    this.toggleAssemblyHand(false);
    this.set({ mode: { kind: 'fastener', fastenerKind: kind }, assemblySelection: null });
  }

  cancelFastener(): void {
    if (this.state.mode.kind === 'fastener') this.set({ mode: model });
  }

  private fastenerPick(pick: ModelPick | null, kind: FastenerKind): void {
    if (!pick || pick.kind === 'vertex') return;
    const s = this.state;
    // Clic sur un élément déjà posé : le nouveau se pose sur le même trou (rondelle sous une vis…).
    const onto = pick.partId.startsWith('fs:') ? s.doc.assembly?.fasteners?.find((f) => f.id === pick.partId.slice(3)) : undefined;
    if (onto) {
      const inst = s.doc.assembly!.instances.find((i) => i.id === onto.at.instanceId);
      const mesh = inst && s.display[inst.partId]?.mesh;
      const found = mesh ? holeOf(mesh, onto.at.edge) : null;
      if (!found) return this.explain('Le trou de cet élément a disparu : cliquez un autre trou.');
      const spec = fastenerForHole(kind, { edge: onto.at.edge, ...found });
      if ('reason' in spec) return this.explain(spec.reason);
      const added = addFastener(s.doc, { ...spec, at: onto.at, ...(onto.flip ? { flip: true } : {}) });
      return this.commit(added.doc, `Poser ${designation(spec.kind, spec.size, spec.length)}`, { assemblySelection: { kind: 'fasteners', ids: [added.fastenerId] } });
    }
    if (pick.partId.startsWith('fs:')) return;
    if (pick.partId.includes('/')) return this.explain('Cette pièce fait partie d’un sous-assemblage : ouvrez-le (en haut du panneau de gauche) pour y poser de la visserie.');
    const inst = s.doc.assembly?.instances.find((i) => i.id === pick.partId);
    const part = inst && findPart(s.doc, inst.partId);
    const mesh = inst && s.display[inst.partId]?.mesh;
    if (!inst || !part || !mesh) return;
    const placed = this.assemblyPlacement()?.matrices.get(inst.id);
    const local = placed ? transformPoint4(invertRigid4(placed), pick.point) : pick.point;
    const hole = holeFromPick(mesh, part, pick.kind, pick.index, local);
    if ('reason' in hole) return this.explain(hole.reason);
    const spec = fastenerForHole(kind, hole);
    if ('reason' in spec) return this.explain(spec.reason);
    const added = addFastener(s.doc, { ...spec, at: { instanceId: inst.id, edge: hole.edge } });
    const name = designation(spec.kind, spec.size, spec.length);
    this.commit(added.doc, `Poser ${name}`, { assemblySelection: { kind: 'fasteners', ids: [added.fastenerId] } });
  }

  /** Modifie des éléments (un groupe identique) ; la longueur est ramenée à une longueur normalisée. */
  updateFasteners(ids: readonly Id[], patch: Partial<Pick<AssemblyFastener, 'kind' | 'size' | 'length' | 'flip'>>, label: string): void {
    let doc = this.state.doc;
    for (const id of ids) {
      doc = updateFastener(doc, id, (f) => {
        const next = { ...f, ...patch };
        const lengths = lengthsOf(next.kind, next.size);
        if (lengths.length === 0) {
          const { length: _l, ...rest } = next;
          return rest;
        }
        const wanted = next.length ?? lengths[0]!;
        return { ...next, length: lengths.reduce((best, l) => (Math.abs(l - wanted) < Math.abs(best - wanted) ? l : best), lengths[0]!) };
      });
    }
    this.commit(doc, label);
  }

  removeFasteners(ids: readonly Id[]): void {
    if (ids.length === 0) return;
    this.commit(removeFasteners(this.state.doc, ids), ids.length > 1 ? `Supprimer ${ids.length} éléments de visserie` : 'Supprimer un élément de visserie', { assemblySelection: null });
  }

  /** Placement de la visserie dans l'assemblage. */
  fastenerPlacement(): FastenerPlacement | null {
    const assembly = this.state.doc.assembly;
    if (!assembly?.fasteners?.length) return null;
    const placement = this.assemblyPlacement();
    return placeFasteners(assembly, (partId) => this.state.display[partId]?.mesh, (id) => placement?.matrices.get(id));
  }

  /**
   * Touche Maj pendant la création d'une liaison : maintenue sur une face plane, elle la verrouille
   * pour viser un de ses sommets ; relâchée, on revient au choix normal.
   */
  lockJointFace(on: boolean): void {
    const mode = this.state.mode;
    if (mode.kind !== 'joint') return;
    if (!on) {
      if (mode.lockedFace) this.set({ mode: { ...mode, lockedFace: null } });
      return;
    }
    if (mode.lockedFace) return;
    const h = this.state.hover;
    const inst = h && this.state.doc.assembly?.instances.find((i) => i.id === h.partId);
    const face = inst && h.kind === 'face' ? this.state.display[inst.partId]?.mesh?.faces[h.index] : undefined;
    if (!h || !face?.plane) return this.explain('Survolez d’abord une face plane, puis maintenez Maj pour viser un de ses sommets.');
    this.set({ mode: { ...mode, lockedFace: { instanceId: h.partId, index: h.index } } });
  }

  /**
   * Vue éclatée : écarte les pièces de l'assemblage pour voir comment elles s'emboîtent (affichage
   * seulement, le projet ne change pas). La main et la création de liaison sont alors coupées.
   */
  setExplode(value: number): void {
    const explode = Math.max(0, Math.min(2, value));
    if (explode > 0 && this.state.mode.kind === 'joint') this.set({ mode: model });
    // Entrée et sortie de la vue éclatée : la vue recadre l'ensemble.
    const toggled = explode > 0 !== this.state.explode > 0;
    this.set({ explode, ...(explode > 0 ? { assemblyHand: false } : {}), ...(toggled ? { fitRequest: this.state.fitRequest + 1 } : {}) });
  }

  /** Outil Main : attraper les pièces de l'assemblage à la souris (ou seulement tourner la vue). */
  toggleAssemblyHand(on?: boolean): void {
    const hand = on ?? !this.state.assemblyHand;
    if (hand && this.state.explode > 0) this.set({ explode: 0 });
    if (hand && this.state.mode.kind === 'joint') this.set({ mode: model });
    this.set({ assemblyHand: hand });
  }

  /**
   * Boucles fermées : reporte dans le document les réglages que le solveur a dû changer pour que
   * chaque boucle se referme (la liaison `driver`, celle que l'on manipule, garde sa valeur).
   * Sans ce report, la position affichée et les réglages enregistrés divergeraient.
   */
  private settleLoops(doc: CadDocument, driver?: Id): CadDocument {
    if (!doc.assembly?.joints.length) return doc;
    const placement = solveAssembly(doc.assembly, (partId) => this.state.display[partId]?.mesh, { ...this.solveOptions(), subassemblyOf: (id) => subassemblyContent(doc, id), ...(driver ? { driver } : {}) });
    let out = doc;
    for (const [id, v] of placement.solvedValues) {
      out = updateJoint(out, id, (j) => ({ ...j, angle: v.angle, offset: v.offset, ...(j.kind === 'spherical' ? { tilt: v.tilt, tiltDirection: v.tiltDirection } : {}) }));
    }
    return out;
  }

  // ----- Animation d'un mécanisme

  /** Animation en cours : la liaison qui mène, le document de départ (rétabli à l'arrêt). */
  private animation: { jointId: Id; start: CadDocument; param: 'angle' | 'offset'; dir: 1 | -1; last: number; frame: number; origin: number } | null = null;

  /**
   * Fait tourner (ou glisser) une liaison en continu ; les pièces qui en dépendent suivent, y compris
   * dans une boucle fermée. Entre des limites, ou quand la boucle ne peut pas aller plus loin
   * (balancier), le mouvement repart dans l'autre sens. Un second appel arrête et revient au départ.
   */
  toggleJointAnimation(jointId: Id): void {
    if (this.animation) return this.stopJointAnimation();
    const joint = this.state.doc.assembly?.joints.find((j) => j.id === jointId);
    if (!joint) return;
    const free = jointFreedoms(joint.kind);
    const param = free.angle && joint.kind !== 'spherical' ? 'angle' : free.offset ? 'offset' : null;
    if (!param) return this.explain('Cette liaison ne permet ni de tourner ni de glisser : rien à animer.');
    if (this.assemblyPlacement()?.issues.get(jointId)) return this.explain('Corrigez d’abord le souci de cette liaison.');
    this.animation = { jointId, start: this.state.doc, param, dir: 1, last: performance.now(), frame: 0, origin: joint[param] };
    this.animation.frame = requestAnimationFrame(this.animationStep);
    this.set({ jointAnimation: jointId });
  }

  /** Arrête l'animation ; `restore` revient à la position de départ (sinon on garde la position atteinte). */
  stopJointAnimation(restore = true): void {
    const a = this.animation;
    if (!a) return;
    cancelAnimationFrame(a.frame);
    this.animation = null;
    this.set({ jointAnimation: null, ...(restore ? { doc: a.start } : {}) });
  }

  private animationStep = (now: number): void => {
    const a = this.animation;
    if (!a) return;
    const dt = Math.min(0.1, (now - a.last) / 1000);
    a.last = now;
    const assembly = this.state.doc.assembly;
    const joint = assembly?.joints.find((j) => j.id === a.jointId);
    if (!assembly || !joint) return this.stopJointAnimation(false);
    // 90 °/s pour tourner, 15 mm/s pour glisser.
    const speed = a.param === 'angle' ? 90 : 15;
    const limits = a.param === 'angle' ? joint.angleLimits : joint.offsetLimits;
    const range = limits ? [Math.min(...limits), Math.max(...limits)] : a.param === 'offset' ? [a.origin - 20, a.origin + 20] : null;
    let value = joint[a.param] + a.dir * speed * dt;
    if (range) {
      if (value >= range[1]!) {
        value = range[1]!;
        a.dir = -1;
      } else if (value <= range[0]!) {
        value = range[0]!;
        a.dir = 1;
      }
    } else if (value > 180) value -= 360;
    else if (value < -180) value += 360;
    const moved = updateJoint(this.state.doc, joint.id, (j) => ({ ...j, [a.param]: value }));
    const placement = solveAssembly(moved.assembly!, (partId) => this.state.display[partId]?.mesh, { ...this.solveOptions(), driver: joint.id });
    if ([...placement.issues.values()].includes('LOOP_UNSOLVED')) {
      // La boucle ne peut pas aller plus loin (position extrême d'un balancier) : demi-tour.
      a.dir = a.dir > 0 ? -1 : 1;
    } else {
      let doc = moved;
      for (const [id, v] of placement.solvedValues) {
        doc = updateJoint(doc, id, (j) => ({ ...j, angle: v.angle, offset: v.offset, ...(j.kind === 'spherical' ? { tilt: v.tilt, tiltDirection: v.tiltDirection } : {}) }));
      }
      this.set({ doc });
    }
    a.frame = requestAnimationFrame(this.animationStep);
  };

  /** Change une liaison (type, retournement, limites…) : une action annulable. */
  setJoint(jointId: Id, patch: Partial<AssemblyJoint>, label = 'Modifier une liaison'): void {
    this.commit(this.settleLoops(updateJoint(this.state.doc, jointId, (j) => ({ ...j, ...patch })), jointId), label);
  }

  /** Bloc souple (ou rigide à nouveau) : ses liaisons internes deviennent réglables à cette insertion. */
  setBlockFlexible(instanceId: Id, on: boolean): void {
    this.commit(
      updateInstance(this.state.doc, instanceId, (i) => {
        if (on) return { ...i, flexible: true };
        const { flexible: _f, jointValues: _v, ...rest } = i;
        return rest;
      }),
      on ? 'Rendre un bloc souple' : 'Rendre un bloc rigide',
    );
  }

  /** Réglage d'une liaison interne d'un bloc souple, à cette insertion ; `live` : pendant un glisser. */
  setBlockJoint(instanceId: Id, jointId: Id, patch: Partial<{ angle: number; offset: number }>, live = false): void {
    const inst = this.state.doc.assembly?.instances.find((i) => i.id === instanceId);
    const joint = inst?.subassemblyId ? subassemblyContent(this.state.doc, inst.subassemblyId)?.joints.find((j) => j.id === jointId) : undefined;
    if (!inst || !joint) return;
    const current = inst.jointValues?.[jointId] ?? { angle: joint.angle, offset: joint.offset };
    const doc = updateInstance(this.state.doc, instanceId, (i) => ({ ...i, flexible: true, jointValues: { ...i.jointValues, [jointId]: { ...current, ...patch } } }));
    if (live) {
      if (!this.liveStart) this.liveStart = this.state.doc;
      this.set({ doc });
    } else this.commit(doc, `Régler « ${joint.name} » dans « ${inst.name} »`);
  }

  /** Réglage en continu (curseur, glisser) : le modèle suit sans remplir l'historique. */
  setJointLive(jointId: Id, patch: Partial<Pick<AssemblyJoint, 'angle' | 'offset' | 'tilt' | 'tiltDirection'>>): void {
    if (!this.liveStart) this.liveStart = this.state.doc;
    this.set({ doc: this.settleLoops(updateJoint(this.state.doc, jointId, (j) => ({ ...j, ...patch })), jointId) });
  }

  /** Fin d'un réglage en continu : une seule action dans l'historique. */
  commitLive(label: string): void {
    const start = this.liveStart;
    this.liveStart = null;
    if (!start || start === this.state.doc) return;
    const s = this.state;
    this.set({ history: recordAction(s.history, start, label), revision: s.revision + 1 });
    this.autosave?.schedule(this.state.doc, this.state.project.savedAt);
    if (this.state.collisionCheck) void this.refreshCollisions();
  }

  // ----- Engrenages et crémaillères entre liaisons

  /**
   * Couple deux liaisons : la première pivot mène, la suivante (pivot : engrenage ; glissière :
   * crémaillère) suit. Le calage est pris pour que rien ne bouge à la création.
   */
  addCoupling(): void {
    const assembly = this.state.doc.assembly;
    const joints = assembly?.joints ?? [];
    const driver = joints.find((j) => j.kind === 'revolute' || j.kind === 'cylindrical');
    const driven = joints.find((j) => j !== driver && j.kind !== 'fixed' && j.kind !== 'spherical');
    if (!assembly || !driver || !driven) return this.explain('Il faut deux liaisons, dont un pivot, pour faire un engrenage : créez-les d’abord.');
    const kind = driven.kind === 'slider' ? 'rack' : 'gear';
    const count = (assembly.couplings ?? []).filter((c) => c.kind === kind).length + 1;
    const base = { name: `${kind === 'rack' ? 'Crémaillère' : 'Engrenage'} ${count}`, kind, driver: driver.id, driven: driven.id, teeth: [20, 20] as [number, number], pitchDiameter: 20, reversed: false, phase: 0 } as const;
    const phase = couplingPhase(assembly, { ...base, id: '' });
    const { doc, couplingId } = addCoupling(this.state.doc, { ...base, phase });
    this.commit(this.settleLoops(doc), 'Ajouter un engrenage', { assemblySelection: { kind: 'coupling', id: couplingId } });
  }

  /**
   * Change un couplage. Changer les liaisons, le rapport ou le sens recale la menée là où elle est
   * (rien ne saute) ; seul le calage (`phase`) la fait tourner ou glisser.
   */
  updateCoupling(id: Id, patch: Partial<JointCoupling>): void {
    const assembly = this.state.doc.assembly;
    const old = assembly?.couplings?.find((c) => c.id === id);
    if (!assembly || !old) return;
    let next = { ...old, ...patch };
    if (patch.driven !== undefined && patch.kind === undefined) {
      const driven = assembly.joints.find((j) => j.id === patch.driven);
      if (driven) next.kind = driven.kind === 'slider' ? 'rack' : 'gear';
    }
    if (patch.phase === undefined) next = { ...next, phase: couplingPhase(assembly, next) };
    this.commit(this.settleLoops(updateCoupling(this.state.doc, id, () => next)), 'Modifier un engrenage');
  }

  removeCoupling(id: Id): void {
    this.commit(removeCoupling(this.state.doc, id), 'Supprimer un engrenage', { assemblySelection: null });
  }

  removeJoint(jointId: Id): void {
    this.commit(removeJoint(this.state.doc, jointId), 'Supprimer une liaison', { assemblySelection: null });
  }

  /** Glisser une pièce : elle ne suit que le mouvement permis par sa liaison. */
  assemblyDrag(event: AssemblyDragEvent): void {
    const s = this.state;
    if (event.phase === 'start') {
      const joint = s.doc.assembly?.joints.find((j) => j.moving.instanceId === event.key.split('/')[0]);
      const frames = joint && this.assemblyPlacement()?.jointFrames.get(joint.id);
      if (!joint || !frames) return;
      const free = jointFreedoms(joint.kind);
      if (free.tilt && event.point) {
        // Rotule : le point attrapé suit la souris sur une sphère centrée sur la rotule.
        const center = frames.base.origin;
        const g = sub3(event.point, center);
        const radius = Math.max(Math.hypot(g.x, g.y, g.z), 5);
        this.drag = {
          jointId: joint.id,
          rotate: false,
          origin: center,
          axis: frames.base.normal,
          startAngle: joint.angle,
          startOffset: joint.offset,
          ref: null,
          s0: 0,
          lastDelta: 0,
          ball: { center, grab: g, radius, axis0: frames.moving.normal, flip: joint.flip, base: { x: frames.base.xAxis, y: frames.base.yAxis, z: frames.base.normal } },
        };
        this.set({ assemblySelection: { kind: 'joint', id: joint.id } });
        return;
      }
      const rotate = free.angle && (!free.offset || !event.shift);
      const origin = frames.base.origin;
      const axis = frames.base.normal;
      const p = rotate ? rayPlane(event.ray, origin, axis) : null;
      const s0 = rotate ? 0 : rayAxisParam(event.ray, origin, axis);
      this.drag = { jointId: joint.id, rotate, origin, axis, startAngle: joint.angle, startOffset: joint.offset, ref: p ? sub3(p, origin) : null, s0: s0 ?? 0, lastDelta: 0 };
      this.set({ assemblySelection: { kind: 'joint', id: joint.id } });
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    const joint = s.doc.assembly?.joints.find((j) => j.id === drag.jointId);
    if (!joint) return;
    if (event.phase === 'move') {
      if (drag.ball) {
        const b = drag.ball;
        const target = raySphere(event.ray, b.center, b.radius);
        const u0 = normalize3(b.grab);
        const u1 = normalize3(sub3(target, b.center));
        // Rotation qui amène le point attrapé sous la souris, appliquée à l'axe de la pièce.
        const a1 = rotateAlong(b.axis0, u0, u1);
        // Axe de la pièce → inclinaison et direction dans le repère de référence (voir jointMatrix).
        const s1 = b.flip ? a1 : scale3(a1, -1);
        const bz = Math.max(-1, Math.min(1, dot3(s1, b.base.z)));
        let tilt = (Math.acos(bz) * 180) / Math.PI;
        tilt = Math.min(tilt, joint.tiltLimit ?? 180);
        const dir = tilt < 1e-6 ? (joint.tiltDirection ?? 0) : (Math.atan2(dot3(s1, b.base.y), dot3(s1, b.base.x)) * 180) / Math.PI;
        this.setJointLive(joint.id, { tilt: Math.round(tilt * 10) / 10, tiltDirection: Math.round(dir * 10) / 10 });
        return;
      }
      if (drag.rotate) {
        const p = rayPlane(event.ray, drag.origin, drag.axis);
        if (!p || !drag.ref) return;
        const v = sub3(p, drag.origin);
        let delta = (Math.atan2(dot3(cross3(drag.ref, v), drag.axis), dot3(drag.ref, v)) * 180) / Math.PI;
        // Rotation continue au-delà d'un demi-tour.
        while (delta - drag.lastDelta > 180) delta -= 360;
        while (delta - drag.lastDelta < -180) delta += 360;
        drag.lastDelta = delta;
        const angle = Math.round(clampToLimits(drag.startAngle + delta, joint.angleLimits) * 10) / 10;
        this.setJointLive(joint.id, { angle });
      } else {
        const t = rayAxisParam(event.ray, drag.origin, drag.axis);
        if (t === null) return;
        const offset = Math.round(clampToLimits(drag.startOffset + (t - drag.s0), joint.offsetLimits) * 100) / 100;
        this.setJointLive(joint.id, { offset });
      }
      return;
    }
    this.drag = null;
    const inst = s.doc.assembly?.instances.find((i) => i.id === joint.moving.instanceId);
    this.commitLive(`Déplacer « ${inst?.name ?? 'la pièce'} »`);
  }

  // =========================================================================
  // Chat assistant

  /** Change l'affichage du chat ; masqué / réduit sont retenus sur cet appareil. */
  setMascot(patch: Partial<AppState['mascot']>): void {
    const mascot = { ...this.state.mascot, ...patch };
    this.set({ mascot });
    if ('hidden' in patch || 'collapsed' in patch) {
      void this.deps.projects?.setSetting('mascot', { hidden: mascot.hidden, collapsed: mascot.collapsed }).catch(() => undefined);
    }
    if (patch.hidden === true) this.toast('info', 'Java, le chat, est masqué. Pour le faire revenir : Aide → « Afficher le chat ».');
  }

  /** Action proposée par un conseil du chat (toujours déclenchée par un clic de l'utilisateur). */
  runAdviceAction(action: AdviceAction): void {
    switch (action.kind) {
      case 'edit-feature':
        return this.editFeature(action.featureId);
      case 'repair-support':
        return this.repairSketch(action.featureId);
      case 'start-sketch':
        return this.startSketch();
      case 'rollback-end':
        return this.rollbackToEnd(action.partId);
      case 'update-app':
        return applyUpdate();
    }
  }

  /** Ouvre le panneau des parcours guidés (sans `id` : choix du parcours). */
  startTutorial(id: TutorialId | null = null): void {
    this.set({ tutorial: { id, step: 0 }, helpOpen: false });
  }

  setTutorialStep(step: number): void {
    const t = this.state.tutorial;
    if (t) this.set({ tutorial: { ...t, step } });
  }

  closeTutorial(): void {
    this.set({ tutorial: null });
  }

  explain(text: string): void {
    this.toast('info', text);
  }

  toast(kind: Toast['kind'], text: string, opts: { detail?: string; actionLabel?: string; action?: () => void } = {}): void {
    const id = this.toastId++;
    const toast: Toast = { id, kind, text, ...opts };
    this.set({ toasts: [...this.state.toasts.filter((t) => t.text !== text), toast].slice(-4) });
    setTimeout(() => this.dismissToast(id), kind === 'error' ? 12000 : opts.action ? 9000 : 6500);
  }

  dismissToast(id: number): void {
    if (this.state.toasts.some((t) => t.id === id)) this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }
}

/** Point d'une sphère visé par un rayon (le plus proche de l'observateur), ou le point de la sphère le plus proche du rayon. */
function raySphere(ray: { origin: Vec3; direction: Vec3 }, center: Vec3, radius: number): Vec3 {
  const d = normalize3(ray.direction);
  const oc = sub3(ray.origin, center);
  const b = dot3(oc, d);
  const c = dot3(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc >= 0) {
    const t = -b - Math.sqrt(disc);
    return { x: ray.origin.x + d.x * t, y: ray.origin.y + d.y * t, z: ray.origin.z + d.z * t };
  }
  const t = -b;
  const closest = { x: ray.origin.x + d.x * t, y: ray.origin.y + d.y * t, z: ray.origin.z + d.z * t };
  const v = normalize3(sub3(closest, center));
  return { x: center.x + v.x * radius, y: center.y + v.y * radius, z: center.z + v.z * radius };
}

/** Vecteur `v` tourné de la rotation qui amène la direction `from` sur `to` (Rodrigues). */
function rotateAlong(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const k = cross3(from, to);
  const sin = Math.hypot(k.x, k.y, k.z);
  const cos = dot3(from, to);
  if (sin < 1e-9) return v;
  const axis = scale3(k, 1 / sin);
  const kv = cross3(axis, v);
  const kd = dot3(axis, v);
  return {
    x: v.x * cos + kv.x * sin + axis.x * kd * (1 - cos),
    y: v.y * cos + kv.y * sin + axis.y * kd * (1 - cos),
    z: v.z * cos + kv.z * sin + axis.z * kd * (1 - cos),
  };
}

/** Face d'un maillage la plus proche d'un point (distance aux triangles). */
function nearestFace(mesh: { positions: Float32Array; indices: Uint32Array; faces: { start: number; count: number }[] }, p: Vec3): number {
  let best = -1;
  let bestD = Infinity;
  const v = (i: number): Vec3 => ({ x: mesh.positions[i * 3]!, y: mesh.positions[i * 3 + 1]!, z: mesh.positions[i * 3 + 2]! });
  mesh.faces.forEach((f, fi) => {
    for (let k = f.start; k < f.start + f.count; k += 3) {
      const d = pointTriangleDistance(p, v(mesh.indices[k]!), v(mesh.indices[k + 1]!), v(mesh.indices[k + 2]!));
      if (d < bestD) {
        bestD = d;
        best = fi;
      }
    }
  });
  return best;
}

/** Distance d'un point à un triangle (projection sur le plan, sinon aux côtés). */
function pointTriangleDistance(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ab = sub3(b, a);
  const ac = sub3(c, a);
  const n = cross3(ab, ac);
  const len = Math.hypot(n.x, n.y, n.z);
  if (len > 1e-12) {
    const nn = scale3(n, 1 / len);
    const d = dot3(sub3(p, a), nn);
    const q = sub3(p, scale3(nn, d));
    const inside = [
      [a, b],
      [b, c],
      [c, a],
    ].every(([u, w]) => dot3(cross3(sub3(w!, u!), sub3(q, u!)), nn) >= -1e-9);
    if (inside) return Math.abs(d);
  }
  const seg = (u: Vec3, w: Vec3) => {
    const uw = sub3(w, u);
    const t = Math.max(0, Math.min(1, dot3(sub3(p, u), uw) / Math.max(dot3(uw, uw), 1e-18)));
    const q = { x: u.x + uw.x * t, y: u.y + uw.y * t, z: u.z + uw.z * t };
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
}

/** Vrai si la pièce `a` reprend (directement ou par d'autres pièces) la pièce `b`. */
export function partDependsOn(doc: CadDocument, a: Id, b: Id): boolean {
  const seen = new Set<Id>();
  const stack = [a];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === b) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const f of findPart(doc, id)?.features ?? []) stack.push(...externalParts(f));
  }
  return false;
}
