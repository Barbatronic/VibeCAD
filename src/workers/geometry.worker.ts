/**
 * Worker de calcul géométrique : initialise le noyau Open CASCADE (WASM) et traite les requêtes
 * une par une. Le fichier WASM est un fichier local de l'application (aucun CDN).
 */
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { KernelError } from '../geometry/kernel';
import { loadOpenCascade } from '../geometry/occt/loader';
import { OcctKernel } from '../geometry/occt/occt-kernel';
import type { WorkerRequest, WorkerResponse } from '../geometry/protocol';
import { GeometryService } from './geometry-service';
import { cacheStats, clearCache, getSnapshots, putSnapshots } from './shape-cache';

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

let service: Promise<GeometryService> | null = null;
let initMs = 0;

function getService(): Promise<GeometryService> {
  service ??= (async () => {
    const t0 = performance.now();
    const oc = await loadOpenCascade({ wasmUrl });
    initMs = performance.now() - t0;
    return new GeometryService(new OcctKernel(oc));
  })();
  return service;
}

async function handle(req: WorkerRequest): Promise<unknown> {
  const svc = await getService();
  switch (req.type) {
    case 'init':
      return { memoryBytes: svc.kernel.memoryBytes(), initMs };
    case 'resources':
      return { count: svc.addResources(req.resources) };
    case 'evaluate': {
      // Cache des formes : les pièces déjà calculées (même historique) sont reprises sans rejouer leurs étapes.
      svc.preloadSnapshots(await getSnapshots(svc.snapshotKeys(req.doc)));
      // Avancement envoyé au plus toutes les 100 ms : le fil principal n'est pas inondé.
      let last = 0;
      const progress = (fraction: number) => {
        const now = performance.now();
        if (now - last < 100) return;
        last = now;
        scope.postMessage({ id: req.id, progress: fraction });
      };
      return svc.evaluate(req.doc, req.knownMeshKeys, req.previewFeatureId, progress);
    }
    case 'exportStep':
      return svc.exportStep(req.doc, req.partIds, req.placements, req.tree);
    case 'exportStl':
      return svc.exportStl(req.doc, req.partIds);
    case 'export3mf':
      return svc.export3mf(req.doc, req.partIds, req.placements);
    case 'exportFreecad':
      return svc.exportFreecad(req.doc, req.partIds, req.leaves);
    case 'inspectStep':
      return svc.inspectStep(req.bytes, req.format ?? 'step');
    case 'measure':
      return svc.measure(req.doc, req.a, req.b);
    case 'section':
      return svc.section(req.doc, req.section);
    case 'hiddenLines':
      return svc.hiddenLines(req.doc, req.partId, req.views);
    case 'collisions':
      return svc.collisions(req.doc, req.placements);
    case 'shapeCache':
      if (req.clear) await clearCache();
      return cacheStats();
  }
}

// Les requêtes sont traitées dans l'ordre d'arrivée.
let queue: Promise<void> = Promise.resolve();

/**
 * Enregistrement des nouveaux instantanés dans le cache des formes : quand le calcul est au repos
 * depuis un moment (pas pendant une saisie qui enchaîne les recalculs), dans la file des requêtes.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSnapshotSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    queue = queue.then(async () => {
      const svc = await getService();
      await putSnapshots(svc.takeSnapshots()).catch(() => undefined);
    });
  }, 1500);
}

scope.addEventListener('message', (event) => {
  const req = event.data;
  if (saveTimer && req.type === 'evaluate') {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  queue = queue.then(async () => {
    try {
      const result = await handle(req);
      scope.postMessage({ id: req.id, ok: true, result });
      if (req.type === 'evaluate' && !req.previewFeatureId) scheduleSnapshotSave();
    } catch (err) {
      const message =
        err instanceof KernelError || err instanceof Error ? err.message : 'Le calcul géométrique a échoué.';
      const detail = err instanceof KernelError ? err.detail : err instanceof Error ? err.stack : String(err);
      scope.postMessage({ id: req.id, ok: false, error: { message, ...(detail ? { detail } : {}) } });
    }
  });
});
