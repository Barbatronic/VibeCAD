/**
 * Barre de retour en arrière dans l'historique (comme dans SolidWorks ou la frise de Fusion 360) :
 * pour chaque pièce, la dernière étape calculée. Les étapes suivantes restent dans le projet
 * mais ne sont pas recalculées ; une nouvelle étape s'insère à la position de la barre.
 * C'est un état d'affichage : il n'est ni enregistré dans le fichier, ni annulable.
 */
import type { CadDocument, Id, Part } from '../domain/model';

/** Par pièce : identifiant de la dernière étape active (null : aucune). Absent : toutes. */
export type RollbackState = Readonly<Record<Id, Id | null>>;

/** Nombre d'étapes actives d'une pièce. */
export function activeCount(part: Part, rollback: RollbackState): number {
  if (!(part.id in rollback)) return part.features.length;
  const marker = rollback[part.id];
  if (marker === null) return 0;
  const index = part.features.findIndex((f) => f.id === marker);
  return index < 0 ? part.features.length : index + 1;
}

export function isRolledBack(part: Part, rollback: RollbackState): boolean {
  return activeCount(part, rollback) < part.features.length;
}

/** Retire les positions devenues inutiles (barre en fin d'historique, étape supprimée). */
export function normalizeRollback(doc: CadDocument, rollback: RollbackState): RollbackState {
  let changed = false;
  const out: Record<Id, Id | null> = {};
  for (const [partId, marker] of Object.entries(rollback)) {
    const part = doc.parts.find((p) => p.id === partId);
    const keep = !!part && (marker === null ? part.features.length > 0 : part.features.findIndex((f) => f.id === marker) < part.features.length - 1 && part.features.some((f) => f.id === marker));
    if (keep) out[partId] = marker;
    else changed = true;
  }
  return changed ? out : rollback;
}

/** Barre placée après la `count`-ième étape de la pièce (count = nombre d'étapes actives). */
export function withRollbackAt(rollback: RollbackState, part: Part, count: number): RollbackState {
  const n = Math.max(0, Math.min(part.features.length, Math.round(count)));
  const next: Record<Id, Id | null> = { ...rollback };
  if (n >= part.features.length) delete next[part.id];
  else next[part.id] = n === 0 ? null : part.features[n - 1]!.id;
  return next;
}

/** Document limité aux étapes actives (ce que montre la vue). */
export function rolledBackDocument(doc: CadDocument, rollback: RollbackState): CadDocument {
  if (Object.keys(rollback).length === 0) return doc;
  return {
    ...doc,
    parts: doc.parts.map((p) => {
      const n = activeCount(p, rollback);
      return n < p.features.length ? { ...p, features: p.features.slice(0, n) } : p;
    }),
  };
}

/** Étape après laquelle insérer une nouvelle étape (undefined : à la fin). */
export function insertionPoint(part: Part, rollback: RollbackState): Id | null | undefined {
  return isRolledBack(part, rollback) ? (rollback[part.id] ?? null) : undefined;
}
