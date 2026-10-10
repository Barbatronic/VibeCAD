import { makeShellFeature } from '../../domain/document';
import type { ShellFeature } from '../../domain/model';
import { formatLength } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

export function validateShellThickness(v: number): string | null {
  if (!Number.isFinite(v) || v <= 0) return 'L’épaisseur doit être supérieure à 0 mm.';
  if (v > 1000) return 'L’épaisseur ne doit pas dépasser 1 000 mm.';
  return null;
}

export const shellDefinition: FeatureDefinition<ShellFeature> = {
  type: 'shell',
  label: 'Coque',
  namePrefix: 'Coque',
  explanation: 'Coque : vider la pièce en gardant une paroi d’épaisseur choisie, comme un pot ou une boîte. Les faces cliquées restent ouvertes.',
  icon: 'shell',
  affectsSolid: true,
  dependencies: (feature) => Array.from(new Set(feature.params.open.map((f) => f.featureId))),
  validate(feature) {
    const issues: ParamIssue[] = [];
    const t = validateShellThickness(feature.params.thickness);
    if (t) issues.push({ field: 'thickness', message: t });
    return issues;
  },
  summary(feature) {
    const n = feature.params.open.length;
    return `paroi ${formatLength(feature.params.thickness)}${n ? ` — ${n} face${n > 1 ? 's' : ''} ouverte${n > 1 ? 's' : ''}` : ' — fermée'}`;
  },
  tool: {
    input: 'faces',
    requiresSolid: true,
    requiresSolidReason: 'Une coque vide un volume : créez d’abord une extrusion ou une forme.',
    previewKind: 'modify',
    create: (doc, part, input) => makeShellFeature(doc, part, input.kind === 'faces' ? input.faces : []),
    initialFields: (feature) => ({ thickness: String(feature.params.thickness).replace('.', ',') }),
  },
};
