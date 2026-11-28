import { makeServoFeature } from '../../domain/document';
import { ORIGIN_POINT_ID, type Part, type ServoFeature, type ServoSpline, type ServoTarget, type SketchFeature } from '../../domain/model';
import { formatLength, formatNumber } from '../../domain/units';
import { standalonePoints } from '../../sketch/model';
import type { FeatureDefinition, ParamIssue } from '../definition';

type SplineFigures = Pick<ServoFeature['params'], 'teeth' | 'tipDiameter' | 'rootDiameter' | 'depth' | 'screwDiameter'>;

/**
 * Cannelures toutes faites. MG90S : relevée sur un palonnier imprimé qui tient sur le servo
 * (21 dents, Ø 5,25 / 4,4, 3 mm de prise, vis M2). 25 dents (MG996R, MG995…) : même forme de dent
 * pour un axe de Ø 5,9 environ, vis M3 ; à confirmer par une impression d'essai.
 */
export const SERVO_SPLINES: Record<Exclude<ServoSpline, 'custom'>, SplineFigures & { label: string; help: string }> = {
  mg90s: { label: 'MG90S · 21 dents', help: 'Micro-servo 9 g, vis M2', teeth: 21, tipDiameter: 5.25, rootDiameter: 4.4, depth: 3, screwDiameter: 2.8 },
  '25t': { label: '25 dents · MG996R', help: 'Servo standard (MG996R, MG995…), vis M3', teeth: 25, tipDiameter: 6.35, rootDiameter: 5.5, depth: 4, screwDiameter: 3.2 },
};

export const SERVO_SPLINE_LABELS: Record<ServoSpline, string> = { mg90s: SERVO_SPLINES.mg90s.label, '25t': SERVO_SPLINES['25t'].label, custom: 'Autre' };

/** Premier élément utilisable d'une esquisse : centre d'un cercle, sinon point posé seul. */
export function servoTargetInSketch(sketch: SketchFeature): ServoTarget | null {
  const circle = sketch.params.entities.find((e) => (e.type === 'circle' || e.type === 'arc') && !e.reference);
  if (circle) return { kind: 'sketch', sketchId: sketch.id, entityId: circle.id };
  const point = standalonePoints(sketch.params).find((p) => p.id !== ORIGIN_POINT_ID);
  return point ? { kind: 'sketch', sketchId: sketch.id, entityId: point.id } : null;
}

/** Point ou cercle de la dernière esquisse qui en a un (création sans bord rond choisi). */
export function defaultServoTarget(part: Part): ServoTarget | null {
  for (const f of [...part.features].reverse()) {
    if (f.type !== 'sketch') continue;
    const t = servoTargetInSketch(f);
    if (t) return t;
  }
  return null;
}

export function servoIssues(p: ServoFeature['params']): ParamIssue[] {
  const issues: ParamIssue[] = [];
  if (!Number.isInteger(p.teeth) || p.teeth < 6 || p.teeth > 80) issues.push({ field: 'teeth', message: 'Le nombre de dents doit être un entier entre 6 et 80.' });
  if (!(p.tipDiameter > 0) || p.tipDiameter > 100) issues.push({ field: 'tipDiameter', message: 'Le diamètre extérieur doit être compris entre 0 et 100 mm.' });
  if (!(p.rootDiameter > 0) || !(p.rootDiameter < p.tipDiameter)) issues.push({ field: 'rootDiameter', message: `Le diamètre intérieur doit être positif et plus petit que l’extérieur (${formatLength(p.tipDiameter)}).` });
  if (!(p.depth > 0) || p.depth > 100) issues.push({ field: 'depth', message: 'La profondeur doit être comprise entre 0 et 100 mm.' });
  if (!(p.screwDiameter >= 0) || (p.screwDiameter > 0 && !(p.screwDiameter < p.rootDiameter)))
    issues.push({ field: 'screwDiameter', message: `Le trou de vis doit être plus petit que le diamètre intérieur (${formatLength(p.rootDiameter)}) ; 0 : pas de trou.` });
  return issues;
}

export const servoDefinition: FeatureDefinition<ServoFeature> = {
  type: 'servo',
  label: 'Cannelure servo',
  namePrefix: 'Cannelure servo',
  explanation:
    'Cannelure de servomoteur : l’empreinte de l’axe cranté d’un servo (MG90S, MG996R…) et le trou de sa vis, creusés au centre d’un bord rond cliqué dans la vue 3D, ou d’un point ou d’un cercle d’esquisse. Pour imprimer un palonnier ou un bras qui se monte directement sur le servo.',
  icon: 'servo',
  affectsSolid: true,
  dependencies(feature) {
    const t = feature.params.target;
    if (!t) return [];
    return t.kind === 'sketch' ? [t.sketchId] : Array.from(new Set(t.edge.faces.map((f) => f.featureId)));
  },
  validate(feature) {
    const issues = servoIssues(feature.params);
    if (!feature.params.target) issues.push({ field: 'target', message: 'Cliquez dans la vue 3D le bord rond où centrer la cannelure, ou choisissez un point d’esquisse.' });
    return issues;
  },
  summary(feature) {
    const p = feature.params;
    const name = p.standard === 'custom' ? `${p.teeth} dents, Ø ${formatNumber(p.tipDiameter, 2)}` : SERVO_SPLINE_LABELS[p.standard];
    return `${name}, ${formatLength(p.depth)} de prise${p.screwDiameter > 0 ? `, vis Ø ${formatNumber(p.screwDiameter, 2)}` : ''}`;
  },
  tool: {
    input: 'edges',
    requiresSolid: true,
    requiresSolidReason: 'La cannelure se creuse dans la matière : créez d’abord le volume du palonnier (une extrusion).',
    previewKind: 'cut',
    create(doc, part, input) {
      const edge = input.kind === 'edges' ? input.edges[0] : undefined;
      return makeServoFeature(doc, part, edge ? { kind: 'edge', edge } : (defaultServoTarget(part) ?? undefined));
    },
    initialFields: (feature) => {
      const p = feature.params;
      const t = (v: number) => formatLength(v, 3, false);
      return { teeth: String(p.teeth), tipDiameter: t(p.tipDiameter), rootDiameter: t(p.rootDiameter), depth: t(p.depth), screwDiameter: t(p.screwDiameter) };
    },
  },
};
