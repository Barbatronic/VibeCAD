import { makePlaneFeature } from '../../domain/document';
import type { MirrorPlane, PatternAxis, PlaneFeature } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';
import { planeDependency } from './resolve';

export function describeBasePlane(base: MirrorPlane, names: (id: string) => string | undefined = () => undefined): string {
  if (base.kind === 'plane') return `plan ${base.plane}`;
  if (base.kind === 'datum') return names(base.featureId) ?? 'un plan de construction';
  return 'une face';
}

export function describeHinge(hinge: PatternAxis): string {
  return hinge.kind === 'axis' ? `l’axe ${hinge.axis}` : hinge.kind === 'datum' ? 'un axe de construction' : 'une arête';
}

export function planeIssues(p: PlaneFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  if (!Number.isFinite(p.offset) || Math.abs(p.offset) > 10000) issues.push({ field: 'offset', message: 'Le décalage doit être compris entre −10 000 et 10 000 mm.' });
  if (!Number.isFinite(p.angle) || Math.abs(p.angle) > 360) issues.push({ field: 'angle', message: 'L’inclinaison doit être comprise entre −360° et 360°.' });
  return issues;
}

export const planeDefinition: FeatureDefinition<PlaneFeature> = {
  type: 'plane',
  label: 'Plan',
  namePrefix: 'Plan',
  explanation: 'Plan de construction : un plan décalé ou incliné, pour dessiner une esquisse, faire une symétrie ou une découpe là où il n’y a pas de face.',
  icon: 'datum-plane',
  affectsSolid: false,
  dependencies: (feature) => {
    const p = feature.params;
    return Array.from(new Set([...planeDependency(p.base), ...(p.angle === 0 ? [] : p.hinge.kind === 'edge' ? p.hinge.edge.faces.map((x) => x.featureId) : p.hinge.kind === 'datum' ? [p.hinge.featureId] : [])]));
  },
  validate: (feature) => planeIssues(feature.params),
  summary(feature) {
    const p = feature.params;
    const parts = [describeBasePlane(p.base)];
    if (p.offset !== 0) parts.push(`décalé de ${formatLength(p.offset)}`);
    if (p.angle !== 0) parts.push(`incliné de ${formatNumber(p.angle, 2)}° autour de ${describeHinge(p.hinge)}`);
    return parts.join(', ');
  },
  tool: {
    input: 'part',
    requiresSolid: false,
    previewKind: 'modify',
    create: (doc, part) => makePlaneFeature(doc, part),
    initialFields: (feature) => ({ offset: formatLength(feature.params.offset, 3, false), angle: formatNumber(feature.params.angle, 3) }),
  },
};
