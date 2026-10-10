import { makeChamferFeature } from '../../domain/document';
import type { ChamferFeature } from '../../domain/model';
import { formatLength } from '../../domain/units';
import { blendSummary, edgeDependencies, validateBlend } from '../blend-common';
import type { FeatureDefinition } from '../definition';

export const chamferDefinition: FeatureDefinition<ChamferFeature> = {
  type: 'chamfer',
  label: 'Chanfrein',
  namePrefix: 'Chanfrein',
  explanation: 'Chanfrein : couper une arête en biseau.',
  icon: 'chamfer',
  affectsSolid: true,
  dependencies: (feature) => edgeDependencies(feature.params.edges),
  validate: (feature) => validateBlend(feature.params.edges, feature.params.distance, 'La longueur'),
  summary: (feature) => blendSummary(feature.params.edges, feature.params.distance, ''),
  tool: {
    input: 'edges',
    requiresSolid: true,
    requiresSolidReason: 'Un chanfrein coupe les arêtes d’un volume : créez d’abord une extrusion.',
    previewKind: 'modify',
    create: (doc, part, input) => makeChamferFeature(doc, part, input.kind === 'edges' ? input.edges : [], 1),
    initialFields: (feature) => ({ size: formatLength(feature.params.distance, 3, false) }),
  },
};
