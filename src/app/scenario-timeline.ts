/**
 * Timeline des scénarios de mouvement : images clés des pilotantes, valeurs à un instant, édition
 * des clés et instants du pré-calcul. Fonctions pures (le calcul des poses est dans le contrôleur).
 */
import type { Assembly, Id, MotionDof, MotionScenario, ScenarioTimeline, TimelineKey } from '../domain/model';
import type { TimelineBake } from './state';

/** Durée d'une nouvelle timeline (s). */
export const TIMELINE_DEFAULT_DURATION = 4;
/** Images par seconde du pré-calcul, et nombre maximal d'images (au-delà, moins par seconde). */
export const TIMELINE_FPS = 30;
export const TIMELINE_MAX_FRAMES = 601;
/** Deux clés d'une même piste plus proches que ça (s) sont la même clé. */
const SAME_TIME = 1e-3;

export const trackKey = (x: { jointId: Id; dof: MotionDof }) => `${x.jointId}:${x.dof}`;

export function emptyTimeline(): ScenarioTimeline {
  return { duration: TIMELINE_DEFAULT_DURATION, keys: [] };
}

/** Clés d'une piste, dans l'ordre du temps. */
export function trackKeys(timeline: ScenarioTimeline | undefined, track: { jointId: Id; dof: MotionDof }): TimelineKey[] {
  return (timeline?.keys ?? []).filter((k) => k.jointId === track.jointId && k.dof === track.dof).sort((a, b) => a.t - b.t);
}

/** Adoucie : départ et arrivée à vitesse nulle (polynôme de degré 3). */
const smooth = (f: number) => f * f * (3 - 2 * f);

/** Valeur d'une piste à l'instant `t` (clés triées) ; null sans clé. */
export function valueAt(keys: readonly TimelineKey[], t: number): number | null {
  if (keys.length === 0) return null;
  const first = keys[0]!;
  if (t <= first.t) return first.value;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t <= b.t) {
      const a = keys[i - 1]!;
      const span = b.t - a.t;
      const f = span > 0 ? (t - a.t) / span : 1;
      return a.value + (b.value - a.value) * (a.ease === 'linear' ? f : smooth(f));
    }
  }
  return keys[keys.length - 1]!.value;
}

/** La timeline mène-t-elle au moins une pilotante du scénario ? */
export function isAnimated(scenario: MotionScenario | null | undefined): boolean {
  const keys = scenario?.timeline?.keys ?? [];
  return !!scenario && keys.some((k) => scenario.drivers.some((d) => d.jointId === k.jointId && d.dof === k.dof));
}

/** Réglages des pilotantes menées par la timeline à l'instant `t` (clé `liaison:mouvement`). */
export function timelineValues(scenario: MotionScenario, t: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of scenario.drivers) {
    const v = valueAt(trackKeys(scenario.timeline, d), t);
    if (v !== null) out[trackKey(d)] = v;
  }
  return out;
}

/** Pose (ou remplace, au même instant de la même piste) une clé. */
export function putKey(timeline: ScenarioTimeline, key: TimelineKey): ScenarioTimeline {
  const t = clampTime(timeline, key.t);
  const same = (k: TimelineKey) => k.jointId === key.jointId && k.dof === key.dof && Math.abs(k.t - t) < SAME_TIME;
  const old = timeline.keys.find(same);
  const next: TimelineKey = { ...key, t, ...(old?.ease && !key.ease ? { ease: old.ease } : {}) };
  return { ...timeline, keys: [...timeline.keys.filter((k) => !same(k)), next] };
}

/** Retire une clé (repérée par sa piste et son instant). */
export function removeKey(timeline: ScenarioTimeline, key: Pick<TimelineKey, 'jointId' | 'dof' | 't'>): ScenarioTimeline {
  return { ...timeline, keys: timeline.keys.filter((k) => !(k.jointId === key.jointId && k.dof === key.dof && Math.abs(k.t - key.t) < SAME_TIME)) };
}

/**
 * Déplace une clé dans le temps (et change éventuellement sa valeur ou son passage) ; une clé de
 * la même piste déjà à l'instant d'arrivée est remplacée.
 */
