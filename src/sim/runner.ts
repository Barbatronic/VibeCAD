/**
 * Lancement d'une étude dans le worker de simulation (fil principal). Un seul calcul à la fois
 * (étude de déformation ou optimisation topologique) : en lancer un autre, ou annuler, arrête le
 * worker (le calcul en cours est abandonné).
 */
import { runStudy, StudyError, type StudyErrorCode, type StudyInput, type StudyOutput } from './study';
import { runTopology, type TopologyInput, type TopologyOutput } from './topology';

export type SimRequest = { id: number; kind: 'study'; input: StudyInput } | { id: number; kind: 'topology'; input: TopologyInput };

export type SimResponse =
  | { id: number; kind: 'progress'; progress: number }
  | { id: number; kind: 'done'; result: StudyOutput | TopologyOutput }
  | { id: number; kind: 'error'; code: StudyErrorCode | null; message: string };

export interface SimRunner {
  run(input: StudyInput, onProgress: (f: number) => void): Promise<StudyOutput>;
  /** Optimisation topologique : où garder la matière. */
  optimize(input: TopologyInput, onProgress: (f: number) => void): Promise<TopologyOutput>;
  cancel(): void;
}

export class AbortedStudy extends Error {
  constructor() {
    super('Calcul annulé.');
    this.name = 'AbortedStudy';
  }
}

export class WorkerSimRunner implements SimRunner {
  private worker: Worker | null = null;
  private nextId = 1;
  private current: { id: number; reject: (e: Error) => void } | null = null;

  constructor(private readonly createWorker: () => Worker) {}

  run(input: StudyInput, onProgress: (f: number) => void): Promise<StudyOutput> {
    return this.request({ kind: 'study', input }, onProgress) as Promise<StudyOutput>;
  }

  optimize(input: TopologyInput, onProgress: (f: number) => void): Promise<TopologyOutput> {
    return this.request({ kind: 'topology', input }, onProgress) as Promise<TopologyOutput>;
  }

  private request(req: { kind: 'study'; input: StudyInput } | { kind: 'topology'; input: TopologyInput }, onProgress: (f: number) => void): Promise<StudyOutput | TopologyOutput> {
    this.cancel();
    const worker = (this.worker ??= this.createWorker());
    const id = this.nextId++;
    return new Promise<StudyOutput | TopologyOutput>((resolve, reject) => {
      this.current = { id, reject };
      const onMessage = (event: MessageEvent<SimResponse>) => {
        const msg = event.data;
        if (msg.id !== id) return;
        if (msg.kind === 'progress') return onProgress(msg.progress);
        worker.removeEventListener('message', onMessage);
        this.current = null;
        if (msg.kind === 'done') resolve(msg.result);
        else reject(msg.code ? new StudyError(msg.code) : new Error(msg.message));
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ id, ...req } as SimRequest);
    });
  }

  cancel(): void {
    if (!this.current) return;
    this.current.reject(new AbortedStudy());
    this.current = null;
    this.worker?.terminate();
    this.worker = null;
  }
}

/** Sans worker (tests) : calcul sur le fil principal. */
export const inlineSimRunner: SimRunner = {
  run: (input, onProgress) => new Promise((resolve) => resolve(runStudy(input, onProgress))),
  optimize: (input, onProgress) => new Promise((resolve) => resolve(runTopology(input, onProgress))),
  cancel: () => undefined,
};
