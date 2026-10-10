/**
 * Contrat d'une fonction paramétrique côté domaine (sans DOM, sans noyau) : libellés,
 * paramètres par défaut, validation, dépendances et résumé lisible.
 * L'évaluation géométrique (`evaluate.ts`) et le panneau d'interface (`panel.tsx`) de chaque
 * fonction sont dans le même dossier, enregistrés dans leurs registres respectifs.
 */
import type { CadDocument, EdgeRef, Feature, FeatureType, Id, Part } from '../domain/model';
import type { BoundingBox } from '../geometry/kernel';
import type { Frame3D } from '../math/frame';

export interface ParamIssue {
  /** Nom du paramètre concerné (ex. `distance`). */
  field: string;
  message: string;
}

/** Informations disponibles pour choisir les paramètres par défaut d'une nouvelle fonction. */
export interface CreateContext {
  /** Repère du plan de l'esquisse utilisée (null si inconnu). */
  sketchFrame: Frame3D | null;
  /** Boîte englobante du solide actuel de la pièce (null si aucun volume). */
  partBounds: BoundingBox | null;
}

/** Ce que l'utilisateur fournit à la création : une esquisse fermée, ou des arêtes de la pièce. */
export type ToolInput = { kind: 'sketch'; sketchId: Id } | { kind: 'edges'; edges: EdgeRef[] };

/** Fonction proposée dans la barre d'outils, avec un panneau de paramètres et un aperçu. */
export interface FeatureTool<F extends Feature> {
  /** Entrée attendue : une esquisse (extrusion, poche…) ou des arêtes choisies dans la vue (congé…). */
  input: ToolInput['kind'];
  /** Le volume de la pièce doit déjà exister (ex. une poche retire de la matière). */
  requiresSolid: boolean;
  /** Explication affichée quand la pièce n'a pas encore de volume. */
  requiresSolidReason?: string;
  /** Aperçu : volume ajouté (vert), retiré (rouge) ou pièce modifiée. */
  previewKind: 'add' | 'cut' | 'modify';
  create(doc: CadDocument, part: Part, input: ToolInput, context: CreateContext): F;
  /** Texte initial des champs numériques du panneau. */
  initialFields(feature: F): Record<string, string>;
}

export interface FeatureDefinition<F extends Feature = Feature> {
  type: F['type'];
  /** Nom affiché de l'outil, ex. « Extrusion ». */
  label: string;
  /** Préfixe des noms automatiques, ex. « Extrusion » → « Extrusion 2 ». */
  namePrefix: string;
  /** Explication courte du vocabulaire réel, ex. « Extrusion : donner une épaisseur au dessin. » */
  explanation: string;
  /** Identifiant d'icône (voir `ui/icons`). */
  icon: string;
  /** Vrai si la fonction modifie le solide de la pièce (les suivantes dépendent alors de son résultat). */
  affectsSolid: boolean;
  /** Fonctions dont celle-ci dépend directement (déduites des paramètres). */
  dependencies(feature: F): Id[];
  /** Erreurs de saisie des paramètres (vide si tout est valide). */
  validate(feature: F): ParamIssue[];
  /** Résumé court pour l'historique, ex. « 5 mm, symétrique ». */
  summary(feature: F): string;
  /** Présent si la fonction est créée depuis la barre d'outils avec un panneau de paramètres. */
  tool?: FeatureTool<F>;
}

export type FeatureDefinitions = { [T in FeatureType]: FeatureDefinition<Extract<Feature, { type: T }>> };
