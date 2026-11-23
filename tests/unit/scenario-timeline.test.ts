import { describe, expect, it } from 'vitest';
import { bakedPose, frameAt, frameTimes, isAnimated, moveKey, putKey, removeKey, timelineValues, trackKeys, valueAt, withDuration } from '../../src/app/scenario-timeline';
import type { TimelineBake } from '../../src/app/state';
import type { Assembly, MotionScenario, ScenarioTimeline, TimelineKey } from '../../src/domain/model';

const key = (t: number, value: number, ease?: 'linear'): TimelineKey => ({ jointId: 'a', dof: 'angle', t, value, ...(ease ? { ease } : {}) });

describe('timeline : valeur à un instant', () => {
  it('tenue avant la première clé et après la dernière', () => {
    const keys = [key(1, 10), key(3, 50)];
    expect(valueAt(keys, 0)).toBe(10);
    expect(valueAt(keys, 5)).toBe(50);
    expect(valueAt([], 1)).toBeNull();
  });

  it('linéaire : vitesse constante ; adoucie : même milieu, départ lent', () => {
    expect(valueAt([key(0, 0, 'linear'), key(2, 100)], 0.5)).toBeCloseTo(25, 9);
    const smooth = [key(0, 0), key(2, 100)];
    expect(valueAt(smooth, 1)).toBeCloseTo(50, 9);
    expect(valueAt(smooth, 0.2)!).toBeLessThan(10);
    expect(valueAt(smooth, 0.2)!).toBeGreaterThan(0);
  });

  it('réglages des pilotantes menées seulement', () => {
    const scenario: MotionScenario = {
      id: 's',
      name: 'S',
      drivers: [
        { jointId: 'a', dof: 'angle', value: 7 },
        { jointId: 'b', dof: 'offset', value: 3 },
      ],
      sensors: [],
      timeline: { duration: 2, keys: [key(0, 0, 'linear'), key(2, 90), { jointId: 'z', dof: 'angle', t: 0, value: 1 }] },
    };
    expect(isAnimated(scenario)).toBe(true);
    expect(timelineValues(scenario, 1)).toEqual({ 'a:angle': 45 });
    expect(isAnimated({ ...scenario, timeline: { duration: 2, keys: [{ jointId: 'z', dof: 'angle', t: 0, value: 1 }] } })).toBe(false);
  });
});

describe('timeline : édition des clés', () => {
  const base: ScenarioTimeline = { duration: 4, keys: [key(0, 0), key(2, 90, 'linear')] };

  it('une clé posée au même instant remplace l’ancienne et garde son passage', () => {
    const next = putKey(base, { jointId: 'a', dof: 'angle', t: 2.0004, value: 45 });
    expect(trackKeys(next, { jointId: 'a', dof: 'angle' })).toEqual([key(0, 0), key(2, 45, 'linear')]);
  });

  it('instant ramené dans la durée', () => {
    expect(putKey(base, key(9, 1)).keys.find((k) => k.value === 1)?.t).toBe(4);
  });

  it('déplacer, changer le passage, supprimer', () => {
    let tl = moveKey(base, { jointId: 'a', dof: 'angle', t: 2 }, { t: 3 });
    expect(trackKeys(tl, { jointId: 'a', dof: 'angle' }).map((k) => k.t)).toEqual([0, 3]);
    tl = moveKey(tl, { jointId: 'a', dof: 'angle', t: 3 }, { ease: 'smooth' });
    expect(tl.keys.find((k) => k.t === 3)?.ease).toBeUndefined();
    // Déplacée sur une autre clé de la piste : elle la remplace.
    tl = moveKey(tl, { jointId: 'a', dof: 'angle', t: 3 }, { t: 0 });
    expect(tl.keys).toEqual([key(0, 90)]);
    expect(removeKey(tl, { jointId: 'a', dof: 'angle', t: 0 }).keys).toEqual([]);
  });

  it('durée raccourcie : les clés au-delà vont à la fin', () => {
    const tl = withDuration({ duration: 4, keys: [key(0, 0), key(3, 30), key(4, 40)] }, 2);
    expect(tl.duration).toBe(2);
    expect(tl.keys.map((k) => [k.t, k.value])).toEqual([[0, 0], [2, 40]]);
  });
});

describe('timeline : poses pré-calculées', () => {
  it('instants réguliers, bornés', () => {
    expect(frameTimes(1)).toHaveLength(31);
    expect(frameTimes(1).at(-1)).toBe(1);
    expect(frameTimes(1000)).toHaveLength(601);
    expect(frameAt(31, 1, 0.5)).toEqual({ index: 15, f: 0 });
    expect(frameAt(31, 1, 1)).toEqual({ index: 29, f: 1 });
  });

  it('pose entre deux images : réglages et relevés interpolés, sans franchir ±180°', () => {
    const asm = (angle: number, other: number): Assembly => ({ instances: [], joints: [{ id: 'j', angle } as never, { id: 'k', angle: other } as never] }) as unknown as Assembly;
    const frame = (t: number, angle: number, other: number, reading: number) => ({ t, settled: asm(angle, other), readings: [{ jointId: 's', dof: 'offset' as const, value: reading }], blocked: false });
    const bake: TimelineBake = { scenarioId: 's', key: '', assembly: null, display: null, status: 'done', duration: 1, total: 2, frames: [frame(0, 0, 170, 10), frame(1, 90, -170, 20)] };
    const pose = bakedPose(bake, 0.25)!;
    expect(pose.settled.joints[0]!.angle).toBeCloseTo(22.5, 9);
    expect(pose.settled.joints[1]!.angle).toBe(170);
    expect(pose.readings[0]!.value).toBeCloseTo(12.5, 9);
    // Image suivante pas encore calculée.
    expect(bakedPose({ ...bake, status: 'running', total: 3, duration: 2, frames: bake.frames }, 1.5)).toBeNull();
  });
});
