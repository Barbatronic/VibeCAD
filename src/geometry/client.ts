/**
 * Client du worker de calcul (fil principal). Les calculs lourds s'exécutent dans le worker ;
 * l'interface reste interactive. Les demandes de recalcul suivent la règle « le dernier gagne » :
 * une demande remplacée avant son envoi est résolue avec `null` et son résultat n'est jamais
 * appliqué. Les maillages déjà reçus ne sont pas renvoyés par le worker.
 */
import type { CadDocument, Id } from '../domain/model';
import { resourceBytes } from '../io/resources';
import type { MeshData } from './kernel';
import type { Vec3 } from '../math/vec';
import {
  documentForWorker,
  type EvaluationResult,
  type PickRef,
  type WorkerRequest,
  type WorkerResponse,
  type ExportPlacement,
  type StepTree,
  type WorkerResultMap,
  type SectionPlane,
  type CollisionPlacement,
} from './protocol';

type RequestType = WorkerRequest['type'];
type RequestBody<T extends RequestType> = Omit<Extract<WorkerRequest, { type: T }>, 'id'>;

interface QueuedEvaluation {
  doc: CadDocument;
  previewFeatureId: Id | undefined;
  resolve: (result: EvaluationResult | null) => void;
  reject: (err: Error) => void;
}

export class GeometryWorkerError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'GeometryWorkerError';
  }
}

const MESH_CACHE_LIMIT = 40;

export class GeometryClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly sentResources = new Set<string>();
  private readonly meshes = new Map<string, MeshData>();
  private running = false;
  /** Recalcul du document validé (prioritaire) et aperçu d'une opération en cours. */
  private queuedCommit: QueuedEvaluation | null = null;
  private queuedPreview: QueuedEvaluation | null = null;
  private crashed: Error | null = null;
  readonly ready: Promise<WorkerResultMap['init']>;

  constructor(createWorker: () => Worker) {
    this.worker = createWorker();
    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => this.onMessage(event.data));
    this.worker.addEventListener('error', (event) => {
      event.preventDefault?.();
      this.crashed = new GeometryWorkerError(
        'Le moteur de calcul géométrique ne répond plus. Enregistrez votre travail puis rechargez la page.',
        event.message,
      );
      for (const p of this.pending.values()) p.reject(this.crashed);
      this.pending.clear();
    });
    this.ready = this.request('init', {});
  }

  private onMessage(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new GeometryWorkerError(msg.error.message, msg.error.detail));
  }

  private request<T extends RequestType>(type: T, body: Omit<RequestBody<T>, 'type'>, transfer: Transferable[] = []): Promise<WorkerResultMap[T]> {
    if (this.crashed) return Promise.reject(this.crashed);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...body, type, id }, transfer);
    });
  }

  private async syncResources(doc: CadDocument): Promise<void> {
    const missing = Object.values(doc.resources).filter((r) => !this.sentResources.has(`${r.id}:${r.sha256}`));
    if (missing.length === 0) return;
    await this.request('resources', {
      resources: missing.map((r) => ({ id: r.id, sha256: r.sha256, fileName: r.fileName, bytes: resourceBytes(r), kind: r.kind })),
    });
    for (const r of missing) this.sentResources.add(`${r.id}:${r.sha256}`);
  }

  /**
   * Recalcule le document. Avec `previewFeatureId`, il s'agit d'un aperçu : il ne remplace
   * jamais un recalcul validé en attente, et il est lui-même remplacé par l'aperçu suivant.
   */
  evaluate(doc: CadDocument, previewFeatureId?: Id): Promise<EvaluationResult | null> {
    return new Promise((resolve, reject) => {
      const job = { doc, previewFeatureId, resolve, reject };
      if (previewFeatureId) {
        this.queuedPreview?.resolve(null);
        this.queuedPreview = job;
      } else {
        this.queuedCommit?.resolve(null);
        this.queuedCommit = job;
      }
      void this.pump();
    });
  }

  /** Vrai si un recalcul est en cours ou en attente. */
  get busy(): boolean {
    return this.running || this.queuedCommit !== null || this.queuedPreview !== null;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const job = this.queuedCommit ?? this.queuedPreview;
    if (!job) return;
    if (job === this.queuedCommit) this.queuedCommit = null;
    else this.queuedPreview = null;
    this.running = true;
    try {
      await this.syncResources(job.doc);
      const result = await this.request('evaluate', {
        doc: documentForWorker(job.doc),
        knownMeshKeys: Array.from(this.meshes.keys()),
        ...(job.previewFeatureId ? { previewFeatureId: job.previewFeatureId } : {}),
      });
      for (const part of result.parts) {
        if (!part.meshKey) continue;
        if (part.mesh) this.rememberMesh(part.meshKey, part.mesh);
        else part.mesh = this.meshes.get(part.meshKey) ?? null;
      }
      job.resolve(result);
    } catch (err) {
      job.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.running = false;
      void this.pump();
    }
  }

  private rememberMesh(key: string, mesh: MeshData): void {
    this.meshes.delete(key);
    this.meshes.set(key, mesh);
    while (this.meshes.size > MESH_CACHE_LIMIT) {
      const oldest = this.meshes.keys().next().value;
      if (oldest === undefined) break;
      this.meshes.delete(oldest);
    }
  }

  async exportStep(doc: CadDocument, partIds: Id[], placements?: ExportPlacement[], tree?: StepTree): Promise<WorkerResultMap['exportStep']> {
    await this.syncResources(doc);
    return this.request('exportStep', { doc: documentForWorker(doc), partIds, ...(placements ? { placements } : {}), ...(tree ? { tree } : {}) });
  }

  async exportStl(doc: CadDocument, partIds: Id[]): Promise<WorkerResultMap['exportStl']> {
    await this.syncResources(doc);
    return this.request('exportStl', { doc: documentForWorker(doc), partIds });
  }

  async export3mf(doc: CadDocument, partIds: Id[], placements?: ExportPlacement[]): Promise<WorkerResultMap['export3mf']> {
    await this.syncResources(doc);
    return this.request('export3mf', { doc: documentForWorker(doc), partIds, ...(placements ? { placements } : {}) });
  }

  inspectStep(bytes: Uint8Array, format: 'step' | 'stl' = 'step'): Promise<WorkerResultMap['inspectStep']> {
    return this.request('inspectStep', { bytes, format });
  }

  async measure(doc: CadDocument, a: PickRef, b: PickRef): Promise<WorkerResultMap['measure']> {
    await this.syncResources(doc);
    return this.request('measure', { doc: documentForWorker(doc), a, b });
  }

  async section(doc: CadDocument, section: SectionPlane): Promise<WorkerResultMap['section']> {
    await this.syncResources(doc);
    return this.request('section', { doc: documentForWorker(doc), section });
  }

  /** Traits vus et cachés exacts des vues d'une pièce (mise en plan). */
  async hiddenLines(doc: CadDocument, partId: Id, views: { u: Vec3; toViewer: Vec3 }[]): Promise<WorkerResultMap['hiddenLines']> {
    await this.syncResources(doc);
    return this.request('hiddenLines', { doc: documentForWorker(doc), partId, views });
  }

  async collisions(doc: CadDocument, placements: CollisionPlacement[]): Promise<WorkerResultMap['collisions']> {
    await this.syncResources(doc);
    return this.request('collisions', { doc: documentForWorker(doc), placements });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
