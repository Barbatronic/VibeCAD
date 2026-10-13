import { makeMoveFeature } from '../../domain/document';
import type { MoveFeature } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

export function moveIssues(p: MoveFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  const finite = (v: number) => Number.isFinite(v) && Math.abs(v) <= 100000;
  for (const k of ['x', 'y', 'z'] as const) {
    if (!finite(p.translation[k])) issues.push({ field: `t${k}`, message: 'Le décalage doit être un nombre de millimètres (au plus 100 000).' });
    if (!finite(p.center[k])) issues.push({ field: `c${k}`, message: 'Le centre de rotation doit être un nombre de millimètres.' });
  }
  if (!Number.isFinite(p.angle) || Math.abs(p.angle) > 3600) issues.push({ field: 'angle', message: 'L’angle doit être compris entre −3 600° et 3 600°.' });
  return issues;
}

/** Vrai si le déplacement ne fait rien. */
export function isIdentityMove(p: MoveFeature['params']): boolean {
  return p.translation.x === 0 && p.translation.y === 0 && p.translation.z === 0 && p.angle % 360 === 0;
}

export const moveDefinition: FeatureDefinition<MoveFeature> = {
  type: 'move',
  label: 'Déplacer',
  namePrefix: 'Déplacement',
  explanation: 'Déplacer : faire glisser la pièce et/ou la faire pivoter autour d’un axe X, Y ou Z ; ou en ajouter une copie déplacée.',
  icon: 'move',
  affectsSolid: true,
  dependencies: () => [],
  validate: (feature) => moveIssues(feature.params),
  summary(feature) {
    const p = feature.params;
    const parts: string[] = [];
    if (p.angle % 360 !== 0) parts.push(`${formatNumber(p.angle, 2)}° autour de ${p.axis}`);
    const t = p.translation;
    if (t.x || t.y || t.z) parts.push(`décalage ${formatNumber(t.x, 2)} ; ${formatNumber(t.y, 2)} ; ${formatLength(t.z)}`);
    return `${parts.join(', ') || 'aucun déplacement'}${p.copy ? ' (copie)' : ''}`;
  },
  tool: {
    input: 'part',
    requiresSolid: true,
    previewKind: 'modify',
    create: (doc, part) => makeMoveFeature(doc, part),
    initialFields: (feature) => {
      const t = (v: number) => String(v).replace('.', ',');
      const p = feature.params;
      return { tx: t(p.translation.x), ty: t(p.translation.y), tz: t(p.translation.z), angle: t(p.angle), cx: t(p.center.x), cy: t(p.center.y), cz: t(p.center.z) };
    },
  },
};
