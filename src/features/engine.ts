/**
 * Moteur de recalcul de l'historique paramétrique.
 *
 * Chaque pièce est évaluée fonction par fonction, dans l'ordre. Chaque étape reçoit une clé
 * calculée à partir de la clé précédente et de ses paramètres : une étape inchangée dont tout
 * l'amont est inchangé est reprise du cache. Le cache ne fait jamais autorité — il peut être
 * vidé à tout moment, le résultat recalculé est identique.
 *
 * Erreurs : une fonction en échec qui modifie le solide bloque les fonctions suivantes qui
 * dépendent du solide (statut `blocked`, avec l'étape en cause). Les esquisses sur un plan
 * d'origine restent évaluées et modifiables. Le dernier solide valide reste disponible.
 */
import { unfoldCut, type SheetState } from './sheet/fold';
import { externalParts } from './sketch/definition';
import { hashString, stableStringify } from '../domain/hash';
import type { CadDocument, Feature, Id, Part } from '../domain/model';
import { issue, type FeatureStatus } from '../domain/status';
import { KernelError, type GeometryKernel, type KernelShape, type MeshData, type MeshOptions, type ShapeAnalysis } from '../geometry/kernel';
import type { Frame3D } from '../math/frame';
import type { Vec3 } from '../math/vec';
import type { EvaluatedSketch, EvaluationContext, FeatureOutcome, ResourceProvider, SketchEvaluation } from './evaluation';
import { evaluatorOf } from './evaluators';
import { definitionOf } from './registry';

interface StepRecord {
  key: string;
  outcome: FeatureOutcome;
  /** Cause d'échec de la chaîne du solide après cette étape (null si la chaîne est saine). */
  failureAfter: Id | null;
  lastUsed: number;
}

type StepFileEntry =
  | { solids: KernelShape[]; lastUsed: number }
  | { error: 'IMPORT_FAILED'; detail?: string; lastUsed: number };

export interface PartEvaluation {
  partId: Id;
  /** Un statut par fonction, dans l'ordre de l'historique. */
  statuses: FeatureStatus[];
  sketches: SketchEvaluation[];
  /** Plans de construction calculés, dans l'ordre de l'historique. */
  datums: { featureId: Id; frame: Frame3D }[];
  /** Axes de construction calculés, dans l'ordre de l'historique. */
  axes: { featureId: Id; point: Vec3; dir: Vec3 }[];
  /** Dernier solide valide de la pièce (null si aucun volume). */
  shape: KernelShape | null;
  /** Clé de l'étape qui a produit ce solide (sert de clé de cache au maillage). */
  shapeKey: string | null;
  analysis: ShapeAnalysis | null;
  /** Première étape dont l'échec interrompt la chaîne du solide. */
  failedFeatureId: Id | null;
  /** Corps outils par fonction volumique (aperçus). */
  tools: Map<Id, KernelShape>;
  /** Clé de cache de chaque étape (stable tant que l'étape et son amont sont inchangés). */
  stepKeys: Map<Id, string>;
  /** Tôle (pièce de tôlerie) : plat et plis à la fin de l'historique ; null sinon. */
  sheet: SheetState | null;
  /** Images de référence : repère de leur support. */
  images: { featureId: Id; frame: Frame3D }[];
}

/** Nombre de recalculs pendant lesquels une étape inutilisée reste en cache (annuler/rétablir rapides). */
const RETAIN_GENERATIONS = 4;

interface WalkState {
  shape: KernelShape | null;
  analysis: ShapeAnalysis | null;
  failure: Id | null;
  sketches: ReadonlyMap<Id, EvaluatedSketch>;
  datums: ReadonlyMap<Id, Frame3D>;
  axes: ReadonlyMap<Id, { point: Vec3; dir: Vec3 }>;
  tools: ReadonlyMap<Id, { shape: KernelShape; mode: 'add' | 'cut' }>;
  sheet: SheetState | null;
  /** Formes finales des pièces déjà calculées (références entre pièces). */
  finals: ReadonlyMap<Id, { shape: KernelShape; key: string }>;
}

