import { makeBeamFeature } from '../../domain/document';
import type { BeamFeature } from '../../domain/model';
import { formatLength } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';
import { BEAM_SIZES, BEAM_SYSTEMS, beamLabel } from './profiles';

export function beamIssues(p: BeamFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  if (!BEAM_SIZES.includes(p.size)) issues.push({ field: 'size', message: 'Section inconnue.' });
  if (!(p.length > 0) || p.length > 10000) issues.push({ field: 'length', message: 'La longueur doit être comprise entre 0 et 10 000 mm.' });
  return issues;
}

export const beamDefinition: FeatureDefinition<BeamFeature> = {
  type: 'beam',
  label: 'Profilé',
  namePrefix: 'Profilé',
  explanation: 'Profilé aluminium à rainures (V-slot ou T-slot, série 20) : 20 × 20, 20 × 40, 40 × 40…',
  icon: 'beam',
  affectsSolid: true,
  dependencies: () => [],
  validate: (feature) => beamIssues(feature.params),
  summary(feature) {
    const p = feature.params;
    return `${BEAM_SYSTEMS[p.system]} ${beamLabel(p.size)}, ${formatLength(p.length)} selon ${p.axis}${p.operation === 'cut' ? ' (creusé)' : ''}`;
  },
  tool: {
    input: 'part',
    requiresSolid: false,
    previewKind: 'modify',
    create: (doc, part) => makeBeamFeature(doc, part),
    initialFields: (feature) => {
      const t = (v: number) => String(v).replace('.', ',');
      const p = feature.params;
      return { length: t(p.length), x: t(p.position.x), y: t(p.position.y), z: t(p.position.z) };
    },
  },
};
