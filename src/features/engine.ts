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
import { hashString, stableStringify } from '../domain/hash';
import type { CadDocument, Feature, Id, Part } from '../domain/model';
import { issue, type FeatureStatus } from '../domain/status';
import { KernelError, type GeometryKernel, type KernelShape, type MeshData, type MeshOptions, type ShapeAnalysis } from '../geometry/kernel';
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
}

/** Nombre de recalculs pendant lesquels une étape inutilisée reste en cache (annuler/rétablir rapides). */
const RETAIN_GENERATIONS = 4;

interface WalkState {
  shape: KernelShape | null;
  analysis: ShapeAnalysis | null;
  failure: Id | null;
  sketches: ReadonlyMap<Id, EvaluatedSketch>;
  tools: ReadonlyMap<Id, { shape: KernelShape; mode: 'add' | 'cut' }>;
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
    const results = doc.parts.map((part) => this.walkPart(part, gen));
    this.evict(gen);
    return results;
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

  private walkPart(part: Part, gen: number): PartEvaluation {
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
    const tools = new Map<Id, KernelShape>();
    const toolModes = new Map<Id, { shape: KernelShape; mode: 'add' | 'cut' }>();
    const stepKeys = new Map<Id, string>();

    for (const feature of part.features) {
      const key = this.stepKey(prevKey, feature);
      stepKeys.set(feature.id, key);
      let record = this.records.get(key);
      if (!record) {
        record = this.computeStep(feature, key, { ...state, sketches: sketchMap, tools: toolModes });
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
      if (outcome.tool) tools.set(feature.id, outcome.tool);
      // Seul un volume réellement appliqué (étape sans erreur) peut être répété.
      if (outcome.tool && outcome.toolMode && outcome.status.state !== 'error' && outcome.status.state !== 'blocked') {
        toolModes.set(feature.id, { shape: outcome.tool, mode: outcome.toolMode });
      }
      if (outcome.shape) {
        state.shape = outcome.shape;
        state.analysis = outcome.analysis ?? null;
        shapeKey = key;
      }
      if (!state.failure && record.failureAfter) failedFeatureId = feature.id;
      state.failure = record.failureAfter;
    }
    return { partId: part.id, statuses, sketches, shape: state.shape, shapeKey, analysis: state.analysis, failedFeatureId, tools, stepKeys };
  }

  private computeStep(feature: Feature, key: string, state: WalkState): StepRecord {
    const def = definitionOf(feature);
    const needsSolid = def.affectsSolid || (feature.type === 'sketch' && feature.params.support.kind === 'face');
    if (state.failure && needsSolid) {
      return {
        key,
        outcome: { status: issue(feature.id, 'blocked', 'BLOCKED_BY_PREVIOUS', { blockedBy: state.failure }) },
        failureAfter: state.failure,
        lastUsed: 0,
      };
    }
    const ctx: EvaluationContext = {
      kernel: this.kernel,
      shape: state.shape,
      shapeAnalysis: state.analysis,
      sketches: state.sketches,
      tools: state.tools,
      readStepSolids: (resourceId) => this.readStepSolids(resourceId),
    };
    let outcome: FeatureOutcome;
    try {
      outcome = evaluatorOf(feature)(feature, ctx);
    } catch (err) {
      const detail = err instanceof KernelError ? [err.message, err.detail].filter(Boolean).join(' — ') : String(err);
      outcome = { status: issue(feature.id, 'error', 'KERNEL_FAILURE', { detail }) };
    }
    const broken = def.affectsSolid && (outcome.status.state === 'error' || outcome.status.state === 'blocked');
    if (broken && outcome.shape) {
      if (outcome.shape !== outcome.tool) this.kernel.dispose(outcome.shape);
      delete outcome.shape;
      delete outcome.analysis;
    }
    const failureAfter = state.failure ?? (broken ? (outcome.status.blockedBy ?? feature.id) : null);
    return { key, outcome, failureAfter, lastUsed: 0 };
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
