import { makeHoleFeature } from '../../domain/document';
import { HOLE_HEADS, HOLES, nominal } from '../../domain/fasteners';
import type { HoleFeature, HoleFit, HoleKind } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';
import { validateDistance } from '../extrude/definition';
import { defaultPocketDirection } from '../pocket/definition';

export const HOLE_KIND_LABELS: Record<HoleKind, string> = {
  clearance: 'Passage',
  counterbore: 'Lamé',
  countersink: 'Fraisé',
  tapped: 'À tarauder',
};

export const HOLE_KIND_HELP: Record<HoleKind, string> = {
  clearance: 'Trou de passage : la vis traverse librement et se serre avec un écrou ou dans la pièce suivante.',
  counterbore: 'Trou lamé : un logement cylindrique cache la tête d’une vis CHC (tête cylindrique, ISO 4762).',
  countersink: 'Trou fraisé : un cône à 90° reçoit la tête d’une vis FHC (tête fraisée, ISO 10642), qui affleure.',
  tapped: 'Trou à tarauder : diamètre de perçage avant de faire le filetage au taraud (ou pour visser directement dans le plastique).',
};

export const HOLE_FIT_LABELS: Record<HoleFit, string> = { fine: 'Serré', medium: 'Normal', coarse: 'Large' };

/** Diamètre du trou (corps de la vis) : série ISO 273 choisie, ou perçage avant taraudage. */
export function holeDiameter(p: HoleFeature['params']): number {
  return p.kind === 'tapped' ? HOLES[p.size].tap : HOLES[p.size][p.fit];
}

/** Logement de tête proposé par la norme pour ce type de trou et cette taille de vis. */
export function standardHead(kind: HoleKind, size: HoleFeature['params']['size']): { headDiameter: number; headDepth: number } {
  const h = HOLE_HEADS[size];
  return kind === 'countersink' ? { headDiameter: h.countersink, headDepth: (h.countersink - nominal(size)) / 2 } : { headDiameter: h.counterbore, headDepth: h.counterboreDepth };
}

export function holeIssues(p: HoleFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  if (!p.through) {
    const d = validateDistance(p.depth, 'La profondeur');
    if (d) issues.push({ field: 'depth', message: d });
  }
  const d = holeDiameter(p);
  if (p.kind === 'counterbore' || p.kind === 'countersink') {
    if (!(p.headDiameter > d)) issues.push({ field: 'headDiameter', message: `Le logement de la tête doit être plus large que le trou (${formatLength(d)}).` });
    else if (p.headDiameter > 200) issues.push({ field: 'headDiameter', message: 'Le logement de la tête doit faire au plus 200 mm.' });
  }
  if (p.kind === 'counterbore') {
    const e = validateDistance(p.headDepth, 'La profondeur du lamage');
    if (e) issues.push({ field: 'headDepth', message: e });
    else if (!p.through && p.headDepth >= p.depth) issues.push({ field: 'headDepth', message: 'Le lamage doit être moins profond que le trou.' });
  }
  return issues;
}

export const holeDefinition: FeatureDefinition<HoleFeature> = {
  type: 'hole',
  label: 'Perçage',
  namePrefix: 'Perçage',
  explanation: 'Perçage : un trou aux dimensions d’une vis (M3, M4…), de passage, lamé, fraisé ou à tarauder, au centre de chaque cercle de l’esquisse.',
  icon: 'hole',
  affectsSolid: true,
  dependencies: (feature) => [feature.params.sketchId],
  validate(feature) {
    const issues = holeIssues(feature.params);
    if (!feature.params.sketchId) issues.push({ field: 'sketchId', message: 'Choisissez une esquisse.' });
    return issues;
  },
  summary(feature) {
    const p = feature.params;
    const kind = p.kind === 'clearance' ? `Ø ${formatNumber(holeDiameter(p), 2)}` : HOLE_KIND_LABELS[p.kind].toLowerCase();
    return `${p.size} ${kind}, ${p.through ? 'traversant' : formatLength(p.depth)}`;
  },
  tool: {
    input: 'sketch',
    requiresSolid: true,
    requiresSolidReason: 'Un perçage retire de la matière : créez d’abord un volume avec une extrusion.',
    previewKind: 'cut',
    create: (doc, part, input, context) => makeHoleFeature(doc, part, input.kind === 'sketch' ? input.sketchId : '', defaultPocketDirection(context) === 'reversed'),
    initialFields: (feature) => ({
      depth: formatLength(feature.params.depth, 3, false),
      headDiameter: formatLength(feature.params.headDiameter, 3, false),
      headDepth: formatLength(feature.params.headDepth, 3, false),
    }),
  },
};
