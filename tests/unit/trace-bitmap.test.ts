import { describe, expect, it } from 'vitest';
import { importSvgShape } from '../../src/io/svg-import';
import { otsuThreshold, traceBitmap, traceMask, type GrayImage, type TraceOptions } from '../../src/io/trace-bitmap';
import { addStamp, emptySketch } from '../../src/sketch/model';
import { extractProfiles, profileArea } from '../../src/sketch/profiles';
import { layoutStamp } from '../../src/sketch/stamp';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;
const OPTIONS: TraceOptions = { threshold: 128, invert: false, mode: 'lines', thicken: 0, despeckle: 0, smoothing: 0.3 };

/** Image blanche de `size` pixels, noire là où `ink` le dit. */
function image(size: number, ink: (x: number, y: number) => boolean, ground = 255, dark = 0): GrayImage {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data[y * size + x] = ink(x + 0.5, y + 0.5) ? dark : ground;
  return { width: size, height: size, data };
}
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) <= r;
const ring = (cx: number, cy: number, r1: number, r2: number) => (x: number, y: number) => {
  const d = Math.hypot(x - cx, y - cy);
  return d <= r2 && d >= r1;
};

const shapeOf = (img: GrayImage, o: Partial<TraceOptions> = {}) => {
  const r = importSvgShape(traceBitmap(img, { ...OPTIONS, ...o }), 'dessin');
  if (!r.ok) throw new Error(r.error);
  return r.shape;
};
/** Profil du tampon, à l'échelle de l'image (plus grand côté de la forme : `size`). */
const profile = (outline: string, size: number) => {
  const res = extractProfiles(addStamp(emptySketch(XY), { x: 0, y: 0 }, { name: 'x', outline }, size).sketch);
  expect(res.ok).toBe(true);
  return res;
};

describe('seuil automatique', () => {
  it('sépare l’encre du papier, même sur une photo grise', () => {
    const t = otsuThreshold(image(40, disc(20, 20, 12), 190, 40));
    expect(t).toBeGreaterThan(40);
    expect(t).toBeLessThanOrEqual(190);
  });
});

describe('vectorisation', () => {
  it('un disque donne un seul contour, à la bonne surface', () => {
    const shape = shapeOf(image(200, disc(100, 100, 70)));
    const res = profile(shape.outline, 140);
    expect(res.ok && res.regions).toHaveLength(1);
    expect(profileArea(res) / (Math.PI * 70 * 70)).toBeCloseTo(1, 1);
  });

  it('le lissage reste rond : les courbes ne suivent pas les marches de pixels', () => {
    const shape = shapeOf(image(200, disc(100, 100, 70)), { smoothing: 0.5 });
    expect((shape.outline.match(/[LC]/g) ?? []).length).toBeLessThan(60);
  });

  it('garde les angles d’un carré', () => {
    const shape = shapeOf(image(100, (x, y) => x >= 20 && x <= 80 && y >= 20 && y <= 80), { smoothing: 0 });
    expect(profileArea(profile(shape.outline, 60)) / 3600).toBeCloseTo(1, 1);
  });

  it('un anneau : trou gardé en mode traits, rempli en mode formes', () => {
    const img = image(200, ring(100, 100, 50, 70));
    const lines = profile(shapeOf(img, { mode: 'lines' }).outline, 140);
    expect(lines.ok && lines.regions[0]!.holes).toHaveLength(1);
    const fill = profile(shapeOf(img, { mode: 'fill' }).outline, 140);
    expect(fill.ok && fill.regions[0]!.holes).toHaveLength(0);
    expect(profileArea(fill) / (Math.PI * 70 * 70)).toBeCloseTo(1, 1);
  });

  it('une forme tracée avec une petite ouverture : l’épaississement la referme', () => {
    const open = (x: number, y: number) => ring(100, 100, 66, 70)(x, y) && !(x > 165 && Math.abs(y - 100) < 2);
    const img = image(200, open);
    // Tant que le trait est ouvert, l'intérieur communique avec le fond : il ne se remplit pas.
    expect(profileArea(profile(shapeOf(img, { mode: 'fill' }).outline, 140)) / (Math.PI * 70 * 70)).toBeLessThan(0.25);
    const closed = profile(shapeOf(img, { mode: 'fill', thicken: 3 }).outline, 146);
    expect(profileArea(closed) / (Math.PI * 73 * 73)).toBeGreaterThan(0.9);
  });

  it('retire les taches et bouche les piqûres', () => {
    const speck = (x: number, y: number) => disc(100, 100, 60)(x, y) !== disc(100, 100, 2)(x, y) || disc(20, 20, 2)(x, y);
    const res = profile(shapeOf(image(200, speck), { despeckle: 30 }).outline, 120);
    expect(res.ok && res.regions).toHaveLength(1);
    expect(res.ok && res.regions[0]!.holes).toHaveLength(0);
  });

  it('un dessin clair sur fond sombre s’inverse', () => {
    const shape = shapeOf(image(100, disc(50, 50, 30), 0, 255), { invert: true });
    expect(profileArea(profile(shape.outline, 60)) / (Math.PI * 900)).toBeCloseTo(1, 1);
  });

  it('la gomme efface avant le tracé', () => {
    const img = image(200, (x, y) => disc(50, 100, 30)(x, y) || disc(150, 100, 30)(x, y));
    const erased = new Uint8Array(200 * 200);
    for (let y = 0; y < 200; y++) erased.fill(1, y * 200 + 100, y * 200 + 200);
    const res = profile(shapeOf(img, { erased }).outline, 60);
    expect(res.ok && res.regions).toHaveLength(1);
    expect(traceMask(img, { ...OPTIONS, erased })[100 * 200 + 150]).toBe(0);
  });

  it('une forme qui touche le bord de l’image reste fermée', () => {
    const res = profile(shapeOf(image(100, (x) => x < 40)).outline, 100);
    expect(res.ok && res.regions).toHaveLength(1);
  });

  it('des pixels reliés par un coin ne donnent pas de contours qui se touchent', () => {
    const checker = (x: number, y: number) => {
      const [i, j] = [Math.floor(x / 20), Math.floor(y / 20)];
      return (i + j) % 2 === 0;
    };
    expect(profile(shapeOf(image(100, checker), { smoothing: 0 }).outline, 100).ok).toBe(true);
  });

  it('simplifie un dessin trop chargé plutôt que de le refuser', () => {
    const noisy = (x: number, y: number) => Math.hypot(x - 300, y - 300) < 250 + 8 * Math.sin(x / 2.3) * Math.cos(y / 1.9);
    const shape = shapeOf(image(600, noisy), { smoothing: 0 });
    expect((shape.outline.match(/[LC]/g) ?? []).length).toBeLessThanOrEqual(1000);
  });

  it('l’aperçu ne fait pas le contrôle complet, la validation si', () => {
    const crossing = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L100 100 L100 0 L0 100 Z"/></svg>';
    expect(importSvgShape(crossing, 'x', { preview: true }).ok).toBe(true);
    expect(importSvgShape(crossing, 'x').ok).toBe(false);
  });

  it('une image vide est expliquée', () => {
    const r = importSvgShape(traceBitmap(image(50, () => false), OPTIONS), 'dessin');
    expect(r.ok).toBe(false);
  });

  it('le tampon obtenu est centré', () => {
    const shape = shapeOf(image(200, disc(40, 150, 30)));
    const xs = layoutStamp(shape.outline, { x: 0, y: 0 }, 1).flatMap((c) => c.pieces.flatMap((p) => (p.kind === 'line' ? [p.start.x] : [p.bezier[0].x])));
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0, 1);
  });
});
