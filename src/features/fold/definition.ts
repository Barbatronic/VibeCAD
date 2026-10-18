import { makeFoldFeature } from '../../domain/document';
import type { FoldFeature } from '../../domain/model';
import { formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';
import { validateBend } from '../sheet/limits';

export const foldDefinition: FeatureDefinition<FoldFeature> = {
  type: 'fold',
  label: 'Pli',
  namePrefix: 'Pli',
  explanation: 'Pli : plier la tôle le long d’un trait dessiné dessus, comme à la plieuse ou à la thermoplieuse.',
  icon: 'fold',
  affectsSolid: true,
  dependencies: (feature) => [feature.params.sketchId],
  validate(feature) {
    const issues: ParamIssue[] = validateBend(feature.params);
    if (!feature.params.sketchId) issues.push({ field: 'sketchId', message: 'Choisissez l’esquisse du trait de pli.' });
    return issues;
  },
  summary: (feature) => `${formatNumber(feature.params.angle, 1)}°${feature.params.direction === 'down' ? ' vers le bas' : ''}`,
  tool: {
    input: 'sketch',
    requiresSolid: true,
    requiresSolidReason: 'Un pli plie une tôle : créez d’abord une tôle (outil « Tôle »), puis dessinez le trait de pli dessus.',
    previewKind: 'modify',
    create: (doc, part, input) => makeFoldFeature(doc, part, input.kind === 'sketch' ? input.sketchId : ''),
    initialFields: (feature) => ({ angle: formatNumber(feature.params.angle, 3), radius: '' }),
  },
};
