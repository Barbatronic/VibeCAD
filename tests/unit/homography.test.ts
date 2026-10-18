import { describe, expect, it } from 'vitest';
import { calibratedWidth, imageSize, imageToPlane, perspectiveSettings, rectifiedToSource, sourcePoint } from '../../src/app/images';
import { applyHomography, homographyFrom } from '../../src/math/homography';

describe('homographie', () => {
  it('envoie les 4 coins d’un quadrilatère sur ceux d’un rectangle, et les points intermédiaires en ligne', () => {
    // Feuille photographiée de biais (trapèze) → rectangle 0..1.
    const from = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.15 }, { x: 0.75, y: 0.8 }, { x: 0.25, y: 0.85 }];
    const to = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const H = homographyFrom(from, to)!;
    from.forEach((p, i) => {
      const q = applyHomography(H, p);
      expect(q.x).toBeCloseTo(to[i]!.x, 9);
      expect(q.y).toBeCloseTo(to[i]!.y, 9);
    });
    // Le milieu d'une diagonale reste sur la diagonale du rectangle (droites conservées).
    const m = applyHomography(H, { x: (0.1 + 0.75) / 2, y: (0.1 + 0.8) / 2 });
    expect(m.x).toBeCloseTo(m.y, 9);
  });
  it('quadrilatère dégénéré (trois points alignés) : null', () => {
    expect(homographyFrom([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }], [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])).toBeNull();
  });
});


describe('images de référence', () => {
  const base = { pixels: { w: 2000, h: 1000 }, width: 100, center: { x: 10, y: 20 }, rotation: 0, mirror: false };
  it('taille : la hauteur suit les proportions de l’image', () => {
    expect(imageSize(base)).toEqual({ w: 100, h: 50 });
  });
  it('mise à l’échelle par deux points : 2 points à 25 mm affichés doivent faire 50 mm → largeur doublée', () => {
    expect(calibratedWidth(base, { x: 0.25, y: 0.5 }, { x: 0.5, y: 0.5 }, 50)).toBeCloseTo(200, 9);
  });
  it('position : centre, rotation de 90°, miroir', () => {
    expect(imageToPlane(base, { x: 0.5, y: 0.5 })).toEqual({ x: 10, y: 20 });
    const r = imageToPlane({ ...base, rotation: 90 }, { x: 1, y: 0.5 });
    expect(r.x).toBeCloseTo(10, 9);
    expect(r.y).toBeCloseTo(70, 9);
    expect(imageToPlane({ ...base, mirror: true }, { x: 1, y: 0.5 }).x).toBeCloseTo(-40, 9);
  });
  it('redressement : le rectangle cliqué occupe le centre de l’image redressée, à sa taille réelle', () => {
    const corners: [any, any, any, any] = [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.2 }, { x: 0.7, y: 0.9 }, { x: 0.3, y: 0.8 }];
    const s = perspectiveSettings(corners, 210, 297);
    expect(s.width).toBeCloseTo(420, 9);
    const H = rectifiedToSource(s.perspective!)!;
    const q = sourcePoint(H, { x: 0.25, y: 0.25 });
    expect(q.x).toBeCloseTo(0.2, 9);
    expect(q.y).toBeCloseTo(0.1, 9);
    const r = sourcePoint(H, { x: 0.75, y: 0.75 });
    expect(r.x).toBeCloseTo(0.7, 9);
    expect(r.y).toBeCloseTo(0.9, 9);
    // Image affichée : 420 × 594 mm, rectangle de 210 × 297 au centre.
    expect(imageSize({ ...base, ...s }).h).toBeCloseTo(594, 9);
  });
});
