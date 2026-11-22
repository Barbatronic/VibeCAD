import { makeRevolveFeature } from '../../domain/document';
import type { RevolveAxis, RevolveFeature } from '../../domain/model';
import { formatAngle } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

export function describeAxis(axis: RevolveAxis): string {
  if (axis.kind === 'sketch-x') return 'l’axe X de l’esquisse';
  if (axis.kind === 'sketch-y') return 'l’axe Y de l’esquisse';
  if (axis.kind === 'line') return 'un segment de l’esquisse';
  const a = axis.axis;
  return a.kind === 'axis' ? `l’axe ${a.axis} du repère` : a.kind === 'datum' ? 'un axe de construction' : 'une arête de la pièce';
}

export function validateRevolveAngle(value: number): string | null {
  if (!Number.isFinite(value)) return 'L’angle doit être un nombre de degrés.';
  if (value <= 0 || value > 360) return 'L’angle doit être compris entre 0° (exclu) et 360°.';
  return null;
}

export const revolveDefinition: FeatureDefinition<RevolveFeature> = {
  type: 'revolve',
  label: 'Révolution',
  namePrefix: 'Révolution',
  explanation: 'Révolution : faire tourner le dessin autour d’un axe pour créer une pièce ronde (comme au tour).',
  icon: 'revolve',
  affectsSolid: true,
  dependencies: (feature) => {
    const a = feature.params.axis;
    const extra = a.kind === 'axis' ? (a.axis.kind === 'edge' ? a.axis.edge.faces.map((f) => f.featureId) : a.axis.kind === 'datum' ? [a.axis.featureId] : []) : [];
    return Array.from(new Set([feature.params.sketchId, ...extra]));
  },
  validate(feature) {
    const issues: ParamIssue[] = [];
    const a = validateRevolveAngle(feature.params.angle);
    if (a) issues.push({ field: 'angle', message: a });
    if (!feature.params.sketchId) issues.push({ field: 'sketchId', message: 'Choisissez une esquisse.' });
    return issues;
  },
  summary(feature) {
    const angle = feature.params.angle >= 360 ? 'tour complet' : formatAngle(feature.params.angle);
    const op = feature.params.operation === 'cut' ? ' (creusée)' : feature.params.operation === 'common' ? ' (partie commune)' : '';
    return `${angle} autour de ${describeAxis(feature.params.axis)}${op}`;
  },
  tool: {
    input: 'sketch',
    requiresSolid: false,
    previewKind: 'add',
    create: (doc, part, input) => makeRevolveFeature(doc, part, input.kind === 'sketch' ? input.sketchId : '', { kind: 'sketch-y' }),
    initialFields: (feature) => ({ angle: String(feature.params.angle).replace('.', ',') }),
  },
};
