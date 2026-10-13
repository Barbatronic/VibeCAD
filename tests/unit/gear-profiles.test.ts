import { describe, expect, it } from 'vitest';
import { BELT_PROFILES, pulleyOutsideDiameter, pulleyProfile, rackProfile, spurGearProfile, spurGeometry, type BeltProfile } from '../../src/features/gear/profiles';
import type { ProfileSegment } from '../../src/sketch/profiles';

type P = { x: number; y: number };
const close = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

/** Les segments se suivent bout à bout et la boucle se referme. */
function chained(segs: readonly ProfileSegment[]): boolean {
  return segs.every((s, i) => {
    const next = segs[(i + 1) % segs.length]!;
    return 'end' in s && 'start' in next && close(s.end, next.start);
  });
}

function bez(b: P[], t: number): P {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w.reduce((s, wi, i) => s + wi * b[i]!.x, 0), y: w.reduce((s, wi, i) => s + wi * b[i]!.y, 0) };
}

/** Points échantillonnés d'une boucle. */
function sample(segs: readonly ProfileSegment[]): P[] {
  const pts: P[] = [];
  for (const s of segs) {
    if (s.kind === 'spline') for (const b of s.beziers) for (let k = 0; k <= 20; k++) pts.push(bez(b, k / 20));
    else if (s.kind === 'arc') {
      const a0 = Math.atan2(s.start.y - s.center.y, s.start.x - s.center.x);
      let a1 = Math.atan2(s.end.y - s.center.y, s.end.x - s.center.x);
      if (!s.clockwise && a1 <= a0) a1 += 2 * Math.PI;
      if (s.clockwise && a1 >= a0) a1 -= 2 * Math.PI;
      for (let k = 0; k <= 20; k++) pts.push({ x: s.center.x + s.radius * Math.cos(a0 + ((a1 - a0) * k) / 20), y: s.center.y + s.radius * Math.sin(a0 + ((a1 - a0) * k) / 20) });
    } else if ('start' in s) pts.push(s.start, s.end);
  }
  return pts;
}

describe('générateurs : roue dentée à développante', () => {
  const m = 2;
  const z = 20;
  const region = spurGearProfile(m, z, 20, 5);
  const segs = region.outer.segments;

  it('contour fermé, sens trigonométrique, alésage dans l’autre sens', () => {
    expect(chained(segs)).toBe(true);
    expect(region.outer.signedArea).toBeGreaterThan(0);
    expect(region.holes[0]!.signedArea).toBeLessThan(0);
    expect(segs.filter((s) => s.entityId.endsWith('-tip'))).toHaveLength(z);
  });

  it('diamètres de tête et de pied ISO : d + 2m et d − 2,5m', () => {
    const g = spurGeometry(m, z, 20);
    expect([g.pitch, g.tip, g.root]).toEqual([40, 44, 35]);
    const radii = sample(segs).map((p) => Math.hypot(p.x, p.y));
    expect(Math.max(...radii)).toBeCloseTo(22, 6);
    expect(Math.min(...radii)).toBeCloseTo(17.5, 6);
  });

  it('épaisseur de dent sur le cercle primitif : π·m / 2', () => {
    // Flanc montant de la dent 0 : là où il coupe le primitif, son angle vaut −π / (2z).
    const flank = segs.find((s) => s.entityId === 't0-flank-a')!;
    if (flank.kind !== 'spline') throw new Error('flanc attendu');
    const pts = flank.beziers.flatMap((b) => Array.from({ length: 2001 }, (_v, k) => bez(b, k / 2000)));
    const atPitch = pts.reduce((best, p) => (Math.abs(Math.hypot(p.x, p.y) - 20) < Math.abs(Math.hypot(best.x, best.y) - 20) ? p : best));
    const halfAngle = -Math.atan2(atPitch.y, atPitch.x);
    expect(2 * halfAngle * 20).toBeCloseTo((Math.PI * m) / 2, 3);
  });

  it('les flancs suivent la développante (écart < 1 µm)', () => {
    const rb = spurGeometry(m, z, 20).base / 2;
    const flank = segs.find((s) => s.entityId === 't3-flank-b')!;
    if (flank.kind !== 'spline') throw new Error('flanc attendu');
    // Une développante vérifie : angle polaire = constante ± inv(arccos(rb / ρ)).
    const pts = flank.beziers.flatMap((b) => Array.from({ length: 21 }, (_v, k) => bez(b, k / 20)));
    const ref = (p: P) => Math.atan2(p.y, p.x) + (Math.tan(Math.acos(rb / Math.hypot(p.x, p.y))) - Math.acos(rb / Math.hypot(p.x, p.y)));
    const c0 = ref(pts[0]!);
    for (const p of pts) expect(Math.abs(ref(p) - c0) * Math.hypot(p.x, p.y)).toBeLessThan(1e-3);
  });
});

describe('générateurs : crémaillère', () => {
  it('pas π·m, dents de largeur π·m / 2 sur la ligne primitive, contour fermé', () => {
    const m = 1.5;
    const r = rackProfile(m, 10, 20, 4);
    const segs = r.outer.segments;
    expect(chained(segs)).toBe(true);
    expect(r.outer.signedArea).toBeGreaterThan(0);
    const xs = sample(segs).map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10 * Math.PI * m, 9);
    // Aire : corps + dents (trapèzes de hauteur 2,25m).
    const p = Math.PI * m;
    const tan = Math.tan((20 * Math.PI) / 180);
    const tooth = ((p / 2 - 2 * m * tan + (p / 2 + 2 * 1.25 * m * tan)) / 2) * 2.25 * m;
    expect(r.area).toBeCloseTo(10 * p * 4 + 10 * tooth, 6);
  });
});

describe('générateurs : poulie crantée', () => {
  it('diamètre extérieur des fabricants : GT2 20 dents 12,22 mm, T5 20 dents 30,83 mm', () => {
    expect(pulleyOutsideDiameter('GT2-2', 20)).toBeCloseTo(12.224, 3);
    expect(pulleyOutsideDiameter('T5', 20)).toBeCloseTo(30.831, 3);
  });

  it('chaque profil : contour fermé, creux à la bonne profondeur', () => {
    for (const profile of Object.keys(BELT_PROFILES) as BeltProfile[]) {
      const z = 24;
      const r = pulleyProfile(profile, z, 5);
      expect(chained(r.outer.segments), profile).toBe(true);
      expect(r.outer.signedArea, profile).toBeGreaterThan(0);
      const radii = sample(r.outer.segments).map((p) => Math.hypot(p.x, p.y));
      const R = pulleyOutsideDiameter(profile, z) / 2;
      expect(Math.max(...radii), profile).toBeCloseTo(R, 6);
      expect(Math.min(...radii), profile).toBeGreaterThan(R - BELT_PROFILES[profile].depth - 0.05);
      expect(Math.min(...radii), profile).toBeLessThan(R - BELT_PROFILES[profile].depth + 0.25);
    }
  });
});
