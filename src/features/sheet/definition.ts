import { makeSheetFeature } from '../../domain/document';
import type { SheetFeature } from '../../domain/model';
import { sheetMaterial } from '../../domain/sheet-metal';
import { formatLength } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

export function validateSheetThickness(t: number): string | null {
  if (!Number.isFinite(t) || t < 0.1) return 'L’épaisseur doit être d’au moins 0,1 mm.';
  if (t > 20) return 'Une tôle ne dépasse pas 20 mm d’épaisseur.';
  return null;
}

export const sheetDefinition: FeatureDefinition<SheetFeature> = {
  type: 'sheet',
  label: 'Tôle',
  namePrefix: 'Tôle',
  explanation: 'Tôle : une plaque fine (métal, plastique, carton) découpée dans le contour du dessin, qu’on peut ensuite plier. Sa forme à plat (le développé) se découpe au laser.',
  icon: 'sheet',
  affectsSolid: true,
  dependencies: (feature) => [feature.params.sketchId],
  validate(feature) {
    const issues: ParamIssue[] = [];
    const t = validateSheetThickness(feature.params.thickness);
    if (t) issues.push({ field: 'thickness', message: t });
    if (!Number.isFinite(feature.params.radius) || feature.params.radius < 0 || feature.params.radius > 200) issues.push({ field: 'radius', message: 'Le rayon doit être entre 0 et 200 mm.' });
    if (!feature.params.sketchId) issues.push({ field: 'sketchId', message: 'Choisissez une esquisse.' });
    return issues;
  },
  summary: (feature) => `${sheetMaterial(feature.params.materialId).name}, ${formatLength(feature.params.thickness)}`,
  tool: {
    input: 'sketch',
    requiresSolid: false,
    previewKind: 'add',
    create: (doc, part, input) => makeSheetFeature(doc, part, input.kind === 'sketch' ? input.sketchId : ''),
    initialFields: (feature) => ({ thickness: formatLength(feature.params.thickness, 3, false), radius: formatLength(feature.params.radius, 3, false) }),
  },
};
