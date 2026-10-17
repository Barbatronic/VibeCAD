/**
 * Worker de simulation : le calcul de déformation (ou l'optimisation topologique) peut durer
 * plusieurs secondes ; il tourne à part pour que l'interface et le worker géométrique restent
 * disponibles.
 */
import { runStudy, StudyError } from '../sim/study';
import { runTopology } from '../sim/topology';
import type { SimRequest, SimResponse } from '../sim/runner';

interface WorkerScope {
  postMessage(message: SimResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SimRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  const req = event.data;
  const { id } = req;
  let last = 0;
  const progress = (f: number) => {
    if (f - last < 0.02 && f < 1) return;
    last = f;
    scope.postMessage({ id, kind: 'progress', progress: f });
  };
  try {
    if (req.kind === 'topology') {
      const result = runTopology(req.input, progress);
      scope.postMessage({ id, kind: 'done', result }, [result.density.buffer, result.passive.buffer, result.fixedNodes.buffer]);
      return;
    }
    const result = runStudy(req.input, progress);
    scope.postMessage({ id, kind: 'done', result }, [result.positions.buffer, result.indices.buffer, result.displacement.buffer, result.stress.buffer]);
  } catch (err) {
    scope.postMessage({ id, kind: 'error', code: err instanceof StudyError ? err.code : null, message: err instanceof Error ? err.message : String(err) });
  }
});
