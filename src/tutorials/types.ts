/** Étape d'un parcours guidé : chaque étape se valide en observant l'état réel du modèle. */
import type { AppState } from '../app/state';

export interface TutorialStep {
  id: string;
  title: string;
  /** Paragraphes ; `**texte**` est affiché en gras. */
  body: string[];
  /** Identifiant de l'élément d'interface à mettre en évidence. */
  target?: string;
  /** Vrai quand l'étape est réussie. */
  check?: (s: AppState) => boolean;
}