export function moveKey(timeline: ScenarioTimeline, from: Pick<TimelineKey, 'jointId' | 'dof' | 't'>, patch: Partial<Pick<TimelineKey, 't' | 'value' | 'ease'>>): ScenarioTimeline {
  const old = timeline.keys.find((k) => k.jointId === from.jointId && k.dof === from.dof && Math.abs(k.t - from.t) < SAME_TIME);
  if (!old) return timeline;
  const { ease, ...rest } = { ...old, ...patch };
  return putKey(removeKey(timeline, old), { ...rest, ...(ease && ease !== 'smooth' ? { ease } : {}) });
}

/** Nouvelle durée : les clés au-delà sont ramenées à la fin. */
export function withDuration(timeline: ScenarioTimeline, duration: number): ScenarioTimeline {
  const d = Math.max(0.1, duration);
  let next: ScenarioTimeline = { ...timeline, duration: d, keys: timeline.keys.filter((k) => k.t <= d + SAME_TIME) };
  for (const k of timeline.keys.filter((x) => x.t > d + SAME_TIME).sort((a, b) => a.t - b.t)) next = putKey(next, { ...k, t: d });
  return next;
}

export function clampTime(timeline: ScenarioTimeline, t: number): number {
  return Math.min(timeline.duration, Math.max(0, Math.round(t * 1000) / 1000));
}

/** Instants du pré-calcul : réguliers, de 0 à la durée comprise. */
export function frameTimes(duration: number): number[] {
  const n = Math.min(TIMELINE_MAX_FRAMES, Math.max(2, Math.ceil(duration * TIMELINE_FPS) + 1));
  return Array.from({ length: n }, (_, i) => (duration * i) / (n - 1));
}

/** Image calculée voisine de `t`, et part de la suivante (0 à 1). */
export function frameAt(count: number, duration: number, t: number): { index: number; f: number } {
  if (count < 2 || duration <= 0) return { index: 0, f: 0 };
  const x = (Math.min(duration, Math.max(0, t)) / duration) * (count - 1);
  const index = Math.min(count - 2, Math.floor(x));
  return { index, f: x - index };
}

/** État montré d'un scénario : relevés des pilotées, blocage, assemblage aux réglages trouvés. */
export interface ScenarioView {
  readings: { jointId: Id; dof: MotionDof; value: number | null }[];
  blocked: boolean;
  settled: Assembly;
}

/**
 * Pose pré-calculée à l'instant `t`, entre les deux images voisines (réglages des liaisons et
 * relevés interpolés) ; null si ces images ne sont pas encore calculées.
 */
export function bakedPose(bake: TimelineBake, t: number): ScenarioView | null {
  const { index, f } = frameAt(bake.total, bake.duration, t);
  const a = bake.frames[index];
  const b = bake.frames[index + 1] ?? (bake.total === 1 ? a : undefined);
  if (!a || !b) return null;
  if (f < 1e-6 || a === b) return a;
  if (a.blocked || b.blocked) return f < 0.5 ? a : b;
  const near = f < 0.5 ? a : b;
  const mix = (x: number | undefined, y: number | undefined, wrap: boolean) => {
    if (x === undefined || y === undefined) return near === a ? x : y;
    // Un angle qui passe de +180° à −180° entre deux images : la plus proche, sans interpolation.
    if (wrap && Math.abs(y - x) > 180) return near === a ? x : y;
    return x + (y - x) * f;
  };
  const byId = new Map(b.settled.joints.map((j) => [j.id, j]));
  const joints = a.settled.joints.map((ja) => {
    const jb = byId.get(ja.id);
    if (!jb) return ja;
    const angle = mix(ja.angle, jb.angle, true);
    const offset = mix(ja.offset, jb.offset, false);
    return { ...ja, ...(angle !== undefined ? { angle } : {}), ...(offset !== undefined ? { offset } : {}) };
  });
  const readings = a.readings.map((ra, k) => {
    const rb = b.readings[k];
    if (ra.value === null || !rb || rb.value === null) return near === a ? ra : (rb ?? ra);
    return { ...ra, value: mix(ra.value, rb.value, ra.dof === 'angle') ?? null };
  });
  return { readings, blocked: false, settled: { ...a.settled, joints } };
}
