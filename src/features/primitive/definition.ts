import { makePrimitiveFeature } from '../../domain/document';
import type { PrimitiveFeature, PrimitiveShape } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

export const PRIMITIVE_LABELS: Record<PrimitiveShape, string> = { box: 'Boîte', cylinder: 'Cylindre', sphere: 'Boule', torus: 'Anneau' };

export const PRIMITIVE_EXPLANATIONS: Record<PrimitiveShape, string> = {
  box: 'Un pavé : largeur, profondeur et hauteur. Comme une brique de jeu de construction.',
  cylinder: 'Un rouleau : diamètre et hauteur. Comme une pile, un plot ou, creusé, un trou rond.',
  sphere: 'Une boule : son diamètre. Pour une rotule, une perle, un bouton.',
  torus: 'Un anneau : diamètre et épaisseur du tube. Comme une bouée ou un joint.',
};

/** Dimensions utiles de chaque forme (les autres sont ignorées). */
export const PRIMITIVE_FIELDS: Record<PrimitiveShape, ('width' | 'depth' | 'height' | 'diameter' | 'thickness')[]> = {
  box: ['width', 'depth', 'height'],
  cylinder: ['diameter', 'height'],
  sphere: ['diameter'],
  torus: ['diameter', 'thickness'],
};

export const PRIMITIVE_FIELD_LABELS: Record<'width' | 'depth' | 'height' | 'diameter' | 'thickness', string> = {
  width: 'Largeur (X)',
  depth: 'Profondeur (Y)',
  height: 'Hauteur (Z)',
  diameter: 'Diamètre',
  thickness: 'Épaisseur du tube',
};

export function primitiveIssues(p: PrimitiveFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  for (const field of PRIMITIVE_FIELDS[p.shape]) {
    const v = p[field];
    if (!Number.isFinite(v) || v <= 0) issues.push({ field, message: `${PRIMITIVE_FIELD_LABELS[field]} doit être supérieur(e) à 0 mm.` });
    else if (v > 10000) issues.push({ field, message: `${PRIMITIVE_FIELD_LABELS[field]} ne doit pas dépasser 10 000 mm.` });
  }
  if (p.shape === 'torus' && p.thickness >= p.diameter) issues.push({ field: 'thickness', message: 'L’épaisseur du tube doit être plus petite que le diamètre de l’anneau.' });
  return issues;
}

export const primitiveDefinition: FeatureDefinition<PrimitiveFeature> = {
  type: 'primitive',
  label: 'Forme',
  namePrefix: 'Forme',
  explanation: 'Forme toute faite : une boîte, un cylindre, une boule ou un anneau, à ajouter à la pièce ou à creuser dedans.',
  icon: 'primitive',
  affectsSolid: true,
  dependencies: () => [],
  validate: (feature) => primitiveIssues(feature.params),
  summary(feature) {
    const p = feature.params;
    const n = (v: number) => formatNumber(v, 2);
    const dims =
      p.shape === 'box'
        ? `${n(p.width)} × ${n(p.depth)} × ${formatLength(p.height)}`
        : p.shape === 'cylinder'
          ? `Ø ${n(p.diameter)} × ${formatLength(p.height)}`
          : p.shape === 'sphere'
            ? `Ø ${formatLength(p.diameter)}`
            : `Ø ${n(p.diameter)}, tube ${formatLength(p.thickness)}`;
    return `${PRIMITIVE_LABELS[p.shape]} ${dims}${p.operation === 'cut' ? ' (creusée)' : ''}`;
  },
  tool: {
    input: 'part',
    requiresSolid: false,
    previewKind: 'modify',
    create: (doc, part) => makePrimitiveFeature(doc, part),
    initialFields: (feature) => {
      const t = (v: number) => String(v).replace('.', ',');
      const p = feature.params;
      return {
        width: t(p.width),
        depth: t(p.depth),
        height: t(p.height),
        diameter: t(p.diameter),
        thickness: t(p.thickness),
        x: t(p.position.x),
        y: t(p.position.y),
        z: t(p.position.z),
      };
    },
  },
};
