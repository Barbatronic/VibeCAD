import type { ImageFeature } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

export const imageDefinition: FeatureDefinition<ImageFeature> = {
  type: 'image',
  label: 'Image',
  namePrefix: 'Image',
  explanation: 'Image : poser une photo ou un plan scanné sur un plan, à la bonne taille, pour redessiner la pièce par-dessus dans une esquisse.',
  icon: 'image',
  affectsSolid: false,
  dependencies: (feature) => {
    const s = feature.params.support;
    return s.kind === 'face' ? [s.ref.featureId] : s.kind === 'datum' ? [s.featureId] : [];
  },
  validate(feature) {
    const p = feature.params;
    const issues: ParamIssue[] = [];
    if (!p.resourceId) issues.push({ field: 'resourceId', message: 'Choisissez une image.' });
    if (!Number.isFinite(p.width) || p.width <= 0 || p.width > 100_000) issues.push({ field: 'width', message: 'La largeur doit être positive (au plus 100 m).' });
    if (!(p.opacity >= 0.05 && p.opacity <= 1)) issues.push({ field: 'opacity', message: 'L’opacité doit être entre 5 et 100 %.' });
    return issues;
  },
  summary: (feature) => `largeur ${formatLength(feature.params.width)}${feature.params.rotation ? `, ${formatNumber(feature.params.rotation, 1)}°` : ''}${feature.params.perspective ? ', redressée' : ''}`,
  tool: {
    input: 'part',
    requiresSolid: false,
    previewKind: 'modify',
    // La création passe par le choix du fichier (contrôleur, `startImage`).
    create: () => {
      throw new Error('Une image se crée avec le choix de son fichier.');
    },
    initialFields: (feature) => ({
      width: formatLength(feature.params.width, 3, false),
      cx: formatLength(feature.params.center.x, 3, false),
      cy: formatLength(feature.params.center.y, 3, false),
      rotation: formatNumber(feature.params.rotation, 3),
    }),
  },
};
