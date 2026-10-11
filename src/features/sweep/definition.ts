import { makeSweepFeature } from '../../domain/document';
import type { SketchFeature, SweepFeature } from '../../domain/model';
import type { FeatureDefinition, ParamIssue } from '../definition';

export const sweepDefinition: FeatureDefinition<SweepFeature> = {
  type: 'sweep',
  label: 'Balayage',
  namePrefix: 'Balayage',
  explanation: 'Balayage : un contour fermé qui suit un chemin, comme de la pâte qui sort d’une poche à douille : un tube coudé, une anse, un fil.',
  icon: 'sweep',
  affectsSolid: true,
  dependencies: (feature) => Array.from(new Set([feature.params.profileId, feature.params.pathId].filter(Boolean))),
  validate(feature) {
    const issues: ParamIssue[] = [];
    if (!feature.params.profileId) issues.push({ field: 'profileId', message: 'Choisissez l’esquisse du profil (un contour fermé).' });
    if (!feature.params.pathId) issues.push({ field: 'pathId', message: 'Choisissez l’esquisse du chemin.' });
    if (feature.params.profileId && feature.params.profileId === feature.params.pathId) issues.push({ field: 'pathId', message: 'Le chemin doit être dans une autre esquisse que le profil.' });
    return issues;
  },
  summary: (feature) => (feature.params.operation === 'cut' ? 'profil le long du chemin (creusé)' : 'profil le long du chemin'),
  tool: {
    input: 'sketch',
    requiresSolid: false,
    previewKind: 'modify',
    // Par défaut : le profil est l'esquisse choisie (fermée), le chemin l'esquisse précédente.
    create: (doc, part, input) => {
      const sketches = part.features.filter((f): f is SketchFeature => f.type === 'sketch').map((f) => f.id);
      const profile = input.kind === 'sketch' ? input.sketchId : (sketches[sketches.length - 1] ?? '');
      const path = sketches.filter((id) => id !== profile).at(-1) ?? '';
      return makeSweepFeature(doc, part, profile, path);
    },
    initialFields: () => ({}),
  },
};
