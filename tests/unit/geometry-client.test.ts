import { describe, expect, it } from 'vitest';
import { createDocument } from '../../src/domain/document';
import { GeometryClient } from '../../src/geometry/client';

/** Faux worker : garde les requêtes reçues, répond à la demande. */
class FakeWorker {
  readonly received: { id: number; type: string }[] = [];
  terminated = false;
  private listener: ((event: { data: unknown }) => void) | null = null;
  postMessage(msg: { id: number; type: string }): void {
    this.received.push(msg);
  }
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === 'message') this.listener = listener;
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(id: number, result: unknown): void {
    this.listener?.({ data: { id, ok: true, result } });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('client du calcul géométrique', () => {
  function setup() {
    const workers: FakeWorker[] = [];
    const client = new GeometryClient(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    });
    return { client, workers };
  }

  it('abandonne un aperçu en cours : worker remplacé, calcul suivant envoyé au nouveau', async () => {
    const { client, workers } = setup();
    const doc = createDocument('Essai');
    const preview = client.evaluate(doc, 'fe-1');
    await tick();
    expect(workers[0]!.received.map((m) => m.type)).toEqual(['init', 'evaluate']);
    // Réponse à l'init : seul l'aperçu attend encore.
    workers[0]!.reply(workers[0]!.received[0]!.id, { memoryBytes: 0, initMs: 0 });
    await tick();
    expect(client.abortPreview()).toBe(true);
    await expect(preview).resolves.toBeNull();
    expect(workers[0]!.terminated).toBe(true);
    const commit = client.evaluate(doc);
    await tick();
    const req = workers[1]!.received.find((m) => m.type === 'evaluate')!;
    workers[1]!.reply(req.id, { parts: [] });
    await expect(commit).resolves.toEqual({ parts: [] });
  });

  it('n’abandonne pas un recalcul validé, ni un aperçu trop récent', async () => {
    const { client, workers } = setup();
    const doc = createDocument('Essai');
    workers[0]!.reply(1, {});
    void client.evaluate(doc);
    await tick();
    expect(client.abortPreview()).toBe(false);
    const { client: c2, workers: w2 } = setup();
    w2[0]!.reply(1, {});
    void c2.evaluate(doc, 'fe-1');
    await tick();
    expect(c2.abortPreview(60_000)).toBe(false);
    expect(w2[0]!.terminated).toBe(false);
  });
});
