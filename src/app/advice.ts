/**
 * Conseils du chat : à partir de l'état réel de l'application (statuts des étapes, session
 * d'esquisse, frise), une phrase courte et, si possible, une action concrète. Règles locales,
 * sans réseau. Le chat complète les messages déjà affichés ; il ne modifie jamais le modèle
 * de lui-même (les actions sont des boutons que l'utilisateur choisit de cliquer).
 */
import type { FeatureIssueCode, FeatureStatus } from '../domain/status';
import type { Id } from '../domain/model';
import { featureDependencies } from '../features/registry';
import { extractProfiles } from '../sketch/profiles';
import { isRolledBack } from './rollback';
import type { AppState } from './state';

export type AdviceLevel = 'conseil' | 'avertissement' | 'erreur';

export type AdviceAction =
  | { kind: 'edit-feature'; featureId: Id; label: string }
  | { kind: 'repair-support'; featureId: Id; label: string }
  | { kind: 'start-sketch'; label: string }
  | { kind: 'rollback-end'; partId: Id; label: string }
  | { kind: 'update-app'; label: string };

export interface Advice {
  /** Clé stable : un conseil réduit par l'utilisateur ne revient pas tant qu'il ne change pas. */
  id: string;
  level: AdviceLevel;
  mood: 'tip' | 'happy' | 'warning';
  text: string;
  action?: AdviceAction;
}

/** Phrases courtes du chat (tutoiement, vocabulaire réel de CAO). */
const CAT_LINES: Partial<Record<FeatureIssueCode, string>> = {
  PROFILE_EMPTY: 'L’esquisse est vide : dessine un contour fermé (rectangle, cercle…) avant de faire un volume.',
  PROFILE_OPEN: 'Le contour n’est pas fermé : relie les points marqués « À relier » dans l’esquisse.',
  PROFILE_BRANCHED: 'Le dessin fait des branches : un contour doit former une seule boucle, sans trait qui dépasse.',
  PROFILE_SELF_INTERSECTING: 'Le contour se croise lui-même : déplace un point pour qu’il ne se recoupe plus.',
  PROFILE_OVERLAPPING: 'Deux contours se chevauchent : écarte-les, ou mets l’un entièrement dans l’autre pour faire un trou.',
  SKETCH_CONFLICT: 'Des cotes ou des contraintes se contredisent : ouvre l’esquisse et supprimes-en une.',
  SUPPORT_LOST: 'La face sous cette esquisse a disparu : choisis un nouveau support, ton dessin sera gardé.',
  SUPPORT_NOT_PLANAR: 'Cette esquisse est posée sur une face courbe : choisis une face plate ou un plan.',
  SUPPORT_AMBIGUOUS: 'Plusieurs faces pourraient porter cette esquisse : choisis la bonne.',
  INVALID_PARAMETER: 'Une valeur ne convient pas : ouvre l’étape et corrige-la.',
  POCKET_WITHOUT_SOLID: 'Une poche retire de la matière : il faut d’abord un volume (une extrusion).',
  POCKET_REMOVES_NOTHING: 'La poche ne touche pas la pièce : vérifie son sens ou sa profondeur.',
  POCKET_REMOVES_EVERYTHING: 'La poche enlèverait toute la pièce : réduis-la.',
  DISJOINT_SOLID: 'Ce volume ne touche pas le reste de la pièce : il forme un morceau séparé.',
  EDGES_EMPTY: 'Choisis au moins une arête en cliquant dessus dans la vue 3D.',
  EDGE_LOST: 'Une arête choisie n’existe plus : retire-la ou choisis-en une autre.',
  BLEND_FAILED: 'La valeur est trop grande pour ces arêtes : essaie plus petit.',
  REFERENCE_LOST: 'Une arête reprise de la pièce a disparu : supprime-la de l’esquisse ou reprends-en une autre.',
};

function lineFor(status: FeatureStatus): string {
  return (status.code && CAT_LINES[status.code]) || status.message || 'Cette étape n’a pas pu être calculée : modifie-la ou annule la dernière action.';
}

