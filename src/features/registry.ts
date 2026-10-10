/**
 * Registre des définitions de fonctions (couche domaine). Ajouter une fonction : créer son
 * dossier `features/<type>/` puis l'enregistrer ici, dans `evaluators.ts` et dans `ui/panels`.
 */
import type { Feature, Id } from '../domain/model';
import type { FeatureDefinition, FeatureDefinitions, ParamIssue } from './definition';
import { chamferDefinition } from './chamfer/definition';
import { extrudeDefinition } from './extrude/definition';
import { filletDefinition } from './fillet/definition';
import { importedSolidDefinition } from './imported/definition';
import { pocketDefinition } from './pocket/definition';
import { sketchDefinition } from './sketch/definition';

export const FEATURE_DEFINITIONS: FeatureDefinitions = {
  sketch: sketchDefinition,
  extrude: extrudeDefinition,
  pocket: pocketDefinition,
  fillet: filletDefinition,
  chamfer: chamferDefinition,
  'imported-solid': importedSolidDefinition,
};

export function definitionOf<F extends Feature>(feature: F): FeatureDefinition<F> {
  return FEATURE_DEFINITIONS[feature.type] as unknown as FeatureDefinition<F>;
}

export function featureDependencies(feature: Feature): Id[] {
  return definitionOf(feature).dependencies(feature);
}

export function validateFeature(feature: Feature): ParamIssue[] {
  return definitionOf(feature).validate(feature);
}

export function featureSummary(feature: Feature): string {
  return definitionOf(feature).summary(feature);
}
