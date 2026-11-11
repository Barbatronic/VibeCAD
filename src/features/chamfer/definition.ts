import { makeChamferFeature } from '../../domain/document';
import type { ChamferFeature } from '../../domain/model';
import { formatLength } from '../../domain/units';
import { chamferShape, chamferSizeText, edgeDependencies, validateBlend } from '../blend-common';
import type { FeatureDefinition } from '../definition';

export const chamferDefinition: FeatureDefinition<ChamferFeature> = {
  type: 'chamfer',
  label: 'Chanfrein',
  namePrefix: 'Chanfrein',
  explanation: 'Chanfrein : couper une arête en biseau.',
  icon: 'chamfer',
  affectsSolid: true,
  dependencies: (feature) => edgeDependencies(feature.params.edges),
  validate: (feature) => {
    const issues = validateBlend(feature.params.edges, feature.params.distance, 'La longueur');
    const shape = chamferShape(feature.params);
    if ('error' in shape) issues.push({ field: feature.params.mode === 'distanceAngle' ? 'angle' : 'distance2', message: shape.error });
    return issues;
  },
  summary: (feature) => {
    const n = feature.params.edges.length;
    return `${chamferSizeText(feature.params)} — ${n} arête${n > 1 ? 's' : ''}`;
  },
  tool: {
    input: 'edges',
    requiresSolid: true,
    requiresSolidReason: 'Un chanfrein coupe les arêtes d’un volume : créez d’abord une extrusion.',
    previewKind: 'modify',
    create: (doc, part, input) => makeChamferFeature(doc, part, input.kind === 'edges' ? input.edges : [], 1),
    initialFields: (feature) => ({
      size: formatLength(feature.params.distance, 3, false),
      ...(feature.params.distance2 !== undefined ? { distance2: formatLength(feature.params.distance2, 3, false) } : {}),
      ...(feature.params.angle !== undefined ? { angle: String(feature.params.angle).replace('.', ',') } : {}),
    }),
  },
};
