/** Vecteurs 2D (coordonnées d'esquisse, en mm) et 3D (coordonnées du modèle, en mm). */
export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });
export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale2 = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length2 = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const midpoint2 = (a: Vec2, b: Vec2): Vec2 => lerp2(a, b, 0.5);
export const perp2 = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function normalize2(a: Vec2): Vec2 {
  const l = length2(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Distance d'un point à un segment [a, b]. */
export function distanceToSegment2(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub2(b, a);
  const l2 = dot2(ab, ab);
  if (l2 === 0) return distance2(p, a);
  const t = Math.max(0, Math.min(1, dot2(sub2(p, a), ab) / l2));
  return distance2(p, lerp2(a, b, t));
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const distance3 = (a: Vec3, b: Vec3): number => length3(sub3(a, b));

export function normalize3(a: Vec3): Vec3 {
  const l = length3(a);
  return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}

/** Arrondit les composantes très proches de zéro (évite les -0 et 1e-17 dans les repères). */
export function clean3(a: Vec3, eps = 1e-12): Vec3 {
  const c = (v: number) => (Math.abs(v) < eps ? 0 : v);
  return { x: c(a.x), y: c(a.y), z: c(a.z) };
}
