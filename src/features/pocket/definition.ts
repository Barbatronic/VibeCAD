import { makePocketFeature } from '../../domain/document';
import type { ExtentDirection, PocketFeature } from '../../domain/model';
import { formatLength } from '../../domain/units';
import { signedDistanceToFrame } from '../../math/frame';
import type { CreateContext, FeatureDefinition, ParamIssue } from '../definition';
import { validateDistance } from '../extrude/definition';

export const POCKET_DIRECTION_LABELS: Record<ExtentDirection, string> = {
  default: 'Dans la matière',
  reversed: 'Côté opposé',
  symmetric: 'Symétrique',
};

/**
 * Sens par défaut d'une nouvelle poche : vers la matière de la pièce. Le choix est enregistré
 * comme un paramètre visible et modifiable (jamais réévalué en silence).
 */
export function defaultPocketDirection(context: CreateContext): ExtentDirection {
  const { sketchFrame: frame, partBounds: bbox } = context;
  if (!frame || !bbox) return 'default';
  let min = Infinity;
  let max = -Infinity;
  for (const x of [bbox.min.x, bbox.max.x])
    for (const y of [bbox.min.y, bbox.max.y])
      for (const z of [bbox.min.z, bbox.max.z]) {
        const d = signedDistanceToFrame(frame, { x, y, z });
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
  const eps = 1e-6;
  if (max <= eps) return 'default';
  if (min >= -eps) return 'reversed';
  return 'symmetric';
}

export const pocketDefinition: FeatureDefinition<PocketFeature> = {
  type: 'pocket',
  label: 'Poche',
  namePrefix: 'Poche',
  explanation: 'Poche : retirer de la matière en suivant le dessin (un perçage est une poche ronde).',
  icon: 'pocket',
  affectsSolid: true,
  dependencies: (feature) => [feature.params.sketchId],
  validate(feature) {
    const issues: ParamIssue[] = [];
    if (feature.params.extent.kind === 'distance') {
      const d = validateDistance(feature.params.extent.distance, 'La profondeur');
      if (d) issues.push({ field: 'distance', message: d });
    }
    if (!feature.params.sketchId) issues.push({ field: 'sketchId', message: 'Choisissez une esquisse.' });
    return issues;
  },
  summary(feature) {
    const extent = feature.params.extent.kind === 'throughAll' ? 'traversante' : formatLength(feature.params.extent.distance);
    const dir = feature.params.direction === 'default' ? '' : `, ${POCKET_DIRECTION_LABELS[feature.params.direction].toLowerCase()}`;
    return `${extent}${dir}`;
  },
  tool: {
    input: 'sketch',
    requiresSolid: true,
    requiresSolidReason: 'Une poche retire de la matière : créez d’abord un volume avec une extrusion.',
    previewKind: 'cut',
    create: (doc, part, input, context) =>
      makePocketFeature(doc, part, input.kind === 'sketch' ? input.sketchId : '', { kind: 'throughAll' }, defaultPocketDirection(context)),
    initialFields: (feature) => ({
      distance: formatLength(feature.params.extent.kind === 'distance' ? feature.params.extent.distance : 5, 3, false),
    }),
  },
};
