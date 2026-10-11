import { makeThickenFeature } from '../../domain/document';
import type { ThickenFeature } from '../../domain/model';
import { formatLength } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

export function validateThicken(v: number): string | null {
  if (!Number.isFinite(v) || v === 0) return 'L’épaisseur doit être différente de 0 mm.';
  if (Math.abs(v) > 100) return 'L’épaisseur ne doit pas dépasser 100 mm.';
  return null;
}

export const thickenDefinition: FeatureDefinition<ThickenFeature> = {
  type: 'thicken',
  label: 'Épaissir',
  namePrefix: 'Épaisseur',
  explanation: 'Épaissir : gonfler ou amincir toute la pièce d’une même épaisseur, par exemple pour laisser du jeu entre deux pièces qui s’emboîtent.',
  icon: 'thicken',
  affectsSolid: true,
  dependencies: () => [],
  validate(feature) {
    const issues: ParamIssue[] = [];
    const t = validateThicken(feature.params.distance);
    if (t) issues.push({ field: 'distance', message: t });
    return issues;
  },
  summary(feature) {
    const d = feature.params.distance;
    return `${d > 0 ? 'grossie' : 'amincie'} de ${formatLength(Math.abs(d))}${feature.params.corners === 'sharp' ? ', coins vifs' : ''}`;
  },
  tool: {
    input: 'part',
    requiresSolid: true,
    requiresSolidReason: 'Épaissir agit sur un volume : créez d’abord une extrusion ou une forme.',
    previewKind: 'modify',
    create: (doc, part) => makeThickenFeature(doc, part),
    initialFields: (feature) => ({ distance: String(Math.abs(feature.params.distance)).replace('.', ',') }),
  },
};
