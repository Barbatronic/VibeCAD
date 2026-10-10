/**
 * Service géométrique : exécute les requêtes du protocole avec un noyau et un moteur.
 * Utilisé dans le worker (navigateur) et directement dans les tests (Node).
 */
import type { CadDocument, Id } from '../domain/model';
import { DISPLAY_MESH, EXPORT_MESH } from '../domain/tolerances';
import { RecomputeEngine, type PartEvaluation } from '../features/engine';
import type { ResourceData } from '../features/evaluation';
import type { BoundingBox, GeometryKernel, KernelShape, MeshOptions } from '../geometry/kernel';
import { stepProductNames } from '../io/resources';
import { meshesToBinaryStl } from '../io/stl';
import { meshesTo3mf } from '../io/threemf';
import { APP_NAME, APP_VERSION } from '../meta';
import type {
  ExportPlacement,
  DocumentForWorker,
  EvaluationResult,
  MeasureResult,
  PartResult,
  PickRef,
  SketchResult,
  StepInspection,
  WorkerResourcePayload,
} from '../geometry/protocol';

export function meshOptionsFor(bbox: BoundingBox | null, quality: typeof DISPLAY_MESH | typeof EXPORT_MESH): MeshOptions {
  const diag = bbox ? Math.hypot(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z) : 100;
  const raw = diag * quality.relativeDeflection;
  // Arrondi pour stabiliser les clés de cache malgré de petites variations de taille.
  const linear = Number(Math.min(quality.maxDeflection, Math.max(quality.minDeflection, raw)).toPrecision(2));
  return { linearDeflection: linear, angularDeflection: quality.angularDeflection };
}

export class GeometryService {
  private readonly resources = new Map<Id, ResourceData>();
  readonly engine: RecomputeEngine;

  constructor(readonly kernel: GeometryKernel) {
    this.engine = new RecomputeEngine(kernel, { get: (id) => this.resources.get(id) });
  }

  addResources(payload: WorkerResourcePayload[]): number {
    for (const r of payload) this.resources.set(r.id, { sha256: r.sha256, fileName: r.fileName, bytes: r.bytes });
    return this.resources.size;
  }

  private asDocument(doc: DocumentForWorker): CadDocument {
    return doc as unknown as CadDocument;
  }

  evaluate(docIn: DocumentForWorker, knownMeshKeys: string[] = [], previewFeatureId?: Id): EvaluationResult {
    const t0 = performance.now();
    const doc = this.asDocument(docIn);
    const known = new Set(knownMeshKeys);
    const evaluations = this.engine.evaluateDocument(doc);
    const parts = evaluations.map((ev) => this.partResult(ev, known, previewFeatureId));
    return { parts, durationMs: performance.now() - t0, memoryBytes: this.kernel.memoryBytes() };
  }

  private partResult(ev: PartEvaluation, known: Set<string>, previewFeatureId?: Id): PartResult {
    let meshKey: string | null = null;
    let mesh = null;
    if (ev.shape && ev.shapeKey) {
      const options = meshOptionsFor(ev.analysis?.bbox ?? null, DISPLAY_MESH);
      meshKey = `${ev.shapeKey}|${options.linearDeflection}`;
      if (!known.has(meshKey)) mesh = this.engine.meshOf(ev, options);
    }
    const sketches: SketchResult[] = ev.sketches.map((s) => ({
      featureId: s.featureId,
      frame: s.frame,
      solved: s.solved,
      converged: s.converged,
      dof: s.dof,
      freeEntities: s.freeEntities,
      unsatisfied: s.unsatisfied,
      profile: s.profile.ok
        ? { ok: true, regionCount: s.profile.regions.length, area: s.profile.regions.reduce((a, r) => a + r.area, 0) }
        : { ok: false, code: s.profile.code, points: s.profile.points, positions: s.profile.positions },
    }));
    const result: PartResult = {
      partId: ev.partId,
      statuses: ev.statuses,
      sketches,
      meshKey,
      mesh,
      analysis: ev.analysis,
      failedFeatureId: ev.failedFeatureId,
    };
    if (previewFeatureId) {
      const tool = ev.tools.get(previewFeatureId);
      const stepKey = ev.stepKeys.get(previewFeatureId);
      if (tool && stepKey) {
        const options = meshOptionsFor(ev.analysis?.bbox ?? null, DISPLAY_MESH);
        result.previewTool = {
          featureId: previewFeatureId,
          mesh: this.engine.meshFor(`tool|${stepKey}|${options.linearDeflection}`, tool, options),
        };
      }
    }
    return result;
  }

