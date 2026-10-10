import { makeFilletFeature } from '../../domain/document';
import type { FilletFeature } from '../../domain/model';
import { formatLength } from '../../domain/units';
import { blendSummary, edgeDependencies, validateBlend } from '../blend-common';
import type { FeatureDefinition } from '../definition';

export const filletDefinition: FeatureDefinition<FilletFeature> = {
  type: 'fillet',
  label: 'Congé',
  namePrefix: 'Congé',
  explanation: 'Congé : arrondir une arête, comme un coin poncé.',
  icon: 'fillet',
  affectsSolid: true,
  dependencies: (feature) => edgeDependencies(feature.params.edges),
  validate: (feature) => validateBlend(feature.params.edges, feature.params.radius, 'Le rayon'),
  summary: (feature) => blendSummary(feature.params.edges, feature.params.radius, 'R'),
  tool: {
    input: 'edges',
    requiresSolid: true,
    requiresSolidReason: 'Un congé arrondit les arêtes d’un volume : créez d’abord une extrusion.',
    previewKind: 'modify',
    create: (doc, part, input) => makeFilletFeature(doc, part, input.kind === 'edges' ? input.edges : [], 1),
    initialFields: (feature) => ({ size: formatLength(feature.params.radius, 3, false) }),
  },
};
