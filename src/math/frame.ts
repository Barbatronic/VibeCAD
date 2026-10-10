import {
  add3,
  clean3,
  cross3,
  dot3,
  normalize3,
  scale3,
  sub3,
  vec3,
  type Vec2,
  type Vec3,
} from './vec';

/**
 * Repère orthonormé direct d'un plan d'esquisse : `normal = xAxis × yAxis`.
 * Les coordonnées d'esquisse (u, v) se placent en `origin + u·xAxis + v·yAxis`.
 */
export interface Frame3D {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  normal: Vec3;
}

/** Plans d'origine, mêmes conventions que FreeCAD (vue de dessus, de face, de droite). */
export type PlaneName = 'XY' | 'XZ' | 'YZ';

export const PLANE_NAMES: readonly PlaneName[] = ['XY', 'XZ', 'YZ'];

/**
 * - XY : u = X, v = Y, normale +Z (vu de dessus) ;
 * - XZ : u = X, v = Z, normale −Y (vu de face) ;
 * - YZ : u = Y, v = Z, normale +X (vu de droite).
 */
export function originPlaneFrame(plane: PlaneName, offset = 0): Frame3D {
  let frame: Frame3D;
  switch (plane) {
    case 'XY':
      frame = { origin: vec3(0, 0, 0), xAxis: vec3(1, 0, 0), yAxis: vec3(0, 1, 0), normal: vec3(0, 0, 1) };
      break;
    case 'XZ':
      frame = { origin: vec3(0, 0, 0), xAxis: vec3(1, 0, 0), yAxis: vec3(0, 0, 1), normal: vec3(0, -1, 0) };
      break;
    case 'YZ':
      frame = { origin: vec3(0, 0, 0), xAxis: vec3(0, 1, 0), yAxis: vec3(0, 0, 1), normal: vec3(1, 0, 0) };
      break;
  }
  return offset === 0 ? frame : { ...frame, origin: scale3(frame.normal, offset) };
}

const AXIS_EPS = 1e-9;

/**
 * Repère « canonique » d'un plan quelconque, indépendant de la topologie de la face :
 * - origine = projection de l'origine du modèle sur le plan (les cotes « depuis l'origine »
 *   restent lisibles sur une face) ;
 * - axes choisis comme les vues standard : dessus, dessous, face, arrière, droite, gauche ;
 * - pour un plan incliné, l'axe v suit la projection de +Z (le « haut »).
 */
export function canonicalFrame(pointOnPlane: Vec3, normalIn: Vec3): Frame3D {
  const n = normalize3(normalIn);
  let xAxis: Vec3;
  if (Math.abs(n.x) < AXIS_EPS && Math.abs(n.y) < AXIS_EPS) {
    // Plan horizontal : dessus (+Z) ou dessous (−Z).
    xAxis = vec3(1, 0, 0);
  } else if (Math.abs(n.z) < AXIS_EPS && Math.abs(n.x) < AXIS_EPS) {
    // Plan de face (−Y) ou arrière (+Y).
    xAxis = n.y < 0 ? vec3(1, 0, 0) : vec3(-1, 0, 0);
  } else if (Math.abs(n.z) < AXIS_EPS && Math.abs(n.y) < AXIS_EPS) {
    // Plan de droite (+X) ou gauche (−X).
    xAxis = n.x > 0 ? vec3(0, 1, 0) : vec3(0, -1, 0);
  } else {
    const up = vec3(0, 0, 1);
    const upInPlane = sub3(up, scale3(n, dot3(up, n)));
    if (Math.hypot(upInPlane.x, upInPlane.y, upInPlane.z) < 1e-9) {
      xAxis = vec3(1, 0, 0);
    } else {
      const yAxis = normalize3(upInPlane);
      xAxis = normalize3(cross3(yAxis, n));
    }
  }
  const yAxis = normalize3(cross3(n, xAxis));
  const origin = sub3(vec3(0, 0, 0), scale3(n, dot3(sub3(vec3(0, 0, 0), pointOnPlane), n)));
  return { origin: clean3(origin), xAxis: clean3(xAxis), yAxis: clean3(yAxis), normal: clean3(n) };
}

export function frameToWorld(frame: Frame3D, p: Vec2, height = 0): Vec3 {
  return add3(add3(add3(frame.origin, scale3(frame.xAxis, p.x)), scale3(frame.yAxis, p.y)), scale3(frame.normal, height));
}

export function worldToFrame(frame: Frame3D, p: Vec3): Vec2 {
  const d = sub3(p, frame.origin);
  return { x: dot3(d, frame.xAxis), y: dot3(d, frame.yAxis) };
}

/** Distance signée d'un point au plan du repère (positive du côté de la normale). */
export function signedDistanceToFrame(frame: Frame3D, p: Vec3): number {
  return dot3(sub3(p, frame.origin), frame.normal);
}

export function offsetFrame(frame: Frame3D, distance: number): Frame3D {
  return { ...frame, origin: add3(frame.origin, scale3(frame.normal, distance)) };
}

/** Vrai si deux repères décrivent le même plan orienté et les mêmes axes (à `eps` près). */
export function framesEqual(a: Frame3D, b: Frame3D, eps = 1e-9): boolean {
  const close = (u: Vec3, v: Vec3) => Math.abs(u.x - v.x) < eps && Math.abs(u.y - v.y) < eps && Math.abs(u.z - v.z) < eps;
  return close(a.origin, b.origin) && close(a.xAxis, b.xAxis) && close(a.yAxis, b.yAxis) && close(a.normal, b.normal);
}