export class RecomputeEngine {
  private readonly records = new Map<string, StepRecord>();
  private readonly stepFiles = new Map<string, StepFileEntry>();
  private readonly meshes = new Map<string, { mesh: MeshData; lastUsed: number }>();
  private generation = 0;

  constructor(
    readonly kernel: GeometryKernel,
    private readonly resources: ResourceProvider,
  ) {}

  /** Recalcule toutes les pièces du document. Les résultats restent valides jusqu'au prochain appel. */
  evaluateDocument(doc: CadDocument): PartEvaluation[] {
    const gen = ++this.generation;
    // Une pièce qui reprend une face ou des arêtes d'une autre est calculée après elle.
    const { order, cyclic } = partOrder(doc);
    const finals = new Map<Id, { shape: KernelShape; key: string }>();
    const byId = new Map<Id, PartEvaluation>();
    for (const part of order) {
      const ev = this.walkPart(part, gen, finals, cyclic);
      byId.set(part.id, ev);
      if (ev.shape && ev.shapeKey) finals.set(part.id, { shape: ev.shape, key: ev.shapeKey });
    }
    this.evict(gen);
    return doc.parts.map((p) => byId.get(p.id)!);
  }

  /** Maillage d'affichage du solide d'une pièce, mis en cache par clé d'étape et qualité. */
  meshOf(evaluation: PartEvaluation, options: MeshOptions): MeshData | null {
    if (!evaluation.shape || !evaluation.shapeKey) return null;
    return this.meshFor(`${evaluation.shapeKey}|${options.linearDeflection}|${options.angularDeflection}`, evaluation.shape, options);
  }

  meshFor(cacheKey: string, shape: KernelShape, options: MeshOptions): MeshData {
    let entry = this.meshes.get(cacheKey);
    if (!entry) {
      entry = { mesh: this.kernel.mesh(shape, options), lastUsed: this.generation };
      this.meshes.set(cacheKey, entry);
    }
    entry.lastUsed = this.generation;
    return entry.mesh;
  }

  /**
   * Solide de la pièce juste après une étape (ou avant toute étape si `featureId` est null), tel
   * que calculé lors du dernier `evaluateDocument` ; null s'il n'y a pas encore de volume.
   */
  shapeAfter(part: Part, evaluation: PartEvaluation, featureId: Id | null): KernelShape | null {
    let shape: KernelShape | null = null;
    if (featureId === null) return null;
    for (const f of part.features) {
      const key = evaluation.stepKeys.get(f.id);
      const outcome = key ? this.records.get(key)?.outcome : undefined;
      if (outcome?.shape) shape = outcome.shape;
      if (f.id === featureId) return shape;
    }
    return shape;
  }

  /** Nombre d'étapes en cache (diagnostic et tests). */
  cacheSize(): number {
    return this.records.size;
  }

  /** Libère tous les objets du noyau détenus par le moteur. */
  clear(): void {
    for (const rec of this.records.values()) this.disposeOutcome(rec.outcome);
    this.records.clear();
    for (const entry of this.stepFiles.values()) if ('solids' in entry) entry.solids.forEach((s) => this.kernel.dispose(s));
    this.stepFiles.clear();
    this.meshes.clear();
  }

  private stepKey(prevKey: string, feature: Feature): string {
    const extra = feature.type === 'imported-solid' ? (this.resources.get(feature.params.resourceId)?.sha256 ?? 'absent') : '';
    return hashString(`${prevKey}|${stableStringify({ id: feature.id, type: feature.type, params: feature.params })}|${extra}`);
  }

