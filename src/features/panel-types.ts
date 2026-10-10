/**
 * Contrat entre une fonction paramétrique et son panneau d'interface (`features/<type>/panel.tsx`).
 * Le panneau ne connaît pas le contrôleur de l'application : il reçoit l'opération en cours
 * d'édition et des rappels pour la modifier.
 */
import type { Feature, Id, Part } from '../domain/model';
import type { FeatureStatus } from '../domain/status';

/** Opération en cours d'édition (nouvelle ou existante), avec la saisie brute des champs. */
export interface FeatureDraft<F extends Feature = Feature> {
  partId: Id;
  isNew: boolean;
  feature: F;
  /** Texte saisi dans chaque champ numérique (conservé même s'il est invalide). */
  fields: Record<string, string>;
  /** Erreur de saisie par champ (absent : champ valide). */
  errors: Record<string, string>;
}

export interface SketchOption {
  id: Id;
  name: string;
  /** Vrai si le contour est fermé (null : pas encore évalué). */
  closed: boolean | null;
}

export type FieldUpdate<F extends Feature> = { error: string } | { feature: F };

export interface FeaturePanelProps<F extends Feature = Feature> {
  draft: FeatureDraft<F>;
  part: Part;
  sketches: SketchOption[];
  /** Statut de l'aperçu courant (null : en cours de calcul). */
  status: FeatureStatus | null;
  update(change: (feature: F) => F): void;
  /** Mémorise la saisie d'un champ et, si elle est valide, la fonction modifiée. */
  setField(name: string, text: string, result: FieldUpdate<F>): void;
  confirm(): void;
  cancel(): void;
}
