import { makeDraftFeature } from '../../domain/document';
import type { DraftFeature } from '../../domain/model';
import { formatNumber } from '../../domain/units';
import { planeDependency } from '../plane/resolve';
import type { FeatureDefinition, ParamIssue } from '../definition';

export function validateDraftAngle(v: number): string | null {
  if (!Number.isFinite(v) || v <= 0) return 'L’angle doit être supérieur à 0°.';
  if (v > 45) return 'L’angle ne doit pas dépasser 45°.';
  return null;
}

export const draftDefinition: FeatureDefinition<DraftFeature> = {
  type: 'draft',
  label: 'Dépouille',
  namePrefix: 'Dépouille',
  explanation: 'Dépouille : incliner un peu les côtés de la pièce, pour qu’elle sorte facilement d’un moule ou s’emboîte en douceur.',
  icon: 'draft',
  affectsSolid: true,
  dependencies: (feature) => {
    const p = feature.params;
    return Array.from(new Set([...p.faces.map((f) => f.featureId), ...planeDependency(p.neutral)]));
  },
  validate(feature) {
    const issues: ParamIssue[] = [];
    const a = validateDraftAngle(feature.params.angle);
    if (a) issues.push({ field: 'angle', message: a });
    return issues;
  },
  summary(feature) {
    const p = feature.params;
    const n = p.faces.length;
    const neutral = p.neutral.kind === 'plane' ? `plan ${p.neutral.plane}` : 'une face';
    return `${formatNumber(p.angle, 2)}° — ${n} face${n > 1 ? 's' : ''}, depuis ${neutral}`;
  },
  tool: {
    input: 'faces',
    requiresSolid: true,
    requiresSolidReason: 'Une dépouille incline les faces d’un volume : créez d’abord une extrusion ou une forme.',
    previewKind: 'modify',
    create: (doc, part, input) => makeDraftFeature(doc, part, input.kind === 'faces' ? input.faces : []),
    initialFields: (feature) => ({ angle: String(feature.params.angle).replace('.', ',') }),
  },
};