  private walkPart(part: Part, gen: number, finals: ReadonlyMap<Id, { shape: KernelShape; key: string }> = new Map(), cyclic: ReadonlySet<Id> = new Set()): PartEvaluation {
    let prevKey = hashString(`part:${part.id}`);
    const state: { shape: KernelShape | null; analysis: ShapeAnalysis | null; failure: Id | null } = {
      shape: null,
      analysis: null,
      failure: null,
    };
    let shapeKey: string | null = null;
    let failedFeatureId: Id | null = null;
    const statuses: FeatureStatus[] = [];
    const sketches: SketchEvaluation[] = [];
    const sketchMap = new Map<Id, EvaluatedSketch>();
    const datumMap = new Map<Id, Frame3D>();
    const datums: { featureId: Id; frame: Frame3D }[] = [];
    const axisMap = new Map<Id, { point: Vec3; dir: Vec3 }>();
    const axes: { featureId: Id; point: Vec3; dir: Vec3 }[] = [];
    const tools = new Map<Id, KernelShape>();
    const toolModes = new Map<Id, { shape: KernelShape; mode: 'add' | 'cut' }>();
    const stepKeys = new Map<Id, string>();
    let sheet: SheetState | null = null;
    const images: { featureId: Id; frame: Frame3D }[] = [];

    for (const feature of part.features) {
      // Références vers d'autres pièces : la clé de l'étape suit leur forme finale.
      const external = externalParts(feature);
      const extKey = external.map((id) => `${id}=${finals.get(id)?.key ?? '-'}`).join(',');
      const key = extKey ? hashString(`${this.stepKey(prevKey, feature)}|ext:${extKey}`) : this.stepKey(prevKey, feature);
      stepKeys.set(feature.id, key);
      let record = this.records.get(key);
      if (!record && cyclic.has(part.id) && external.some((id) => cyclic.has(id))) {
        record = { key, outcome: { status: issue(feature.id, 'error', 'PART_CYCLE') }, failureAfter: state.failure, lastUsed: 0 };
        this.records.set(key, record);
      }
      if (!record) {
        record = this.computeStep(feature, key, { ...state, sketches: sketchMap, datums: datumMap, axes: axisMap, tools: toolModes, sheet, finals });
        this.records.set(key, record);
      }
      record.lastUsed = gen;
      if (feature.type === 'imported-solid') this.touchStepFile(feature.params.resourceId, gen);
      prevKey = key;

      const { outcome } = record;
      statuses.push(outcome.status);
      if (outcome.sketch) {
        sketches.push(outcome.sketch);
        sketchMap.set(feature.id, { evaluation: outcome.sketch, status: outcome.status });
      }
      if (outcome.datum) {
        datumMap.set(feature.id, outcome.datum);
        datums.push({ featureId: feature.id, frame: outcome.datum });
      }
      if (outcome.datumAxis) {
        axisMap.set(feature.id, outcome.datumAxis);
        axes.push({ featureId: feature.id, ...outcome.datumAxis });
      }
      if (outcome.tool) tools.set(feature.id, outcome.tool);
      // Seul un volume réellement appliqué (étape sans erreur) peut être répété.
      if (outcome.tool && outcome.toolMode && outcome.status.state !== 'error' && outcome.status.state !== 'blocked') {
        toolModes.set(feature.id, { shape: outcome.tool, mode: outcome.toolMode });
      }
      if (outcome.imageFrame) images.push({ featureId: feature.id, frame: outcome.imageFrame });
      // Tôle après l'étape (voir `sheetAfter`).
      if (outcome.sheet) sheet = outcome.sheet;
      if (outcome.shape) {
        state.shape = outcome.shape;
        state.analysis = outcome.analysis ?? null;
        shapeKey = key;
      }
      if (!state.failure && record.failureAfter) failedFeatureId = feature.id;
      state.failure = record.failureAfter;
    }
    return { partId: part.id, statuses, sketches, datums, axes, shape: state.shape, shapeKey, analysis: state.analysis, failedFeatureId, tools, stepKeys, sheet, images };
  }

