import type { SketchFeature } from '../../domain/model';
import { formatLength } from '../../domain/units';
import { countCurves } from '../../sketch/model';
import type { FeatureDefinition, ParamIssue } from '../definition';

const PLANE_LABELS = { XY: 'plan XY (dessus)', XZ: 'plan XZ (face)', YZ: 'plan YZ (droite)' } as const;

export const sketchDefinition: FeatureDefinition<SketchFeature> = {
  type: 'sketch',
  label: 'Esquisse',
  namePrefix: 'Esquisse',
  explanation: 'Esquisse : le dessin plat, coté, à partir duquel on crée un volume.',
  icon: 'sketch',
  affectsSolid: false,
  dependencies(feature) {
    const s = feature.params.support;
    const ids = new Set<string>(s.kind === 'face' ? [s.ref.featureId] : []);
    // Arêtes reprises de la pièce : l'esquisse dépend des étapes qui ont créé leurs faces.
    for (const e of feature.params.entities) {
      if ((e.type === 'line' || e.type === 'circle') && e.reference) for (const f of e.reference.edge.faces) ids.add(f.featureId);
    }
    return Array.from(ids);
  },
  validate(feature) {
    const issues: ParamIssue[] = [];
    const s = feature.params.support;
    if (s.kind === 'plane' && !Number.isFinite(s.offset)) issues.push({ field: 'support', message: 'Le décalage du plan est invalide.' });
    for (const c of feature.params.constraints) {
      if ('value' in c && (!Number.isFinite(c.value) || c.value < 0)) {
        issues.push({ field: c.id, message: 'Une cote a une valeur invalide.' });
      }
    }
    return issues;
  },
  summary(feature) {
    const s = feature.params.support;
    const where =
      s.kind === 'plane'
        ? `${PLANE_LABELS[s.plane]}${s.offset ? `, décalé de ${formatLength(s.offset)}` : ''}`
        : 'sur une face';
    const { lines, circles } = countCurves(feature.params);
    const parts = [];
    if (lines) parts.push(`${lines} segment${lines > 1 ? 's' : ''}`);
    if (circles) parts.push(`${circles} cercle${circles > 1 ? 's' : ''}`);
    return parts.length ? `${where} — ${parts.join(', ')}` : `${where} — vide`;
  },
};

export function describeSupportPlane(plane: keyof typeof PLANE_LABELS): string {
  return PLANE_LABELS[plane];
}
