/**
 * Service géométrique : exécute les requêtes du protocole avec un noyau et un moteur.
 * Utilisé dans le worker (navigateur) et directement dans les tests (Node).
 */
import type { Collision, CollisionPlacement, SectionPart, SectionPlane } from '../geometry/protocol';
import type { CadDocument, Id } from '../domain/model';
import type { Vec3 } from '../math/vec';
import { DISPLAY_MESH, EXPORT_MESH } from '../domain/tolerances';
import { RecomputeEngine, type PartEvaluation } from '../features/engine';
import type { ResourceData } from '../features/evaluation';
import type { BoundingBox, GeometryKernel, KernelShape, MeshData, MeshOptions } from '../geometry/kernel';
import { stepProductNames } from '../io/resources';
import { meshesToBinaryStl, STL_MAX_TRIANGLES, stlTriangleCount } from '../io/stl';
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
    for (const r of payload) this.resources.set(r.id, { sha256: r.sha256, fileName: r.fileName, bytes: r.bytes, ...(r.kind ? { kind: r.kind } : {}) });
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

  inspectStep(bytes: Uint8Array, format: 'step' | 'stl' = 'step'): StepInspection {
    if (format === 'stl') {
      const triangles = stlTriangleCount(bytes);
      if (triangles > STL_MAX_TRIANGLES) {
        throw new Error(`Ce fichier STL est trop détaillé (${triangles.toLocaleString('fr-FR')} triangles, ${STL_MAX_TRIANGLES.toLocaleString('fr-FR')} au plus) : simplifiez-le dans un autre logiciel avant de l’importer.`);
      }
      const read = this.kernel.readStl(bytes);
      try {
        return {
          solids: read.solids.map((s) => {
            const a = this.kernel.analyze(s);
            return { volume: a.volume, bbox: a.bbox, valid: a.valid };
          }),
          productNames: [],
          triangles,
        };
      } finally {
        read.solids.forEach((s) => this.kernel.dispose(s));
      }
    }
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

  /**
   * Vue en coupe (affichage seulement) : chaque pièce est coupée par un plan d'origine décalé ;
   * la moitié du côté positif est retirée (l'autre avec `flip`). Les faces de coupe viennent de la
   * boîte retirée, étiquetée `__section__`.
   */
  section(docIn: DocumentForWorker, section: SectionPlane): { parts: SectionPart[] } {
    const evaluations = this.engine.evaluateDocument(this.asDocument(docIn));
    const axis = section.plane === 'XY' ? 'z' : section.plane === 'XZ' ? 'y' : 'x';
    const parts: SectionPart[] = [];
    for (const ev of evaluations) {
      const bbox = ev.analysis?.bbox;
      if (!ev.shape || !bbox) continue;
      const lo = bbox.min[axis];
      const hi = bbox.max[axis];
      const keepBelow = !section.flip;
      // Plan hors de la pièce : tout est gardé, ou rien.
      if ((keepBelow && section.offset >= hi) || (!keepBelow && section.offset <= lo)) {
        const mesh = this.engine.meshOf(ev, meshOptionsFor(bbox, DISPLAY_MESH));
        parts.push({ partId: ev.partId, mesh, cutFaces: [] });
        continue;
      }
      if ((keepBelow && section.offset <= lo) || (!keepBelow && section.offset >= hi)) {
        parts.push({ partId: ev.partId, mesh: null, cutFaces: [] });
        continue;
      }
      const m = 1 + Math.max(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z);
      const min = { x: bbox.min.x - m, y: bbox.min.y - m, z: bbox.min.z - m };
      const max = { x: bbox.max.x + m, y: bbox.max.y + m, z: bbox.max.z + m };
      if (keepBelow) min[axis] = section.offset;
      else max[axis] = section.offset;
      const box = this.kernel.makePrimitive({
        featureId: '__section__',
        shape: 'box',
        position: min,
        width: max.x - min.x,
        depth: max.y - min.y,
        height: max.z - min.z,
        diameter: 1,
        thickness: 1,
      });
      let cut: KernelShape | null = null;
      try {
        cut = this.kernel.cut(ev.shape, box);
        const mesh = this.kernel.mesh(cut, meshOptionsFor(bbox, DISPLAY_MESH));
        const cutFaces = mesh.faces.flatMap((f, i) => (f.tags.some((t) => t.featureId === '__section__') ? [i] : []));
        parts.push({ partId: ev.partId, mesh, cutFaces });
      } finally {
        this.kernel.dispose(box);
        if (cut) this.kernel.dispose(cut);
      }
    }
    return { parts };
  }

  /**
   * Collisions d'un assemblage : pour chaque paire de pièces placées dont les boîtes se
   * chevauchent, la partie commune ; au-delà d'un volume négligeable (un simple contact donne un
   * volume nul), la paire est signalée avec le maillage de la partie commune.
   */
  /** Mise en plan exacte : traits vus et cachés de chaque vue d'une pièce (algorithme HLR). */
  hiddenLines(docIn: DocumentForWorker, partId: Id, views: { u: Vec3; toViewer: Vec3 }[]): { views: { a: { x: number; y: number }; b: { x: number; y: number }; hidden: boolean }[][] } {
    const ev = this.engine.evaluateDocument(this.asDocument(docIn)).find((e) => e.partId === partId);
    if (!ev?.shape) return { views: [] };
    return { views: this.kernel.hiddenLineViews(ev.shape, views) };
  }

  /**
   * Résultats des paires déjà comparées : clé = formes des deux pièces et leurs placements. Quand
   * une seule pièce bouge, seules ses paires sont recalculées (les autres viennent d'ici).
   */
  private readonly collisionCache = new Map<string, { volume: number; mesh: MeshData } | null>();

  collisions(docIn: DocumentForWorker, placements: CollisionPlacement[]): { collisions: Collision[] } {
    const evaluations = this.engine.evaluateDocument(this.asDocument(docIn));
    const placed: { pl: CollisionPlacement; ev: PartEvaluation; bbox: BoundingBox | null; key: string; shape: KernelShape | null }[] = [];
    for (const pl of placements) {
      const ev = evaluations.find((e) => e.partId === pl.partId);
      if (!ev?.shape) continue;
      // Boîte de la pièce placée : celle de la pièce, transformée (sans recalcul).
      const bbox = ev.analysis?.bbox ? transformBox(ev.analysis.bbox, pl.matrix) : null;
      const key = `${ev.shapeKey ?? ev.partId}@${pl.matrix.map((v) => Math.round(v * 1e6) / 1e6).join(',')}`;
      placed.push({ pl, ev, bbox, key, shape: null });
    }
    const shapeOf = (p: (typeof placed)[number]) => (p.shape ??= this.kernel.transformed(p.ev.shape!, p.pl.matrix));
    const overlap = (a: BoundingBox | null, b: BoundingBox | null) =>
      !!a && !!b && a.min.x < b.max.x && b.min.x < a.max.x && a.min.y < b.max.y && b.min.y < a.max.y && a.min.z < b.max.z && b.min.z < a.max.z;
    const collisions: Collision[] = [];
    const used = new Set<string>();
    try {
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const p = placed[i]!;
          const q = placed[j]!;
          if (!overlap(p.bbox, q.bbox)) continue;
          const pairKey = `${p.key}|${q.key}`;
          used.add(pairKey);
          let hit = this.collisionCache.get(pairKey);
          if (hit === undefined) {
            const common = this.kernel.common(shapeOf(p), shapeOf(q));
            try {
              const v = this.kernel.volumeOf(common);
              // Tolérance : un contact (goupille ajustée dans son trou) donne un volume quasi nul.
              hit = v.solidCount > 0 && v.volume > 1e-3 ? { volume: v.volume, mesh: this.kernel.mesh(common, meshOptionsFor(p.bbox, DISPLAY_MESH)) } : null;
            } finally {
              this.kernel.dispose(common);
            }
            this.collisionCache.set(pairKey, hit);
          }
          if (hit) collisions.push({ a: p.pl.instanceId, b: q.pl.instanceId, volume: hit.volume, mesh: hit.mesh });
        }
      }
    } finally {
      for (const p of placed) if (p.shape) this.kernel.dispose(p.shape);
    }
    // Paires qui n'existent plus (pièce modifiée ou déplacée) : oubliées.
    for (const k of this.collisionCache.keys()) if (!used.has(k)) this.collisionCache.delete(k);
    return { collisions };
  }
}

/** Boîte englobante d'une boîte transformée (ses huit coins). */
function transformBox(b: BoundingBox, m: readonly number[]): BoundingBox {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const x of [b.min.x, b.max.x])
    for (const y of [b.min.y, b.max.y])
      for (const z of [b.min.z, b.max.z]) {
        const p = { x: m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, y: m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, z: m[2]! * x + m[6]! * y + m[10]! * z + m[14]! };
        for (const k of ['x', 'y', 'z'] as const) {
          min[k] = Math.min(min[k], p[k]);
          max[k] = Math.max(max[k], p[k]);
        }
      }
  return { min, max };
}
