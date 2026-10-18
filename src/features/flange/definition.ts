import { makeFlangeFeature } from '../../domain/document';
import type { FlangeFeature } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import { edgeDependencies } from '../blend-common';
import type { FeatureDefinition, ParamIssue } from '../definition';
import { validateBend } from '../sheet/limits';

export const flangeDefinition: FeatureDefinition<FlangeFeature> = {
  type: 'flange',
  label: 'Bord plié',
  namePrefix: 'Bord plié',
  explanation: 'Bord plié : ajouter un rebord plié le long d’un bord de la tôle, comme le côté d’une boîte ou une équerre.',
  icon: 'flange',
  affectsSolid: true,
  dependencies: (feature) => edgeDependencies(feature.params.edges),
  validate(feature) {
    const issues: ParamIssue[] = validateBend(feature.params);
    if (feature.params.edges.length === 0) issues.push({ field: 'edges', message: 'Cliquez au moins un bord de la tôle dans la vue 3D.' });
    if (!Number.isFinite(feature.params.length) || feature.params.length <= 0 || feature.params.length > 2000) issues.push({ field: 'length', message: 'La longueur du rebord doit être entre 0 et 2 000 mm.' });
    return issues;
  },
  summary: (feature) =>
    `${feature.params.edges.length > 1 ? `${feature.params.edges.length} bords, ` : ''}${formatLength(feature.params.length)}, ${formatNumber(feature.params.angle, 1)}°${feature.params.direction === 'down' ? ' vers le bas' : ''}`,
  tool: {
    input: 'edges',
    requiresSolid: true,
    requiresSolidReason: 'Un bord plié se pose sur une tôle : créez d’abord une tôle (outil « Tôle »).',
    previewKind: 'add',
    create: (doc, part, input) => makeFlangeFeature(doc, part, input.kind === 'edges' ? input.edges : []),
    initialFields: (feature) => ({ length: formatLength(feature.params.length, 3, false), angle: formatNumber(feature.params.angle, 3), radius: '' }),
  },
};
