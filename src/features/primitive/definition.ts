import { makePrimitiveFeature } from '../../domain/document';
import type { PrimitiveFeature, PrimitiveShape } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';

export const PRIMITIVE_LABELS: Record<PrimitiveShape, string> = {
  box: 'Boîte',
  cylinder: 'Cylindre',
  sphere: 'Boule',
  torus: 'Anneau',
  cone: 'Cône',
  pyramid: 'Pyramide',
  prism: 'Prisme',
  wedge: 'Rampe',
};

export const PRIMITIVE_EXPLANATIONS: Record<PrimitiveShape, string> = {
  box: 'Largeur, profondeur et hauteur',
  cylinder: 'Diamètre et hauteur',
  sphere: 'Diamètre',
  torus: 'Diamètre et épaisseur du tube',
  cone: 'Diamètre du bas, du haut (0 : pointe) et hauteur',
  pyramid: 'Nombre de côtés, diamètre de la base, du haut (0 : pointe) et hauteur',
  prism: 'Nombre de côtés, diamètre et hauteur (hexagone, octogone…)',
  wedge: 'Longueur de la pente, largeur et hauteur',
};

export type PrimitiveField = 'width' | 'depth' | 'height' | 'diameter' | 'topDiameter' | 'thickness';

/** Dimensions utiles de chaque forme (les autres sont ignorées). */
export const PRIMITIVE_FIELDS: Record<PrimitiveShape, PrimitiveField[]> = {
  box: ['width', 'depth', 'height'],
  cylinder: ['diameter', 'height'],
  sphere: ['diameter'],
  torus: ['diameter', 'thickness'],
  cone: ['diameter', 'topDiameter', 'height'],
  pyramid: ['diameter', 'topDiameter', 'height'],
  prism: ['diameter', 'height'],
  wedge: ['width', 'depth', 'height'],
};

/** Formes à base polygonale (nombre de côtés réglable). */
export const POLYGON_SHAPES: readonly PrimitiveShape[] = ['pyramid', 'prism'];

export const PRIMITIVE_FIELD_LABELS: Record<PrimitiveField, string> = {
  width: 'Largeur (X)',
  depth: 'Profondeur (Y)',
  height: 'Hauteur (Z)',
  diameter: 'Diamètre',
  topDiameter: 'Diamètre du haut',
  thickness: 'Épaisseur du tube',
};

/** Libellé d'une dimension selon la forme (pyramide, prisme : diamètre du cercle passant par les sommets). */
export function primitiveFieldLabel(shape: PrimitiveShape, field: PrimitiveField): string {
  if (field === 'diameter' && (shape === 'cone' || shape === 'pyramid')) return 'Diamètre du bas';
  if (field === 'diameter' && shape === 'prism') return 'Diamètre (sur les sommets)';
  if (field === 'width' && shape === 'wedge') return 'Longueur de la pente (X)';
  return PRIMITIVE_FIELD_LABELS[field];
}

/**
 * Hauteur d'une pyramide régulière (toutes les arêtes égales au côté de la base) : √(c² − R²),
 * c = 2R·sin(π/n). Null au-delà de 5 côtés (la pyramide serait plate ou impossible).
 */
export function regularPyramidHeight(sides: number, diameter: number): number | null {
  const r = diameter / 2;
  const side = 2 * r * Math.sin(Math.PI / sides);
  const h2 = side * side - r * r;
  return sides >= 3 && sides <= 5 && h2 > 0 ? Math.sqrt(h2) : null;
}

/** Dimensions réellement construites : pyramide régulière, hauteur calculée et pointe. */
export function effectivePrimitive<P extends PrimitiveFeature['params']>(p: P): P {
  if (p.shape !== 'pyramid' || !p.regular) return p;
  const h = regularPyramidHeight(primitiveSides(p), p.diameter);
  return h === null ? p : { ...p, height: Math.round(h * 1e6) / 1e6, topDiameter: 0 };
}

/** Nombre de côtés d'une pyramide ou d'un prisme (4 et 6 par défaut). */
export function primitiveSides(p: Pick<PrimitiveFeature['params'], 'shape' | 'sides'>): number {
  return p.sides ?? (p.shape === 'prism' ? 6 : 4);
}

export function primitiveIssues(p: PrimitiveFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  for (const field of PRIMITIVE_FIELDS[p.shape]) {
    const v = field === 'topDiameter' ? (p.topDiameter ?? 0) : p[field];
    const label = primitiveFieldLabel(p.shape, field);
    // Le haut d'un cône ou d'une pyramide peut être nul (pointe).
    if (field === 'topDiameter' ? !Number.isFinite(v) || v < 0 : !Number.isFinite(v) || v <= 0) issues.push({ field, message: field === 'topDiameter' ? `${label} ne peut pas être négatif (0 : pointe).` : `${label} doit être supérieur(e) à 0 mm.` });
    else if (v > 10000) issues.push({ field, message: `${label} ne doit pas dépasser 10 000 mm.` });
  }
  if (POLYGON_SHAPES.includes(p.shape)) {
    const n = primitiveSides(p);
    if (!Number.isInteger(n) || n < 3 || n > 24) issues.push({ field: 'sides', message: 'Le nombre de côtés doit être un entier de 3 à 24.' });
    else if (p.shape === 'pyramid' && p.regular && n > 5) issues.push({ field: 'sides', message: 'Une pyramide régulière a au plus 5 côtés : à partir de 6, des arêtes toutes égales la rendraient plate.' });
  }
  if (p.shape === 'torus' && p.thickness >= p.diameter) issues.push({ field: 'thickness', message: 'L’épaisseur du tube doit être plus petite que le diamètre de l’anneau.' });
  return issues;
}

export const primitiveDefinition: FeatureDefinition<PrimitiveFeature> = {
  type: 'primitive',
  label: 'Forme',
  namePrefix: 'Forme',
  explanation: 'Forme toute faite : boîte, cylindre, boule, anneau, cône, pyramide, prisme ou rampe, à ajouter à la pièce ou à creuser dedans.',
  icon: 'primitive',
  affectsSolid: true,
  dependencies: () => [],
  validate: (feature) => primitiveIssues(feature.params),
  summary(feature) {
    const p = effectivePrimitive(feature.params);
    const n = (v: number) => formatNumber(v, 2);
    const top = p.topDiameter ?? 0;
    const dims =
      p.shape === 'box' || p.shape === 'wedge'
        ? `${n(p.width)} × ${n(p.depth)} × ${formatLength(p.height)}`
        : p.shape === 'cylinder'
          ? `Ø ${n(p.diameter)} × ${formatLength(p.height)}`
          : p.shape === 'sphere'
            ? `Ø ${formatLength(p.diameter)}`
            : p.shape === 'cone' || p.shape === 'pyramid'
              ? `${p.shape === 'pyramid' ? `${p.regular ? 'régulière, ' : ''}${primitiveSides(p)} côtés, ` : ''}Ø ${n(p.diameter)}${top > 0 ? ` → ${n(top)}` : ''} × ${formatLength(p.height)}`
              : p.shape === 'prism'
                ? `${primitiveSides(p)} côtés, Ø ${n(p.diameter)} × ${formatLength(p.height)}`
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
        topDiameter: t(p.topDiameter ?? 0),
        sides: String(primitiveSides(p)),
        x: t(p.position.x),
        y: t(p.position.y),
        z: t(p.position.z),
      };
    },
  },
};
