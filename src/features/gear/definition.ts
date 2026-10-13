import { GEAR_NAMES, makeGearFeature } from '../../domain/document';
import type { GearFeature, GearKind } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';
import { BELT_PROFILES, pulleyOutsideDiameter, spurGeometry } from './profiles';

export const GEAR_EXPLANATIONS: Record<GearKind, string> = {
  spur: 'Roue dentée droite (denture en développante de cercle). Deux roues de même module engrènent ; leur entraxe vaut module × (dents 1 + dents 2) / 2.',
  rack: 'Crémaillère : une barre dentée qui transforme la rotation d’une roue de même module en déplacement en ligne droite.',
  pulley: 'Poulie crantée pour courroie GT2 ou T (imprimantes 3D, robots). Le diamètre vient du nombre de dents et du pas de la courroie.',
};

/** Modules courants (série ISO 54) proposés dans le panneau. */
export const COMMON_MODULES = [0.5, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];

export function gearIssues(p: GearFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  const minTeeth = p.kind === 'rack' ? 1 : p.kind === 'pulley' ? 8 : 6;
  if (!Number.isInteger(p.teeth) || p.teeth < minTeeth || p.teeth > 300) issues.push({ field: 'teeth', message: `Le nombre de dents doit être un entier entre ${minTeeth} et 300.` });
  if (!(p.thickness > 0) || p.thickness > 1000) issues.push({ field: 'thickness', message: 'L’épaisseur doit être comprise entre 0 et 1 000 mm.' });
  if (p.kind !== 'pulley') {
    if (!(p.module >= 0.2) || p.module > 50) issues.push({ field: 'module', message: 'Le module doit être compris entre 0,2 et 50 mm.' });
    if (!(p.pressureAngle >= 14.5) || p.pressureAngle > 30) issues.push({ field: 'pressureAngle', message: 'L’angle de pression doit être compris entre 14,5° et 30° (20° en général).' });
  }
  if (p.kind === 'rack' && (!(p.rackHeight > 0) || p.rackHeight > 1000)) issues.push({ field: 'rackHeight', message: 'La hauteur du corps doit être supérieure à 0 mm.' });
  if (p.kind !== 'rack' && (p.bore < 0 || !Number.isFinite(p.bore))) issues.push({ field: 'bore', message: 'L’alésage doit être positif (0 : pas d’alésage).' });
  // L'alésage doit laisser de la matière sous les dents.
  const inner = p.kind === 'spur' ? spurGeometry(p.module, p.teeth, p.pressureAngle).root : p.kind === 'pulley' ? pulleyOutsideDiameter(p.belt, p.teeth) - 2 * BELT_PROFILES[p.belt].depth : Infinity;
  if (p.kind !== 'rack' && p.bore > 0 && p.bore >= inner - 1) issues.push({ field: 'bore', message: `L’alésage est trop grand : il doit rester sous le pied des dents (moins de ${formatNumber(inner - 1, 1)} mm).` });
  return issues;
}

/** Ce qui décrit la pièce générée (historique, panneau). */
export function gearSummary(p: GearFeature['params']): string {
  const n = (v: number) => formatNumber(v, 2);
  if (p.kind === 'spur') return `m ${n(p.module)}, ${p.teeth} dents, Ø ${n(spurGeometry(p.module, p.teeth, p.pressureAngle).tip)} × ${formatLength(p.thickness)}`;
  if (p.kind === 'rack') return `m ${n(p.module)}, ${p.teeth} dents, ${formatLength(p.teeth * Math.PI * p.module)} de long`;
  return `${BELT_PROFILES[p.belt].label}, ${p.teeth} dents, Ø ${n(pulleyOutsideDiameter(p.belt, p.teeth))} × ${formatLength(p.thickness)}`;
}

export const gearDefinition: FeatureDefinition<GearFeature> = {
  type: 'gear',
  label: 'Engrenage',
  namePrefix: 'Engrenage',
  explanation: 'Générateur : roue dentée, crémaillère ou poulie crantée, calculée à partir de quelques nombres (module, dents, courroie).',
  icon: 'gear',
  affectsSolid: true,
  dependencies: () => [],
  validate: (feature) => gearIssues(feature.params),
  summary(feature) {
    return `${GEAR_NAMES[feature.params.kind]} ${gearSummary(feature.params)}${feature.params.operation === 'cut' ? ' (creusée)' : ''}`;
  },
  tool: {
    input: 'part',
    requiresSolid: false,
    previewKind: 'modify',
    create: (doc, part) => makeGearFeature(doc, part),
    initialFields: (feature) => {
      const t = (v: number) => String(v).replace('.', ',');
      const p = feature.params;
      return {
        module: t(p.module),
        pressureAngle: t(p.pressureAngle),
        teeth: String(p.teeth),
        thickness: t(p.thickness),
        bore: t(p.bore),
        rackHeight: t(p.rackHeight),
        x: t(p.position.x),
        y: t(p.position.y),
        z: t(p.position.z),
      };
    },
  },
};