  private computeStep(feature: Feature, key: string, state: WalkState): StepRecord {
    const def = definitionOf(feature);
    const needsSolid =
      def.affectsSolid ||
      (feature.type === 'sketch' && feature.params.support.kind === 'face') ||
      (feature.type === 'plane' && (feature.params.base.kind === 'face' || (feature.params.angle !== 0 && feature.params.hinge.kind === 'edge'))) ||
      (feature.type === 'axis' && feature.params.kind === 'edge');
    if (state.failure && needsSolid) {
      return {
        key,
        outcome: { status: issue(feature.id, 'blocked', 'BLOCKED_BY_PREVIOUS', { blockedBy: state.failure }) },
        failureAfter: state.failure,
        lastUsed: 0,
      };
    }
    const placed: KernelShape[] = [];
    const ctx: EvaluationContext = {
      kernel: this.kernel,
      shape: state.shape,
      shapeAnalysis: state.analysis,
      sketches: state.sketches,
      datums: state.datums,
      axes: state.axes,
      tools: state.tools,
      sheet: state.sheet,
      externalShape: (partId, matrix) => {
        const shape = state.finals.get(partId)?.shape ?? null;
        if (!shape || !matrix) return shape;
        // Autre pièce placée comme dans l'assemblage : copie déplacée, libérée après l'étape.
        const moved = this.kernel.transformed(shape, matrix, { keep: true });
        placed.push(moved);
        return moved;
      },
      readStepSolids: (resourceId) => this.readStepSolids(resourceId),
    };
    let outcome: FeatureOutcome;
    try {
      outcome = evaluatorOf(feature)(feature, ctx);
    } catch (err) {
      const detail = err instanceof KernelError ? [err.message, err.detail].filter(Boolean).join(' — ') : String(err);
      outcome = { status: issue(feature.id, 'error', 'KERNEL_FAILURE', { detail }) };
    }
    for (const shape of placed) if (shape !== outcome.shape && shape !== outcome.tool) this.kernel.dispose(shape);
    if (state.sheet && !outcome.sheet) this.sheetAfter(feature, state.sheet, outcome, state.shape);
    const broken = def.affectsSolid && (outcome.status.state === 'error' || outcome.status.state === 'blocked');
    if (broken && outcome.shape) {
      if (outcome.shape !== outcome.tool) this.kernel.dispose(outcome.shape);
      delete outcome.shape;
      delete outcome.analysis;
    }
    const failureAfter = state.failure ?? (broken ? (outcome.status.blockedBy ?? feature.id) : null);
    return { key, outcome, failureAfter, lastUsed: 0 };
  }

  /**
   * Tôle après une étape qui n'est pas de la tôlerie : sans pli, la pièce est encore à plat et
   * devient le nouveau plat. Après un pli, la matière que l'étape a retirée (poche, perçage, congé,
   * chanfrein, découpe…) — la pièce d'avant moins celle d'après — est reportée sur le plat
   * (`unfoldCut`) ; de la matière ajoutée n'est pas dans le développé (signalée aux plis suivants).
   */
  private sheetAfter(feature: Feature, sheet: SheetState, outcome: FeatureOutcome, before: KernelShape | null): void {
    const applied = !!outcome.shape && outcome.status.state !== 'error' && outcome.status.state !== 'blocked';
    if (!applied || !definitionOf(feature).affectsSolid) return;
    if (sheet.folds.length === 0) {
      outcome.sheet = { ...sheet, flat: outcome.shape! };
      return;
    }
    if (!before) {
      outcome.sheet = { ...sheet, later: [...sheet.later, feature.id] };
      return;
    }
    const k = this.kernel;
    const tiny = 1e-6 * Math.max(1, sheet.thickness ** 3);
    let removed: KernelShape | null = null;
    let added: KernelShape | null = null;
    try {
      removed = k.cut(before, outcome.shape!);
      added = k.cut(outcome.shape!, before);
      const grew = k.volumeOf(added).volume > tiny;
      if (k.volumeOf(removed).volume > tiny) {
        const r = unfoldCut(k, sheet, removed);
        outcome.sheet = { ...sheet, flat: r.flat, ...(grew ? { later: [...sheet.later, feature.id] } : {}) };
        outcome.owned = [...(outcome.owned ?? []), r.flat];
        if (r.touchesBend && outcome.status.state === 'ok') outcome.status = issue(feature.id, 'warning', 'SHEET_CUT_ON_BEND');
      } else if (grew) outcome.sheet = { ...sheet, later: [...sheet.later, feature.id] };
    } catch {
      // Report impossible : l'étape reste hors du développé.
      outcome.sheet = { ...sheet, later: [...sheet.later, feature.id] };
    } finally {
      if (removed) k.dispose(removed);
      if (added) k.dispose(added);
    }
  }

