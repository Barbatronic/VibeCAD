/**
 * Disponibilité des commandes. Une commande indisponible reste visible et explique ce qu'il
 * faut faire ou sélectionner pour pouvoir l'utiliser.
 */
import { findPart, PATTERN_SOURCE_TYPES } from '../domain/document';
import type { FeatureType, Id, Part, SketchFeature } from '../domain/model';
import type { FeatureDefinition } from '../features/definition';
import { FEATURE_DEFINITIONS } from '../features/registry';
import type { AppState } from './state';

export type Availability = { ok: true } | { ok: false; reason: string };

const yes: Availability = { ok: true };
const no = (reason: string): Availability => ({ ok: false, reason });

export function activePart(state: AppState): Part | undefined {
  return findPart(state.doc, state.activePartId) ?? state.doc.parts[0];
}

export function sketchProfileOk(state: AppState, partId: Id, sketchId: Id): boolean | null {
  const result = state.display[partId]?.result;
  const sk = result?.sketches.find((s) => s.featureId === sketchId);
  if (!sk) return null;
  return sk.profile.ok;
}

function usedSketchIds(part: Part): Set<Id> {
  const used = new Set<Id>();
  for (const f of part.features) if (f.type === 'extrude' || f.type === 'pocket') used.add(f.params.sketchId);
  return used;
}

/** Esquisse proposée pour une extrusion ou une poche : la sélection, sinon la dernière non utilisée. */
export function suggestedSketch(state: AppState, part: Part): SketchFeature | null {
  const sketches = part.features.filter((f): f is SketchFeature => f.type === 'sketch');
  const sel = state.selection;
  if (sel?.kind === 'feature' && sel.partId === part.id) {
    const s = sketches.find((f) => f.id === sel.featureId);
    if (s && sketchProfileOk(state, part.id, s.id) !== false) return s;
  }
  const used = usedSketchIds(part);
  const closed = sketches.filter((s) => sketchProfileOk(state, part.id, s.id) !== false);
  return [...closed].reverse().find((s) => !used.has(s.id)) ?? closed[closed.length - 1] ?? null;
}

export function partHasSolid(state: AppState, partId: Id): boolean {
  return !!state.display[partId]?.result.analysis && (state.display[partId]?.result.analysis?.solidCount ?? 0) > 0;
}

function baseAvailability(state: AppState): Availability | null {
  if (state.kernel.status === 'loading') return no('Le moteur de calcul se prépare, patientez quelques secondes.');
  if (state.kernel.status === 'error') return no('Le moteur de calcul n’a pas pu démarrer.');
  if (state.mode.kind !== 'model') return no('Terminez ou annulez d’abord l’opération en cours (boutons Valider / Annuler à droite).');
  return null;
}

export function sketchAvailability(state: AppState): Availability {
  return baseAvailability(state) ?? yes;
}

/** Disponibilité d'une opération de la barre d'outils (extrusion, poche…), avec explication. */
export function toolAvailability(state: AppState, type: FeatureType): Availability {
  const base = baseAvailability(state);
  if (base) return base;
  const def = FEATURE_DEFINITIONS[type] as unknown as FeatureDefinition;
  if (!def.tool) return no('Cette opération ne se crée pas depuis la barre d’outils.');
  const part = activePart(state);
  if (!part) return no('Créez d’abord une pièce.');
  const label = def.label.toLowerCase();
  if (def.tool.requiresSolid && !partHasSolid(state, part.id)) {
    return no(def.tool.requiresSolidReason ?? `Il faut d’abord un volume pour créer une ${label}.`);
  }
  if (def.tool.input === 'edges' || def.tool.input === 'faces') return yes;
  if (def.tool.input === 'part') {
    if (type === 'pattern' && !part.features.some((f) => PATTERN_SOURCE_TYPES.includes(f.type))) {
      return no('Il n’y a encore rien à répéter : faites d’abord une extrusion, une poche ou une révolution.');
    }
    return yes;
  }
  const sketches = part.features.filter((f) => f.type === 'sketch');
  if (sketches.length === 0) return no(`Pour créer une ${label}, dessinez d’abord une esquisse fermée (bouton « Esquisse »).`);
  if (!suggestedSketch(state, part)) return no('Aucune esquisse n’a de contour fermé : terminez le contour avant de continuer.');
  return yes;
}

/** Types de fonctions proposés dans la barre d'outils, dans l'ordre du registre. */
export function toolFeatureTypes(): FeatureType[] {
  return (Object.keys(FEATURE_DEFINITIONS) as FeatureType[]).filter((t) => (FEATURE_DEFINITIONS[t] as unknown as FeatureDefinition).tool);
}

export function measureAvailability(state: AppState): Availability {
  const base = baseAvailability(state);
  if (base) return base;
  if (!state.doc.parts.some((p) => partHasSolid(state, p.id))) return no('Il faut au moins un volume à mesurer.');
  return yes;
}

export function exportAvailability(state: AppState): Availability {
  if (state.kernel.status !== 'ready') return no('Le moteur de calcul n’est pas prêt.');
  if (!state.doc.parts.some((p) => partHasSolid(state, p.id))) return no('Aucune pièce n’a encore de volume à exporter.');
  return yes;
}
