import { describe, expect, it } from 'vitest';
import { courseDuration, coursePosition, DEFAULT_COURSE_SECONDS } from '../../src/app/mechanism';
import type { MechanismStudy } from '../../src/domain/model';

const study = (patch: Partial<MechanismStudy> = {}): MechanismStudy => ({ jointId: 'j', from: 0, to: 90, friction: 0, acceleration: 0, safety: 2, ...patch });

describe('mouvement d’un mécanisme : loi de la course', () => {
  it('sans élan : vitesse constante sur la durée par défaut', () => {
    const s = study();
    expect(courseDuration(s, 'angle')).toBe(DEFAULT_COURSE_SECONDS);
    expect(coursePosition(s, 'angle', 0)).toBe(0);
    expect(coursePosition(s, 'angle', DEFAULT_COURSE_SECONDS / 4)).toBeCloseTo(22.5, 9);
    expect(coursePosition(s, 'angle', 99)).toBe(90);
  });

  it('avec une accélération : durée √(4 · course / a), départ et arrivée arrêtés, symétrique', () => {
    // 90° = π/2 rad ; durée voulue 1 s → a = 4 · (π/2) / 1² = 2π rad/s².
    const s = study({ acceleration: 2 * Math.PI });
    expect(courseDuration(s, 'angle')).toBeCloseTo(1, 9);
    expect(coursePosition(s, 'angle', 0.5)).toBeCloseTo(45, 9);
    // Premier quart du temps : un huitième de la course (accélération constante).
    expect(coursePosition(s, 'angle', 0.25)).toBeCloseTo(90 / 8, 9);
    expect(coursePosition(s, 'angle', 0.75)).toBeCloseTo(90 - 90 / 8, 9);
    // Départ arrêté : presque rien parcouru au tout début.
    expect(coursePosition(s, 'angle', 0.01)).toBeLessThan(0.02);
  });

  it('course à rebours (de 50 mm à −50 mm) et glissière en mètres', () => {
    const s = study({ from: 50, to: -50, acceleration: 0.4 });
    expect(courseDuration(s, 'offset')).toBeCloseTo(1, 9);
    expect(coursePosition(s, 'offset', 0.5)).toBeCloseTo(0, 9);
    expect(coursePosition(s, 'offset', 1)).toBe(-50);
  });
});
