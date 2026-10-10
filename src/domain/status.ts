import type { Id } from './model';

/**
 * État de validité d'une fonction après recalcul. Il n'est pas enregistré dans le fichier :
 * il est toujours recalculé à partir du modèle.
 */
export type FeatureState = 'ok' | 'warning' | 'error' | 'blocked';

export type FeatureIssueCode =
  | 'PROFILE_EMPTY'
  | 'PROFILE_OPEN'
  | 'PROFILE_BRANCHED'
  | 'PROFILE_SELF_INTERSECTING'
  | 'PROFILE_OVERLAPPING'
  | 'SKETCH_CONFLICT'
  | 'SKETCH_NOT_SOLVED'
  | 'SUPPORT_LOST'
  | 'SUPPORT_NOT_PLANAR'
  | 'SUPPORT_AMBIGUOUS'
  | 'SUPPORT_AFTER_SKETCH'
  | 'SKETCH_MISSING'
  | 'SKETCH_FAILED'
  | 'INVALID_PARAMETER'
  | 'POCKET_WITHOUT_SOLID'
  | 'POCKET_REMOVES_NOTHING'
  | 'POCKET_REMOVES_EVERYTHING'
  | 'DISJOINT_SOLID'
  | 'INVALID_SOLID'
  | 'RESOURCE_MISSING'
  | 'IMPORT_FAILED'
  | 'KERNEL_FAILURE'
  | 'EDGES_EMPTY'
  | 'EDGE_LOST'
  | 'REFERENCE_LOST'
  | 'BLEND_FAILED'
  | 'BLOCKED_BY_PREVIOUS';

export interface FeatureStatus {
  featureId: Id;
  state: FeatureState;
  code?: FeatureIssueCode;
  /** Message destiné à l'utilisateur, en français, sans jargon technique. */
  message?: string;
  /** Détail technique facultatif (affiché replié, utile à l'enseignant). */
  detail?: string;
  /** Pour une fonction bloquée : l'étape en cause. */
  blockedBy?: Id;
  /** Étape à modifier pour corriger le problème (ex. l'esquisse d'un contour ouvert). */
  relatedFeatureId?: Id;
  /** Points d'esquisse à mettre en évidence (ex. extrémités d'un contour ouvert). */
  highlightPoints?: string[];
}

export const ISSUE_MESSAGES: Record<FeatureIssueCode, string> = {
  PROFILE_EMPTY: "L’esquisse ne contient aucun contour fermé. Dessinez un rectangle, un cercle ou un contour de segments reliés.",
  PROFILE_OPEN: "Le contour n’est pas fermé. Reliez les deux points indiqués pour créer le volume.",
  PROFILE_BRANCHED:
    'Plus de deux segments se rejoignent au point indiqué. Un contour doit former une boucle simple : supprimez le segment en trop.',
  PROFILE_SELF_INTERSECTING: 'Le contour se croise lui-même. Déplacez les points pour que les segments ne se coupent pas.',
  PROFILE_OVERLAPPING: 'Deux contours se chevauchent. Ils doivent être séparés, ou l’un entièrement à l’intérieur de l’autre.',
  SKETCH_CONFLICT:
    'Certaines contraintes sont incompatibles entre elles. Supprimez ou modifiez la dernière cote ou contrainte ajoutée.',
  SKETCH_NOT_SOLVED: "L’esquisse n’a pas pu être résolue avec ces cotes. Essayez une autre valeur.",
  SUPPORT_LOST:
    "La face sur laquelle l’esquisse était posée n’existe plus. Choisissez une nouvelle face ou un plan pour réparer l’esquisse.",
  SUPPORT_NOT_PLANAR: "La face choisie n’est pas plane : une esquisse doit être posée sur une face plate ou sur un plan.",
  SUPPORT_AMBIGUOUS:
    "La face de référence de l’esquisse ne peut plus être identifiée sans ambiguïté. Choisissez à nouveau la face pour réparer l’esquisse.",
  SUPPORT_AFTER_SKETCH: "L’esquisse s’appuie sur une étape placée après elle dans l’historique.",
  SKETCH_MISSING: "L’esquisse utilisée par cette opération n’existe plus. Choisissez une autre esquisse.",
  SKETCH_FAILED: "L’esquisse utilisée par cette opération contient une erreur. Corrigez d’abord l’esquisse.",
  INVALID_PARAMETER: 'Un paramètre de cette opération n’est pas valide.',
  POCKET_WITHOUT_SOLID: "Une poche retire de la matière : créez d’abord un volume avec une extrusion.",
  POCKET_REMOVES_NOTHING:
    "La poche ne retire aucune matière. Vérifiez le sens (bouton « Inverser ») ou la position du contour.",
  POCKET_REMOVES_EVERYTHING: 'Cette poche retirerait toute la matière de la pièce.',
  DISJOINT_SOLID: "Ce volume ne touche pas le reste de la pièce : la pièce est maintenant faite de plusieurs morceaux séparés.",
  INVALID_SOLID: "Le résultat n’est pas un solide valide. Essayez une autre valeur ou un autre contour.",
  RESOURCE_MISSING: 'Les données du fichier importé sont absentes du projet.',
  IMPORT_FAILED: "Le solide importé n’a pas pu être lu.",
  KERNEL_FAILURE: 'Le calcul géométrique a échoué pour cette étape. Essayez une autre valeur.',
  EDGES_EMPTY: 'Choisissez au moins une arête : cliquez-la dans la vue 3D.',
  EDGE_LOST:
    'Une des arêtes choisies n’existe plus (une étape précédente a changé la pièce). Retirez-la ou choisissez-en une autre.',
  REFERENCE_LOST:
    'Une arête reprise de la pièce n’existe plus : elle garde sa dernière position. Supprimez-la de l’esquisse ou reprenez une autre arête.',
  BLEND_FAILED: 'Cette valeur est trop grande pour les arêtes choisies : essayez une valeur plus petite.',
  BLOCKED_BY_PREVIOUS: 'Cette étape attend la correction d’une étape précédente.',
};

export function issue(
  featureId: Id,
  state: Exclude<FeatureState, 'ok'>,
  code: FeatureIssueCode,
  extra: Partial<Omit<FeatureStatus, 'featureId' | 'state' | 'code'>> = {},
): FeatureStatus {
  return { featureId, state, code, message: ISSUE_MESSAGES[code], ...extra };
}

export const okStatus = (featureId: Id): FeatureStatus => ({ featureId, state: 'ok' });