  private readStepSolids(resourceId: Id): ReturnType<EvaluationContext['readStepSolids']> {
    const res = this.resources.get(resourceId);
    if (!res) return { error: 'RESOURCE_MISSING' };
    let entry = this.stepFiles.get(res.sha256);
    if (!entry) {
      try {
        entry = { solids: (res.kind === 'stl' ? this.kernel.readStl(res.bytes) : this.kernel.readStep(res.bytes)).solids, lastUsed: this.generation };
      } catch (err) {
        const detail = err instanceof KernelError ? [err.message, err.detail].filter(Boolean).join(' — ') : String(err);
        entry = { error: 'IMPORT_FAILED', detail, lastUsed: this.generation };
      }
      this.stepFiles.set(res.sha256, entry);
    }
    entry.lastUsed = this.generation;
    return 'solids' in entry ? { solids: entry.solids } : { error: entry.error, ...(entry.detail ? { detail: entry.detail } : {}) };
  }

  private touchStepFile(resourceId: Id, gen: number): void {
    const res = this.resources.get(resourceId);
    const entry = res ? this.stepFiles.get(res.sha256) : undefined;
    if (entry) entry.lastUsed = gen;
  }

  private disposeOutcome(outcome: FeatureOutcome): void {
    const owned = new Set<KernelShape>();
    if (outcome.shape) owned.add(outcome.shape);
    if (outcome.tool) owned.add(outcome.tool);
    for (const s of outcome.owned ?? []) owned.add(s);
    for (const s of owned) this.kernel.dispose(s);
  }

  private evict(gen: number): void {
    const limit = gen - RETAIN_GENERATIONS;
    for (const [key, rec] of this.records) {
      if (rec.lastUsed <= limit) {
        this.disposeOutcome(rec.outcome);
        this.records.delete(key);
      }
    }
    for (const [sha, entry] of this.stepFiles) {
      if (entry.lastUsed <= limit) {
        if ('solids' in entry) entry.solids.forEach((s) => this.kernel.dispose(s));
        this.stepFiles.delete(sha);
      }
    }
    for (const [key, m] of this.meshes) if (m.lastUsed <= limit) this.meshes.delete(key);
  }
}

/**
 * Ordre de calcul des pièces : une pièce qui reprend une face ou des arêtes d'une autre vient
 * après elle (tri topologique, ordre du projet sinon). Les pièces prises dans une boucle de
 * références (A reprend B qui reprend A) sont calculées à la fin, leurs références en erreur.
 */
export function partOrder(doc: CadDocument): { order: Part[]; cyclic: Set<Id> } {
  const ids = new Set(doc.parts.map((p) => p.id));
  const deps = new Map(doc.parts.map((p) => [p.id, new Set(p.features.flatMap((f) => externalParts(f)).filter((id) => ids.has(id) && id !== p.id))]));
  const order: Part[] = [];
  const done = new Set<Id>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const p of doc.parts) {
      if (done.has(p.id) || [...deps.get(p.id)!].some((d) => !done.has(d))) continue;
      order.push(p);
      done.add(p.id);
      progress = true;
    }
  }
  const cyclic = new Set(doc.parts.filter((p) => !done.has(p.id)).map((p) => p.id));
  for (const p of doc.parts) if (cyclic.has(p.id)) order.push(p);
  return { order, cyclic };
}
