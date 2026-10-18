/**
 * Images de référence (calques) : taille affichée, redressement (perspective), mise à l'échelle par
 * deux points. Calculs purs (testables) ; le décodage et le dessin sont dans `ui/image-cache.ts`.
 */
import type { ImageParams } from '../domain/model';
import { applyHomography, homographyFrom, type Homography } from '../math/homography';
import type { Vec2 } from '../math/vec';

/** Le rectangle redressé occupe le centre de l'image redressée, avec une demi-marge de chaque côté. */
export const PERSPECTIVE_MARGIN = 0.5;

/** Proportions (largeur / hauteur) de l'image affichée : redressée ou d'origine. */
export function imageAspect(p: Pick<ImageParams, 'pixels' | 'perspective'>): number {
  return p.perspective ? p.perspective.aspect : p.pixels.w / p.pixels.h;
}

/** Taille affichée (mm). */
export function imageSize(p: Pick<ImageParams, 'pixels' | 'perspective' | 'width'>): { w: number; h: number } {
  return { w: p.width, h: p.width / imageAspect(p) };
}

/**
 * Homographie de l'image redressée vers l'image d'origine (coordonnées normalisées 0 → 1, y vers le
 * haut) : sert à calculer chaque pixel de l'image redressée.
 */
export function rectifiedToSource(perspective: NonNullable<ImageParams['perspective']>): Homography | null {
  const m = PERSPECTIVE_MARGIN / (1 + 2 * PERSPECTIVE_MARGIN);
  const s = 1 - m;
  return homographyFrom(
    [
      { x: m, y: m },
      { x: s, y: m },
      { x: s, y: s },
      { x: m, y: s },
    ],
    perspective.corners,
  );
}

/** Point de l'image redressée (normalisé) → point de l'image d'origine (normalisé). */
export function sourcePoint(H: Homography, p: Vec2): Vec2 {
  return applyHomography(H, p);
}

/**
 * Redressement : coins cliqués (image d'origine) d'un rectangle de `width` × `height` mm. Renvoie
 * les réglages : la largeur affichée fait que le rectangle mesure exactement `width` mm.
 */
export function perspectiveSettings(corners: [Vec2, Vec2, Vec2, Vec2], width: number, height: number): Pick<ImageParams, 'perspective' | 'width'> {
  return { perspective: { corners, aspect: width / height }, width: width * (1 + 2 * PERSPECTIVE_MARGIN) };
}

/** Mise à l'échelle par deux points (normalisés, sur l'image affichée) distants de `real` mm. */
export function calibratedWidth(p: Pick<ImageParams, 'pixels' | 'perspective' | 'width'>, a: Vec2, b: Vec2, real: number): number | null {
  const { w, h } = imageSize(p);
  const d = Math.hypot((b.x - a.x) * w, (b.y - a.y) * h);
  if (!(d > 1e-9) || !(real > 0)) return null;
  return (p.width * real) / d;
}

/** Point de l'image (normalisé, y vers le haut) → point du plan du support (mm). */
export function imageToPlane(p: Pick<ImageParams, 'pixels' | 'perspective' | 'width' | 'center' | 'rotation' | 'mirror'>, uv: Vec2): Vec2 {
  const { w, h } = imageSize(p);
  const x = (uv.x - 0.5) * w * (p.mirror ? -1 : 1);
  const y = (uv.y - 0.5) * h;
  const a = (p.rotation * Math.PI) / 180;
  return { x: p.center.x + x * Math.cos(a) - y * Math.sin(a), y: p.center.y + x * Math.sin(a) + y * Math.cos(a) };
}
