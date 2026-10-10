/**
 * Annuler / rétablir les actions de l'utilisateur. Ce mécanisme est distinct de l'historique
 * paramétrique (la liste des fonctions de chaque pièce, enregistrée dans le projet) : il
 * conserve des instantanés immuables du document, partagés en mémoire (aucune copie profonde).
 * Restaurer un instantané rétablit à la fois les paramètres, l'historique de construction et,
 * après recalcul, la géométrie.
 */
import type { CadDocument } from '../domain/model';

export interface HistoryEntry {
  doc: CadDocument;
  /** Libellé de l'action, ex. « Modifier Esquisse 1 ». */
  label: string;
}

export interface UndoHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const MAX_UNDO_STEPS = 100;

export const emptyHistory = (): UndoHistory => ({ past: [], future: [] });

/** Enregistre une action : `before` est l'état du document avant l'action. */
export function recordAction(history: UndoHistory, before: CadDocument, label: string): UndoHistory {
  return { past: [...history.past, { doc: before, label }].slice(-MAX_UNDO_STEPS), future: [] };
}

export function undoAction(history: UndoHistory, current: CadDocument): { history: UndoHistory; doc: CadDocument; label: string } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, { doc: current, label: entry.label }] },
    doc: entry.doc,
    label: entry.label,
  };
}

export function redoAction(history: UndoHistory, current: CadDocument): { history: UndoHistory; doc: CadDocument; label: string } | null {
  const entry = history.future[history.future.length - 1];
  if (!entry) return null;
  return {
    history: { past: [...history.past, { doc: current, label: entry.label }], future: history.future.slice(0, -1) },
    doc: entry.doc,
    label: entry.label,
  };
}

export const nextUndoLabel = (h: UndoHistory) => h.past[h.past.length - 1]?.label ?? null;
export const nextRedoLabel = (h: UndoHistory) => h.future[h.future.length - 1]?.label ?? null;
