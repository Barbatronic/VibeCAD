import { makeAxisFeature } from '../../domain/document';
import type { AxisFeature } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

export function axisIssues(p: AxisFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  if (p.kind === 'line') {
    for (const k of ['x', 'y', 'z'] as const) {
      if (!Number.isFinite(p.position[k]) || Math.abs(p.position[k]) > 100000) issues.push({ field: k, message: 'La position doit être un nombre de millimètres (au plus 100 000).' });
    }
  } else if (!p.edge) issues.push({ field: 'edge', message: 'Cliquez une arête droite ou le bord d’un trou dans la vue 3D.' });
  return issues;
}

export const axisDefinition: FeatureDefinition<AxisFeature> = {
  type: 'axis',
  label: 'Axe',
  namePrefix: 'Axe',
  explanation: 'Axe de construction : une droite (par un point, ou l’axe d’un trou) autour de laquelle répéter une étape ou incliner un plan.',
  icon: 'datum-axis',
  affectsSolid: false,
  dependencies: (feature) => (feature.params.kind === 'edge' && feature.params.edge ? Array.from(new Set(feature.params.edge.faces.map((f) => f.featureId))) : []),
  validate: (feature) => axisIssues(feature.params),
  summary(feature) {
    const p = feature.params;
    if (p.kind === 'edge') return 'repris d’une arête';
    const at = p.position;
    return `selon ${p.direction}, par (${formatNumber(at.x, 2)} ; ${formatNumber(at.y, 2)} ; ${formatLength(at.z)})`;
  },
  tool: {
    input: 'part',
    requiresSolid: false,
    previewKind: 'modify',
    create: (doc, part) => makeAxisFeature(doc, part),
    initialFields: (feature) => {
      const t = (v: number) => String(v).replace('.', ',');
      const p = feature.params.position;
      return { x: t(p.x), y: t(p.y), z: t(p.z) };
    },
  },
};
