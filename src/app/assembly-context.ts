/**
 * Conception en contexte d'assemblage (voir docs/conception-en-contexte.md) : une pièce insérée se
 * modifie à sa place, entourée des autres pièces de l'assemblage. Les positions viennent de la
 * position de référence de l'assemblage (toutes les liaisons à zéro), pas de la position du
 * moment : une esquisse posée sur une pièce voisine ne bouge pas quand on anime le mécanisme.
 */
import type { Assembly, AssemblyContext, Id } from '../domain/model';
import { invertRigid4, multiply4, type Mat4 } from '../math/mat4';
import type { MeshData } from '../geometry/kernel';
import { subassemblyContent } from '../domain/subassemblies';
import { flattenAssembly, solveAssembly, type PlacedLeaf, type SolveOptions } from './assembly';
import type { AppState } from './state';

/** Assemblage en position de référence : réglages des liaisons (et des blocs souples) à zéro. */
export function referenceAssembly(assembly: Assembly): Assembly {
  const zero = { angle: 0, offset: 0 };
  return {
    ...assembly,
    joints: assembly.joints.map((j) => ({ ...j, ...zero, ...(j.tilt !== undefined ? { tilt: 0 } : {}), ...(j.tiltDirection !== undefined ? { tiltDirection: 0 } : {}) })),
    instances: assembly.instances.map((i) => (i.jointValues ? { ...i, jointValues: Object.fromEntries(Object.keys(i.jointValues).map((k) => [k, { ...zero }])) } : i)),
  };
}

/** Autre pièce de l'assemblage, placée dans le repère de la pièce modifiée. */
export interface ContextLeaf extends PlacedLeaf {
  /** Placement dans le repère de la pièce modifiée (colonnes). */
  local: Mat4;
}

/**
 * Pièces de l'assemblage autour de l'insertion `instanceId` (une pièce insérée directement, pas un
 * bloc), placées dans son repère. Null si l'insertion n'existe pas ou n'est pas placée.
 */
export function contextLeaves(
  assembly: Assembly,
  instanceId: Id,
  meshOf: (partId: Id) => MeshData | null | undefined,
  options: SolveOptions = {},
): ContextLeaf[] | null {
  const instance = assembly.instances.find((i) => i.id === instanceId);
  if (!instance || instance.subassemblyId) return null;
  const reference = referenceAssembly(assembly);
  const placement = solveAssembly(reference, meshOf, options);
  const leaves = flattenAssembly(reference, placement, meshOf, options);
  const own = leaves.find((l) => l.key === instanceId);
  if (!own) return null;
  const inverse = invertRigid4(own.matrix);
  return leaves.filter((l) => l.key !== instanceId).map((l) => ({ ...l, local: multiply4(inverse, l.matrix) }));
}

/** Contexte d'une référence vers la pièce `leaf` depuis l'insertion `instanceId`. */
export function contextOf(instanceId: Id, leaf: ContextLeaf): AssemblyContext {
  return { instanceId, otherInstanceId: leaf.key, matrix: [...leaf.local] };
}

/** Deux matrices de placement égales (à 1e-6 près) : rien à recalculer. */
export function sameMatrix(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 1e-6);
}

/** Contexte d'assemblage en cours : la pièce modifiée (celle de l'insertion) et ses voisines. */
export interface ActiveContext {
  instanceId: Id;
  partId: Id;
  name: string;
  leaves: ContextLeaf[];
}

/**
 * Contexte actif : onglet Pièces, insertion toujours présente et sa pièce active ; sinon null (la
 * vue redevient celle des pièces seules).
 */
export function activeContext(s: AppState): ActiveContext | null {
  const ctx = s.assemblyContext;
  const assembly = s.doc.assembly;
  if (!ctx || s.workspace !== 'parts' || !assembly) return null;
  const instance = assembly.instances.find((i) => i.id === ctx.instanceId);
  if (!instance || instance.partId !== s.activePartId) return null;
  const leaves = contextLeaves(assembly, instance.id, (partId) => s.display[partId]?.mesh, {
    sketchesOf: (partId) => s.display[partId]?.result.sketches,
    subassemblyOf: (id) => subassemblyContent(s.doc, id),
  });
  return leaves ? { instanceId: instance.id, partId: instance.partId, name: instance.name, leaves } : null;
}

/** Clé d'affichage d'une pièce voisine (préfixe `ctx:` + clé de la pièce dépliée). */
export const CONTEXT_PREFIX = 'ctx:';