  private partsToExport(docIn: DocumentForWorker, partIds: Id[]) {
    const doc = this.asDocument(docIn);
    const evaluations = this.engine.evaluateDocument(doc);
    const warnings: string[] = [];
    const items = [];
    for (const id of partIds) {
      const part = doc.parts.find((p) => p.id === id);
      const ev = evaluations.find((e) => e.partId === id);
      if (!part || !ev) continue;
      if (!ev.shape) {
        warnings.push(`La pièce « ${part.name} » n’a pas encore de volume : elle n’est pas exportée.`);
        continue;
      }
      if (ev.failedFeatureId) {
        const failed = part.features.find((f) => f.id === ev.failedFeatureId);
        warnings.push(
          `La pièce « ${part.name} » contient une erreur à l’étape « ${failed?.name ?? '?'} » : le volume exporté est celui obtenu juste avant cette étape.`,
        );
      }
      items.push({ part, ev, shape: ev.shape });
    }
    return { items, warnings };
  }

  /**
   * Formes à exporter : les pièces telles quelles, ou (assemblage) une copie placée de chaque
   * pièce insérée. Les copies placées sont à libérer par l'appelant (`placed`).
   */
  private exportShapes(doc: DocumentForWorker, partIds: Id[], placements: ExportPlacement[] | undefined) {
    const ids = placements ? Array.from(new Set(placements.map((p) => p.partId))) : partIds;
    const { items, warnings } = this.partsToExport(doc, ids);
    if (items.length === 0) throw new Error(warnings[0] ?? 'Aucune pièce à exporter.');
    if (!placements) return { warnings, placed: [] as KernelShape[], shapes: items.map((i) => ({ name: i.part.name, color: i.part.color, shape: i.shape, ev: i.ev })) };
    const placed: KernelShape[] = [];
    const shapes = placements.flatMap((pl) => {
      const item = items.find((i) => i.part.id === pl.partId);
      if (!item) return [];
      const shape = this.kernel.transformed(item.shape, pl.matrix);
      placed.push(shape);
      return [{ name: pl.name, color: item.part.color, shape, ev: item.ev }];
    });
    return { warnings, placed, shapes };
  }

  exportStep(doc: DocumentForWorker, partIds: Id[], placements?: ExportPlacement[]): { text: string; warnings: string[] } {
    const { shapes, warnings, placed } = this.exportShapes(doc, partIds, placements);
    try {
      const text = this.kernel.exportStep(shapes.map((i) => ({ name: i.name, color: i.color, shape: i.shape })));
      return { text, warnings };
    } finally {
      for (const p of placed) this.kernel.dispose(p);
    }
  }

  exportStl(doc: DocumentForWorker, partIds: Id[]): { bytes: Uint8Array; warnings: string[] } {
    const { items, warnings } = this.partsToExport(doc, partIds);
    if (items.length === 0) throw new Error(warnings[0] ?? 'Aucune pièce à exporter.');
    const meshes = items.map((i) => this.kernel.mesh(i.shape, meshOptionsFor(i.ev.analysis?.bbox ?? null, EXPORT_MESH)));
    const name = items.length === 1 ? items[0]!.part.name : this.asDocument(doc).name;
    return { bytes: meshesToBinaryStl(meshes, name.normalize('NFD').replace(/[^\x20-\x7e]/g, '')), warnings };
  }

  async export3mf(doc: DocumentForWorker, partIds: Id[], placements?: ExportPlacement[]): Promise<{ bytes: Uint8Array; warnings: string[] }> {
    const { shapes, warnings, placed } = this.exportShapes(doc, partIds, placements);
    try {
      const meshes = shapes.map((i) => ({
        name: i.name,
        color: i.color,
        mesh: this.kernel.mesh(i.shape, meshOptionsFor(i.ev.analysis?.bbox ?? null, EXPORT_MESH)),
      }));
      const bytes = await meshesTo3mf(meshes, { title: this.asDocument(doc).name, application: `${APP_NAME} ${APP_VERSION}` });
      return { bytes, warnings };
    } finally {
      for (const p of placed) this.kernel.dispose(p);
    }
  }

  inspectStep(bytes: Uint8Array): StepInspection {
    const read = this.kernel.readStep(bytes);
    try {
      return {
        solids: read.solids.map((s) => {
          const a = this.kernel.analyze(s);
          return { volume: a.volume, bbox: a.bbox, valid: a.valid };
        }),
        productNames: stepProductNames(bytes),
      };
    } finally {
      read.solids.forEach((s) => this.kernel.dispose(s));
    }
  }

  measure(docIn: DocumentForWorker, a: PickRef, b: PickRef): MeasureResult {
    const evaluations = this.engine.evaluateDocument(this.asDocument(docIn));
    const shapeOf = (ref: PickRef) => {
      const s = evaluations.find((e) => e.partId === ref.partId)?.shape;
      if (!s) throw new Error('La pièce sélectionnée n’a pas de volume.');
      return s;
    };
    return this.kernel.distance({ shape: shapeOf(a), kind: a.kind, index: a.index }, { shape: shapeOf(b), kind: b.kind, index: b.index });
  }
}
