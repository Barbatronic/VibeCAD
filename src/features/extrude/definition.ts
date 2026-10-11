import { makeExtrudeFeature } from '../../domain/document';
import type { ExtentDirection, ExtrudeFeature } from '../../domain/model';
import { TOLERANCES } from '../../domain/tolerances';
import { formatLength } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

export const EXTRUDE_DIRECTION_LABELS: Record<ExtentDirection, string> = {
  default: 'Côté normale',
  reversed: 'Côté opposé',
  symmetric: 'Symétrique',
};

export function validateDistance(value: number, label: string): string | null {
  if (!Number.isFinite(value)) return `${label} doit être un nombre.`;
  if (value < TOLERANCES.minLength) return `${label} doit être au moins ${formatLength(TOLERANCES.minLength)}.`;
  if (value > TOLERANCES.maxLength) return `${label} ne peut pas dépasser ${formatLength(TOLERANCES.maxLength, 0)}.`;
  return null;
}

export const extrudeDefinition: FeatureDefinition<ExtrudeFeature> = {
  type: 'extrude',
  label: 'Extrusion',
  namePrefix: 'Extrusion',
  explanation: "Extrusion : donner une épaisseur au dessin pour créer de la matière.",
  icon: 'extrude',
  affectsSolid: true,
  dependencies: (feature) => (feature.params.upTo ? [feature.params.sketchId, feature.params.upTo.featureId] : [feature.params.sketchId]),
  validate(feature) {
    const issues: ParamIssue[] = [];
    const d = validateDistance(feature.params.distance, 'La longueur');
    if (d) issues.push({ field: 'distance', message: d });
    if (!feature.params.sketchId) issues.push({ field: 'sketchId', message: 'Choisissez une esquisse.' });
    return issues;
  },
  summary(feature) {
    if (feature.params.upTo) return 'jusqu’à une face';
    const dir = feature.params.direction === 'default' ? '' : `, ${EXTRUDE_DIRECTION_LABELS[feature.params.direction].toLowerCase()}`;
    return `${formatLength(feature.params.distance)}${dir}`;
  },
  tool: {
    input: 'sketch',
    requiresSolid: false,
    previewKind: 'add',
    create: (doc, part, input) => makeExtrudeFeature(doc, part, input.kind === 'sketch' ? input.sketchId : '', 10),
    initialFields: (feature) => ({ distance: formatLength(feature.params.distance, 3, false) }),
  },
};
