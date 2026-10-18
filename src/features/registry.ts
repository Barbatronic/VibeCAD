/**
 * Registre des définitions de fonctions (couche domaine). Ajouter une fonction : créer son
 * dossier `features/<type>/` puis l'enregistrer ici, dans `evaluators.ts` et dans `ui/panels`.
 */
import type { Feature, Id } from '../domain/model';
import type { FeatureDefinition, FeatureDefinitions, ParamIssue } from './definition';
import { sweepDefinition } from './sweep/definition';
import { sheetDefinition } from './sheet/definition';
import { imageDefinition } from './image/definition';
import { flangeDefinition } from './flange/definition';
import { foldDefinition } from './fold/definition';
import { splitDefinition } from './split/definition';
import { draftDefinition } from './draft/definition';
import { thickenDefinition } from './thicken/definition';
import { loftDefinition } from './loft/definition';
import { shellDefinition } from './shell/definition';
import { primitiveDefinition } from './primitive/definition';
import { gearDefinition } from './gear/definition';
import { moveDefinition } from './move/definition';
import { holeDefinition } from './hole/definition';
import { planeDefinition } from './plane/definition';
import { axisDefinition } from './axis/definition';
import { mirrorDefinition } from './mirror/definition';
import { chamferDefinition } from './chamfer/definition';
import { extrudeDefinition } from './extrude/definition';
import { filletDefinition } from './fillet/definition';
import { importedSolidDefinition } from './imported/definition';
import { pocketDefinition } from './pocket/definition';
import { revolveDefinition } from './revolve/definition';
import { patternDefinition } from './pattern/definition';
import { sketchDefinition } from './sketch/definition';

export const FEATURE_DEFINITIONS: FeatureDefinitions = {
  sketch: sketchDefinition,
  extrude: extrudeDefinition,
  primitive: primitiveDefinition,
  gear: gearDefinition,
  move: moveDefinition,
  hole: holeDefinition,
  plane: planeDefinition,
  axis: axisDefinition,
  pocket: pocketDefinition,
  revolve: revolveDefinition,
  loft: loftDefinition,
  sweep: sweepDefinition,
  split: splitDefinition,
  draft: draftDefinition,
  thicken: thickenDefinition,
  pattern: patternDefinition,
  mirror: mirrorDefinition,
  shell: shellDefinition,
  fillet: filletDefinition,
  chamfer: chamferDefinition,
  sheet: sheetDefinition,
  flange: flangeDefinition,
  fold: foldDefinition,
  image: imageDefinition,
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
