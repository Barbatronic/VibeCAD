import { makeHoleFeature } from '../../domain/document';
import { HOLE_HEADS, HOLES, nominal } from '../../domain/fasteners';
import type { HoleFeature, HoleFit, HoleKind } from '../../domain/model';
import type { MetricSize } from '../../domain/fasteners';
import { formatLength, formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';
import { validateDistance } from '../extrude/definition';
import { defaultPocketDirection } from '../pocket/definition';

export const HOLE_KIND_LABELS: Record<HoleKind, string> = {
  clearance: 'Passage',
  counterbore: 'Lamé',
  countersink: 'Fraisé',
  tapped: 'Fileté',
};

export const HOLE_KIND_HELP: Record<HoleKind, string> = {
  clearance: 'Trou de passage : la vis traverse librement et se serre avec un écrou ou dans la pièce suivante.',
  counterbore: 'Trou lamé : un logement cylindrique cache la tête d’une vis CHC (tête cylindrique, ISO 4762).',
  countersink: 'Trou fraisé : un cône à 90° reçoit la tête d’une vis FHC (tête fraisée, ISO 10642), qui affleure.',
  tapped: 'Trou fileté : plus petit que la vis, pour qu’elle se visse dans la pièce. Au taraud (on fait le filet avant), ou directement dans le plastique imprimé (la vis forme son filet).',
};

export const HOLE_FIT_LABELS: Record<HoleFit, string> = { none: 'Sans jeu', fine: 'Serré', medium: 'Normal', coarse: 'Large', custom: 'Au choix' };

/** Perçage d'un trou où la vis forme son filet dans le plastique imprimé : 0,9 × d, au dixième. */
export function plasticThreadDiameter(size: MetricSize): number {
  return Math.round(0.9 * nominal(size) * 10) / 10;
}

/** Diamètre du trou : diamètre libre, série ISO 273 choisie, ou perçage avant taraudage. */
export function holeDiameter(p: HoleFeature['params']): number {
  if (p.size === 'custom') return p.diameter ?? 5;
  if (p.kind === 'tapped') return p.thread === 'plastic' ? plasticThreadDiameter(p.size) : HOLES[p.size].tap;
  if (p.fit === 'none') return nominal(p.size);
  return p.fit === 'custom' ? nominal(p.size) + (p.clearance ?? 0.3) : HOLES[p.size][p.fit];
}

/**
 * Logement de tête proposé pour ce type de trou : celui de la norme pour une vis métrique ; pour un
 * diamètre libre, un lamage de 1,8 × d + 0,5 mm sur d de profondeur, une fraisure de 2 × d.
 */
export function standardHead(kind: HoleKind, size: HoleFeature['params']['size'], diameter = 5): { headDiameter: number; headDepth: number } {
  const round = (v: number) => Math.round(v * 10) / 10;
  if (size === 'custom') return kind === 'countersink' ? { headDiameter: round(2 * diameter), headDepth: round(diameter / 2) } : { headDiameter: round(1.8 * diameter + 0.5), headDepth: round(diameter) };
  const h = HOLE_HEADS[size];
  return kind === 'countersink' ? { headDiameter: h.countersink, headDepth: (h.countersink - nominal(size)) / 2 } : { headDiameter: h.counterbore, headDepth: h.counterboreDepth };
}

export function holeIssues(p: HoleFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  if (p.size === 'custom' && !(p.diameter !== undefined && p.diameter > 0 && p.diameter <= 500)) issues.push({ field: 'diameter', message: 'Le diamètre du perçage doit être compris entre 0 et 500 mm.' });
  if (p.size !== 'custom' && p.kind !== 'tapped' && p.fit === 'custom' && !(p.clearance !== undefined && p.clearance >= -1 && p.clearance <= 5))
    issues.push({ field: 'clearance', message: 'Le jeu doit être compris entre −1 et 5 mm.' });
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
  explanation: 'Perçage : un trou aux dimensions d’une vis (M3, M4…) ou d’un diamètre choisi, de passage, lamé, fraisé ou à tarauder, à chaque point et au centre de chaque cercle de l’esquisse.',
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
    const size = p.size === 'custom' ? (p.kind === 'clearance' ? '' : `Ø ${formatNumber(holeDiameter(p), 2)} `) : `${p.size} `;
    return `${size}${kind}, ${p.through ? 'traversant' : formatLength(p.depth)}`;
  },
  tool: {
    input: 'sketch',
    requiresSolid: true,
    requiresSolidReason: 'Un perçage retire de la matière : créez d’abord un volume avec une extrusion.',
    previewKind: 'cut',
    create: (doc, part, input, context) => makeHoleFeature(doc, part, input.kind === 'sketch' ? input.sketchId : '', defaultPocketDirection(context) === 'reversed'),
    initialFields: (feature) => ({
      depth: formatLength(feature.params.depth, 3, false),
      diameter: formatLength(feature.params.diameter ?? 5, 3, false),
      clearance: formatLength(feature.params.clearance ?? 0.3, 3, false),
      headDiameter: formatLength(feature.params.headDiameter, 3, false),
      headDepth: formatLength(feature.params.headDepth, 3, false),
    }),
  },
};
