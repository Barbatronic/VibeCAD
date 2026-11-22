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
  if (p.along !== undefined && (!Number.isFinite(p.along) || p.along < 0 || p.along > 1)) issues.push({ field: 'along', message: 'La position doit être comprise entre 0 et 100 %.' });
  return issues;
}

export const planeDefinition: FeatureDefinition<PlaneFeature> = {
  type: 'plane',
  label: 'Plan',
  namePrefix: 'Plan',
  explanation: 'Plan de construction : décalé, incliné, au milieu de deux faces, par trois points, perpendiculaire à une arête, tangent à un cylindre… pour dessiner une esquisse, faire une symétrie ou une découpe là où il n’y a pas de face.',
  icon: 'datum-plane',
  affectsSolid: false,
  dependencies: (feature) => {
    const p = feature.params;
    const mode = p.mode ?? 'offset';
    const hinge = mode === 'offset' && p.angle !== 0 ? (p.hinge.kind === 'edge' ? p.hinge.edge.faces.map((x) => x.featureId) : p.hinge.kind === 'datum' ? [p.hinge.featureId] : []) : [];
    const base = mode === 'offset' || mode === 'midplane' || mode === 'parallelPoint' ? planeDependency(p.base) : [];
    const second = mode === 'midplane' && p.second ? planeDependency(p.second) : [];
    const points = mode === 'threePoints' || mode === 'parallelPoint' || mode === 'edgePoint' ? (p.points ?? []).flatMap((x) => (x.kind === 'edge' ? x.edge.faces.map((f) => f.featureId) : [])) : [];
    const edge = (mode === 'normalToEdge' || mode === 'tangent' || mode === 'edgePoint') && p.edge ? p.edge.faces.map((f) => f.featureId) : [];
    return Array.from(new Set([...base, ...second, ...hinge, ...points, ...edge]));
  },
  validate: (feature) => planeIssues(feature.params),
  summary(feature) {
    const p = feature.params;
    const mode = p.mode ?? 'offset';
    const shift = p.offset !== 0 ? `, décalé de ${formatLength(p.offset)}` : '';
    if (mode === 'midplane') return `milieu entre ${describeBasePlane(p.base)} et ${p.second ? describeBasePlane(p.second) : '?'}${shift}`;
    if (mode === 'threePoints') return `par trois points${shift}`;
    if (mode === 'normalToEdge') return `perpendiculaire à une arête, à ${formatNumber((p.along ?? 0) * 100, 1)} %${shift}`;
    if (mode === 'tangent') return `tangent à un cylindre, à ${formatNumber(p.angle, 2)}°${shift}`;
    if (mode === 'parallelPoint') return `parallèle à ${describeBasePlane(p.base)} par un point${shift}`;
    if (mode === 'edgePoint') return `par une arête et un point${shift}`;
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
    initialFields: (feature) => ({ offset: formatLength(feature.params.offset, 3, false), angle: formatNumber(feature.params.angle, 3), along: formatNumber((feature.params.along ?? 0) * 100, 2) }),
  },
};
