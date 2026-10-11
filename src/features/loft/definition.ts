import { makeLoftFeature } from '../../domain/document';
import type { LoftFeature, SketchFeature } from '../../domain/model';
import type { FeatureDefinition, ParamIssue } from '../definition';

export const loftDefinition: FeatureDefinition<LoftFeature> = {
  type: 'loft',
  label: 'Lissage',
  namePrefix: 'Lissage',
  explanation: 'Lissage : un volume qui passe en douceur d’un contour à un autre (d’un carré à un rond…), dessinés sur des plans différents.',
  icon: 'loft',
  affectsSolid: true,
  dependencies: (feature) => [...feature.params.sketchIds],
  validate(feature) {
    const issues: ParamIssue[] = [];
    if (new Set(feature.params.sketchIds).size < 2) issues.push({ field: 'sketchIds', message: 'Choisissez au moins deux esquisses, chacune avec un contour fermé.' });
    return issues;
  },
  summary(feature) {
    const n = feature.params.sketchIds.length;
    return `${n} contour${n > 1 ? 's' : ''}${feature.params.ruled ? ', raccords droits' : ''}${feature.params.operation === 'cut' ? ' (creusé)' : ''}`;
  },
  tool: {
    input: 'sketch',
    requiresSolid: false,
    previewKind: 'modify',
    // Par défaut : l'esquisse choisie et la précédente (dans l'ordre de l'historique).
    create: (doc, part, input) => {
      const sketches = part.features.filter((f): f is SketchFeature => f.type === 'sketch').map((f) => f.id);
      const chosen = input.kind === 'sketch' ? input.sketchId : sketches[sketches.length - 1];
      const at = chosen ? sketches.indexOf(chosen) : -1;
      const ids = at > 0 ? [sketches[at - 1]!, chosen!] : sketches.slice(-2);
      return makeLoftFeature(doc, part, ids);
    },
    initialFields: () => ({}),
  },
};
