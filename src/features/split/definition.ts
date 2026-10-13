import { makeSplitFeature } from '../../domain/document';
import type { MirrorPlane, SplitFeature, SplitKeep } from '../../domain/model';
import { formatLength } from '../../domain/units';
import { planeDependency } from '../plane/resolve';
import type { FeatureDefinition, ParamIssue } from '../definition';

/** Écart minimal entre les deux morceaux gardés (sinon ils se recolleraient). */
export const SPLIT_MIN_GAP = 0.5;

/** Axe du plan d'origine (sa normale, toujours dans le sens positif). */
export const SPLIT_AXIS = { XY: 'z', XZ: 'y', YZ: 'x' } as const;

/** Nom de chaque côté selon le plan, pour que « dessus » ait un sens (gauche/droite, avant/arrière). */
export function splitSideLabels(plane: MirrorPlane): Record<Exclude<SplitKeep, 'both'>, string> {
  if (plane.kind === 'face') return { below: 'Côté pièce', above: 'Côté face' };
  if (plane.kind === 'datum') return { below: 'Sous le plan', above: 'Au-dessus du plan' };
  if (plane.plane === 'XY') return { below: 'Le bas', above: 'Le haut' };
  if (plane.plane === 'XZ') return { below: 'L’avant (Y−)', above: 'L’arrière (Y+)' };
  return { below: 'La gauche (X−)', above: 'La droite (X+)' };
}

export function splitIssues(p: SplitFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  if (!Number.isFinite(p.offset) || Math.abs(p.offset) > 10000) issues.push({ field: 'offset', message: 'La position du plan doit être comprise entre −10 000 et 10 000 mm.' });
  if (p.keep === 'both' && (!Number.isFinite(p.gap) || p.gap < SPLIT_MIN_GAP || p.gap > 1000))
    issues.push({ field: 'gap', message: 'L’écart entre les morceaux doit être compris entre 0,5 et 1 000 mm.' });
  return issues;
}

export const splitDefinition: FeatureDefinition<SplitFeature> = {
  type: 'split',
  label: 'Découpe',
  namePrefix: 'Découpe',
  explanation: 'Découpe : couper la pièce en deux par un plan, et garder un côté ou les deux morceaux (par exemple pour imprimer une pièce trop grande).',
  icon: 'split',
  affectsSolid: true,
  dependencies: (feature) => planeDependency(feature.params.plane),
  validate: (feature) => splitIssues(feature.params),
  summary(feature) {
    const p = feature.params;
    const plane = p.plane.kind === 'plane' ? `plan ${p.plane.plane} à ${formatLength(p.offset)}` : `${p.plane.kind === 'datum' ? 'un plan de construction' : 'une face'}, décalé${p.plane.kind === 'datum' ? '' : 'e'} de ${formatLength(p.offset)}`;
    const keep = p.keep === 'both' ? `deux morceaux écartés de ${formatLength(p.gap)}` : splitSideLabels(p.plane)[p.keep].toLowerCase();
    return `${plane} : ${keep}`;
  },
  tool: {
    input: 'part',
    requiresSolid: true,
    requiresSolidReason: 'Une découpe coupe un volume : créez d’abord une extrusion ou une forme.',
    previewKind: 'modify',
    // Plan horizontal à mi-hauteur de la pièce.
    create: (doc, part, _input, context) => {
      const b = context.partBounds;
      return makeSplitFeature(doc, part, b ? Math.round(((b.min.z + b.max.z) / 2) * 10) / 10 : 0);
    },
    initialFields: (feature) => {
      const t = (v: number) => String(v).replace('.', ',');
      return { offset: t(feature.params.offset), gap: t(feature.params.gap) };
    },
  },
};
