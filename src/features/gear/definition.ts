import { GEAR_NAMES, makeGearFeature } from '../../domain/document';
import type { GearFeature, GearKind } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import type { FeatureDefinition, ParamIssue } from '../definition';
import { BELT_PROFILES, beltLength, pitchRadius, pulleyOutsideDiameter, spurGeometry } from './profiles';

export const GEAR_EXPLANATIONS: Record<GearKind, string> = {
  spur: 'Entraxe = module × (dents 1 + dents 2) / 2',
  rack: 'Engrène avec une roue de même module',
  pulley: 'Courroie GT2 ou T',
  belt: 'Courroie fermée entre deux poulies',
};

/** Modules courants (série ISO 54) proposés dans le panneau. */
export const COMMON_MODULES = [0.5, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];

/** Courroie : seconde poulie et entraxe, avec des valeurs par défaut (poulies identiques, 3 diamètres d'écart). */
export function beltSetup(p: GearFeature['params']): { teeth2: number; centerDistance: number; length: number; teeth: number } {
  const teeth2 = p.teeth2 ?? p.teeth;
  const ra = pitchRadius(p.belt, p.teeth);
  const rb = pitchRadius(p.belt, teeth2);
  const centerDistance = p.centerDistance ?? Math.round(3 * (ra + rb));
  const length = beltLength(ra, rb, centerDistance);
  return { teeth2, centerDistance, length, teeth: length / BELT_PROFILES[p.belt].pitch };
}

export function gearIssues(p: GearFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  if (p.kind === 'belt') {
    const s = beltSetup(p);
    if (!Number.isInteger(p.teeth) || p.teeth < 8 || p.teeth > 300) issues.push({ field: 'teeth', message: 'Le nombre de dents doit être un entier entre 8 et 300.' });
    if (!Number.isInteger(s.teeth2) || s.teeth2 < 8 || s.teeth2 > 300) issues.push({ field: 'teeth2', message: 'Le nombre de dents doit être un entier entre 8 et 300.' });
    if (!(p.thickness > 0) || p.thickness > 200) issues.push({ field: 'thickness', message: 'La largeur doit être comprise entre 0 et 200 mm.' });
    // Les poulies ne doivent pas se toucher.
    const min = pulleyOutsideDiameter(p.belt, p.teeth) / 2 + pulleyOutsideDiameter(p.belt, s.teeth2) / 2 + 2;
    if (!(s.centerDistance >= min) || s.centerDistance > 10000) issues.push({ field: 'centerDistance', message: `L’entraxe doit dépasser ${formatNumber(min, 1)} mm : sinon les poulies se touchent.` });
    return issues;
  }
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
  if (p.kind === 'belt') {
    const s = beltSetup(p);
    return `${BELT_PROFILES[p.belt].label}, poulies ${p.teeth} et ${s.teeth2} dents, entraxe ${formatLength(s.centerDistance)}, ${formatNumber(s.teeth, 1)} dents`;
  }
  return `${BELT_PROFILES[p.belt].label}, ${p.teeth} dents, Ø ${n(pulleyOutsideDiameter(p.belt, p.teeth))} × ${formatLength(p.thickness)}`;
}

export const gearDefinition: FeatureDefinition<GearFeature> = {
  type: 'gear',
  label: 'Engrenage',
  namePrefix: 'Engrenage',
  explanation: 'Générateur : roue dentée, crémaillère, poulie crantée ou courroie, calculée à partir de quelques nombres (module, dents, courroie).',
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
        teeth2: String(beltSetup(p).teeth2),
        centerDistance: t(beltSetup(p).centerDistance),
        x: t(p.position.x),
        y: t(p.position.y),
        z: t(p.position.z),
      };
    },
  },
};
