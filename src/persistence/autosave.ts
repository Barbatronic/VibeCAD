/**
 * Sauvegarde automatique : après chaque modification (avec un court délai), l'état courant est
 * écrit dans IndexedDB. À l'ouverture suivante, une sauvegarde plus récente que le dernier
 * enregistrement est proposée en récupération.
 */
import type { CadDocument } from '../domain/model';
import { serializeDocument } from '../io/native-format';
import { isQuotaError, type ProjectStore } from './db';

export type AutosaveStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saved'; at: string }
  | { kind: 'error'; message: string };

export class AutosaveScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingDoc: { doc: CadDocument; basedOnSavedAt: string | null } | null = null;

  constructor(
    private readonly store: ProjectStore,
    private readonly onStatus: (status: AutosaveStatus) => void,
    private readonly delayMs = 1200,
  ) {}

  schedule(doc: CadDocument, basedOnSavedAt: string | null): void {
    this.pendingDoc = { doc, basedOnSavedAt };
    this.onStatus({ kind: 'pending' });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingDoc = null;
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const job = this.pendingDoc;
    this.pendingDoc = null;
    if (!job) return;
    const savedAt = new Date().toISOString();
    try {
      await this.store.putAutosave({
        projectId: job.doc.id,
        name: job.doc.name,
        savedAt,
        text: serializeDocument(job.doc, savedAt),
        basedOnSavedAt: job.basedOnSavedAt,
      });
      this.onStatus({ kind: 'saved', at: savedAt });
    } catch (err) {
      this.onStatus({
        kind: 'error',
        message: isQuotaError(err)
          ? 'Le stockage du navigateur est plein : utilisez « Enregistrer sous… » pour télécharger votre projet.'
          : 'La sauvegarde automatique a échoué : utilisez « Enregistrer sous… » pour garder une copie.',
      });
    }
  }
}
