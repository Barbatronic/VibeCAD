/**
 * Worker de simulation : le calcul de déformation peut durer plusieurs secondes ; il tourne à part
 * pour que l'interface et le worker géométrique restent disponibles.
 */
import { runStudy, StudyError } from '../sim/study';
import type { SimRequest, SimResponse } from '../sim/runner';

interface WorkerScope {
  postMessage(message: SimResponse, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<SimRequest>) => void): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  const { id, input } = event.data;
  try {
    let last = 0;
    const result = runStudy(input, (progress) => {
      if (progress - last < 0.02) return;
      last = progress;
      scope.postMessage({ id, kind: 'progress', progress });
    });
    scope.postMessage({ id, kind: 'done', result }, [result.positions.buffer, result.indices.buffer, result.displacement.buffer, result.stress.buffer]);
  } catch (err) {
    scope.postMessage({ id, kind: 'error', code: err instanceof StudyError ? err.code : null, message: err instanceof Error ? err.message : String(err) });
  }
});