function featureAdvice(s: AppState, status: FeatureStatus): Advice {
  const part = s.doc.parts.find((p) => p.features.some((f) => f.id === status.featureId));
  const feature = part?.features.find((f) => f.id === status.featureId);
  const related = status.relatedFeatureId ? part?.features.find((f) => f.id === status.relatedFeatureId) : undefined;
  const supportIssue = status.code === 'SUPPORT_LOST' || status.code === 'SUPPORT_NOT_PLANAR' || status.code === 'SUPPORT_AMBIGUOUS';
  let action: AdviceAction | undefined;
  if (supportIssue && feature) action = { kind: 'repair-support', featureId: feature.id, label: 'Choisir un nouveau support' };
  else if (related) action = { kind: 'edit-feature', featureId: related.id, label: `Ouvrir « ${related.name} »` };
  else if (feature && feature.type !== 'imported-solid') action = { kind: 'edit-feature', featureId: feature.id, label: `Modifier « ${feature.name} »` };
  const error = status.state === 'error';
  const advice: Advice = {
    id: `status:${status.featureId}:${status.code ?? status.state}`,
    level: error ? 'erreur' : 'avertissement',
    mood: 'warning',
    text: `${feature ? `« ${feature.name} » : ` : ''}${lineFor(status)}`,
  };
  if (action) advice.action = action;
  return advice;
}

/** Conseil le plus utile à cet instant, ou null (le chat reste discret). */
export function currentAdvice(s: AppState): Advice | null {
  if (s.kernel.status !== 'ready' || s.tutorial) return null;
  if (s.offline.status === 'update-ready' && s.mode.kind === 'model') {
    return {
      id: 'update-ready',
      level: 'conseil',
      mood: 'happy',
      text: 'Une nouvelle version de VibeCAD est arrivée ! Ton travail est sauvegardé : on peut mettre à jour tout de suite.',
      action: { kind: 'update-app', label: 'Mettre à jour' },
    };
  }
  const part = s.doc.parts.find((p) => p.id === s.activePartId) ?? s.doc.parts[0];
  if (!part) return null;

  if (s.mode.kind === 'sketch') {
    const session = s.mode.session;
    if (session.message?.kind === 'error') return { id: `sketch-error:${session.message.text}`, level: 'erreur', mood: 'warning', text: session.message.text };
    if (!session.start && session.sketch.entities.length > 0) {
      const profile = extractProfiles(session.sketch);
      if (!profile.ok && profile.code === 'PROFILE_OPEN') {
        return { id: 'sketch-open', level: 'conseil', mood: 'tip', text: CAT_LINES.PROFILE_OPEN! };
      }
    }
    return null;
  }
  if (s.mode.kind !== 'model') return null;

  // Problème dans l'historique : la cause d'abord (une étape « en attente » renvoie à sa cause).
  const statuses = s.display[part.id]?.result.statuses ?? [];
  const problem = statuses.find((st) => st.state === 'error') ?? statuses.find((st) => st.state === 'warning');
  if (problem) return featureAdvice(s, problem);

  // Dernière esquisse pas encore utilisée et dont le contour n'est pas fermé.
  const lastSketch = [...part.features].reverse().find((f) => f.type === 'sketch');
  const used = lastSketch && part.features.some((f) => featureDependencies(f).includes(lastSketch.id) && f.id !== lastSketch.id);
  const sketchResult = lastSketch && s.display[part.id]?.result.sketches.find((x) => x.featureId === lastSketch.id);
  if (lastSketch && !used && sketchResult && !sketchResult.profile.ok && sketchResult.profile.code !== 'PROFILE_EMPTY') {
    return {
      id: `sketch-profile:${lastSketch.id}:${sketchResult.profile.code}`,
      level: 'conseil',
      mood: 'tip',
      text: `« ${lastSketch.name} » : ${lineFor({ featureId: lastSketch.id, state: 'error', code: sketchResult.profile.code })}`,
      action: { kind: 'edit-feature', featureId: lastSketch.id, label: `Ouvrir « ${lastSketch.name} »` },
    };
  }

  if (part.features.length === 0) {
    return {
      id: 'empty-part',
      level: 'conseil',
      mood: 'tip',
      text: 'Pour commencer une pièce, fais une esquisse : choisis un plan, puis dessine et cote ton contour.',
      action: { kind: 'start-sketch', label: 'Nouvelle esquisse' },
    };
  }
  if (isRolledBack(part, s.rollback)) {
    return {
      id: `rollback:${part.id}`,
      level: 'conseil',
      mood: 'tip',
      text: 'Tu regardes la pièce à une étape plus ancienne : une nouvelle étape sera ajoutée à cet endroit de la frise.',
      action: { kind: 'rollback-end', partId: part.id, label: 'Revenir à la fin' },
    };
  }
  return null;
}
