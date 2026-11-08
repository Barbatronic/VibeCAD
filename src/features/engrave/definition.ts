import { makeEngraveFeature } from '../../domain/document';
import type { EngraveFeature } from '../../domain/model';
import { formatLength } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

/** Profondeur maximale d'une gravure (au-delà, c'est une poche). */
export const MAX_ENGRAVE_DEPTH = 5;

export const engraveDefinition: FeatureDefinition<EngraveFeature> = {
  type: 'engrave',
  label: 'Gravure',
  namePrefix: 'Gravure',
  explanation:
    'Gravure : marquer le dessin d’une esquisse sur une face (texte, tampon, motif). En découpe laser, il est gravé au lieu d’être découpé ; avec une profondeur, il est aussi creusé.',
  icon: 'engrave',
  affectsSolid: true,
  dependencies: (feature) => [feature.params.sketchId],
  validate(feature) {
    const issues: ParamIssue[] = [];
    const d = feature.params.depth;
    if (!Number.isFinite(d) || d < 0) issues.push({ field: 'depth', message: 'La profondeur ne peut pas être négative (0 : marquage en surface).' });
    else if (d > MAX_ENGRAVE_DEPTH) issues.push({ field: 'depth', message: `Une gravure fait au plus ${formatLength(MAX_ENGRAVE_DEPTH)} : au-delà, utilisez une poche.` });
    if (!feature.params.sketchId) issues.push({ field: 'sketchId', message: 'Choisissez une esquisse.' });
    return issues;
  },
  summary: (feature) =>
    `${feature.params.mode === 'fill' ? 'remplissage' : 'contour'}, ${feature.params.depth > 0 ? `creusée de ${formatLength(feature.params.depth)}` : 'en surface'}`,
  tool: {
    input: 'sketch',
    requiresSolid: true,
    requiresSolidReason: 'Une gravure se fait sur une pièce : créez d’abord un volume avec une extrusion.',
    previewKind: 'cut',
    create: (doc, part, input) => makeEngraveFeature(doc, part, input.kind === 'sketch' ? input.sketchId : ''),
    initialFields: (feature) => ({ depth: formatLength(feature.params.depth, 3, false) }),
  },
};
