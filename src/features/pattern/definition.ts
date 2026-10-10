import { makePatternFeature, PATTERN_SOURCE_TYPES } from '../../domain/document';
import type { Part, PatternAxis, PatternFeature } from '../../domain/model';
import { formatAngle, formatLength } from '../../domain/units';
import { edgeDependencies } from '../blend-common';
import type { FeatureDefinition, ParamIssue } from '../definition';

/** Nombre maximal d'exemplaires d'une répétition (grille comprise). */
export const PATTERN_MAX_COPIES = 200;

export function describePatternAxis(axis: PatternAxis): string {
  return axis.kind === 'axis' ? `l’axe ${axis.axis}` : 'une arête';
}

export function validatePatternCount(count: number): string | null {
  if (!Number.isInteger(count)) return 'Le nombre d’exemplaires doit être un nombre entier.';
  if (count < 2) return 'Il faut au moins 2 exemplaires (l’original compris).';
  if (count > 100) return 'Pas plus de 100 exemplaires dans une direction.';
  return null;
}

export function validatePatternSpacing(spacing: number): string | null {
  if (!Number.isFinite(spacing) || spacing <= 0) return 'L’espacement doit être supérieur à 0 mm.';
  if (spacing > 10000) return 'L’espacement ne doit pas dépasser 10 000 mm.';
  return null;
}

export function validatePatternAngle(angle: number): string | null {
  if (!Number.isFinite(angle) || angle <= 0 || angle > 360) return 'L’angle total doit être compris entre 0° (exclu) et 360°.';
  return null;
}

/** Dernière étape que la répétition peut copier (la plus récente extrusion, poche ou révolution). */
export function defaultPatternSource(part: Part): string {
  return [...part.features].reverse().find((f) => PATTERN_SOURCE_TYPES.includes(f.type))?.id ?? '';
}

export const patternDefinition: FeatureDefinition<PatternFeature> = {
  type: 'pattern',
  label: 'Répétition',
  namePrefix: 'Répétition',
  explanation: 'Répétition : refaire plusieurs fois la même étape (un trou, un plot…), en ligne, en grille ou en cercle.',
  icon: 'pattern',
  affectsSolid: true,
  dependencies: (feature) => {
    const p = feature.params;
    const edges = [p.axis, ...(p.second ? [p.second.axis] : [])].flatMap((a) => (a.kind === 'edge' ? [a.edge] : []));
    return Array.from(new Set([p.sourceId, ...edgeDependencies(edges)].filter(Boolean)));
  },
  validate(feature) {
    const p = feature.params;
    const issues: ParamIssue[] = [];
    if (!p.sourceId) issues.push({ field: 'sourceId', message: 'Choisissez l’étape à répéter.' });
    const count = validatePatternCount(p.count);
    if (count) issues.push({ field: 'count', message: count });
    if (p.kind === 'linear') {
      const spacing = validatePatternSpacing(p.spacing);
      if (spacing) issues.push({ field: 'spacing', message: spacing });
      if (p.second) {
        const c2 = validatePatternCount(p.second.count);
        if (c2) issues.push({ field: 'count2', message: c2 });
        const s2 = validatePatternSpacing(p.second.spacing);
        if (s2) issues.push({ field: 'spacing2', message: s2 });
        if (!c2 && !count && p.count * p.second.count > PATTERN_MAX_COPIES) {
          issues.push({ field: 'count2', message: `Pas plus de ${PATTERN_MAX_COPIES} exemplaires en tout.` });
        }
      }
    } else {
      const angle = validatePatternAngle(p.angle);
      if (angle) issues.push({ field: 'angle', message: angle });
    }
    return issues;
  },
  summary(feature) {
    const p = feature.params;
    if (p.kind === 'circular') {
      const angle = p.angle >= 360 ? 'tour complet' : formatAngle(p.angle);
      return `${p.count} × autour de ${describePatternAxis(p.axis)} (${angle})`;
    }
    const first = `${p.count} × ${formatLength(p.spacing)}`;
    return p.second ? `grille ${first} et ${p.second.count} × ${formatLength(p.second.spacing)}` : `${first} le long de ${describePatternAxis(p.axis)}`;
  },
  tool: {
    input: 'part',
    requiresSolid: true,
    requiresSolidReason: 'Une répétition copie une étape qui a créé ou retiré un volume : faites d’abord une extrusion, une poche ou une révolution.',
    previewKind: 'modify',
    create: (doc, part) => makePatternFeature(doc, part, defaultPatternSource(part)),
    initialFields: (feature) => {
      const t = (v: number) => String(v).replace('.', ',');
      const p = feature.params;
      return {
        count: String(p.count),
        spacing: t(p.spacing),
        angle: t(p.angle),
        ...(p.second ? { count2: String(p.second.count), spacing2: t(p.second.spacing) } : {}),
      };
    },
  },
};
