/**
 * Conception en contexte d'assemblage (voir docs/conception-en-contexte.md) : une pièce insérée se
 * modifie à sa place, entourée des autres pièces de l'assemblage. Les positions viennent de la
 * position de référence de l'assemblage (toutes les liaisons à zéro), pas de la position du
 * moment : une esquisse posée sur une pièce voisine ne bouge pas quand on anime le mécanisme.
 */
import type { Assembly, AssemblyContext, CadDocument, Feature, Id } from '../domain/model';
import { identity4, invertRigid4, multiply4, transformDirection4, transformPoint4, type Mat4 } from '../math/mat4';
import type { Frame3D } from '../math/frame';
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
 * Pièces de l'assemblage autour de la pièce placée `key` (clé d'une pièce dépliée : une insertion
 * directe, ou « bloc/insertion » pour une pièce d'un bloc), placées dans son repère. Null si elle
 * n'existe pas ou n'est pas placée.
 */
export function contextLeaves(
  assembly: Assembly,
  key: Id,
  meshOf: (partId: Id) => MeshData | null | undefined,
  options: SolveOptions = {},
): ContextLeaf[] | null {
  const reference = referenceAssembly(assembly);
  const placement = solveAssembly(reference, meshOf, options);
  const leaves = flattenAssembly(reference, placement, meshOf, options);
  const own = leaves.find((l) => l.key === key);
  if (!own) return null;
  const inverse = invertRigid4(own.matrix);
  return leaves.filter((l) => l.key !== key).map((l) => ({ ...l, local: multiply4(inverse, l.matrix) }));
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
  /** Clé de la pièce placée que l'on modifie ('' si elle n'est pas encore dans l'assemblage). */
  instanceId: Id;
  partId: Id;
  name: string;
  leaves: ContextLeaf[];
  /** Contexte pris d'office (l'assemblage ne suit plus le dessin), sans passer par l'onglet Assemblage. */
  auto: boolean;
  /** La pièce modifiée n'est pas encore dans l'assemblage : elle est vue à sa place de dessin. */
  virtual: boolean;
  /** Place de la pièce modifiée dans l'assemblage (liaisons à zéro) : le repère de la vue. */
  matrix: Mat4;
}

/**
 * Vrai si l'assemblage ne se résume plus à « chaque pièce une fois, là où elle a été dessinée » :
 * une pièce déplacée, copiée, tenue par une liaison, ou un bloc. L'onglet Pièces montre alors
 * l'assemblage tel qu'il est, autour de la pièce active.
 */
export function assemblyDiverged(doc: CadDocument): boolean {
  const a = doc.assembly;
  if (!a || a.instances.length === 0) return false;
  if (a.joints.length > 0) return true;
  const seen = new Set<Id>();
  for (const i of a.instances) {
    if (i.subassemblyId || seen.has(i.partId)) return true;
    seen.add(i.partId);
    const p = i.position;
    const r = i.rotation;
    if (p.x !== 0 || p.y !== 0 || p.z !== 0 || (r && (r.x !== 0 || r.y !== 0 || r.z !== 0))) return true;
  }
  return false;
}

let lastContext: { assembly: Assembly; subs: CadDocument['subassemblies']; display: AppState['display']; partId: Id; key: Id | null; auto: boolean; result: ActiveContext | null } | null = null;

/**
 * Contexte actif, dans l'onglet Pièces. Soit celui choisi (« Modifier dans l'assemblage », clic sur
 * une voisine), tant que sa pièce est la pièce active ; soit, dès que l'assemblage ne suit plus le
 * dessin (voir `assemblyDiverged`), celui de la pièce active, pris d'office : sa première place
 * dans l'assemblage, ou sa place de dessin si elle n'y est pas encore. Sinon null (la vue est
 * celle des pièces seules, dans leur repère commun).
 */
export function activeContext(s: AppState): ActiveContext | null {
  const assembly = s.doc.assembly;
  if (s.workspace !== 'parts' || !assembly || s.doc.editingSubassembly) return null;
  const chosen = s.assemblyContext?.instanceId ?? null;
  if (!chosen && !assemblyDiverged(s.doc)) return null;
  const last = lastContext;
  if (last && last.assembly === assembly && last.subs === s.doc.subassemblies && last.display === s.display && last.partId === s.activePartId && last.key === chosen && last.auto === !!s.assemblyContext?.auto) return last.result;
  const meshOf = (partId: Id) => s.display[partId]?.mesh;
  const options: SolveOptions = { sketchesOf: (partId) => s.display[partId]?.result.sketches, subassemblyOf: (id) => subassemblyContent(s.doc, id) };
  const reference = referenceAssembly(assembly);
  const leaves = flattenAssembly(reference, solveAssembly(reference, meshOf, options), meshOf, options);
  let own = chosen ? leaves.find((l) => l.key === chosen && l.partId === s.activePartId) : undefined;
  let result: ActiveContext | null = null;
  if (own) {
    const inverse = invertRigid4(own.matrix);
    const key = own.key;
    result = { instanceId: key, partId: own.partId, name: own.name, leaves: leaves.filter((l) => l.key !== key).map((l) => ({ ...l, local: multiply4(inverse, l.matrix) })), auto: !!s.assemblyContext?.auto, virtual: false, matrix: own.matrix };
  } else if (assemblyDiverged(s.doc)) {
    own = leaves.find((l) => l.partId === s.activePartId);
    const inverse = own ? invertRigid4(own.matrix) : null;
    const key = own?.key ?? '';
    result = {
      instanceId: key,
      partId: s.activePartId,
      name: own?.name ?? s.doc.parts.find((p) => p.id === s.activePartId)?.name ?? '',
      leaves: leaves.filter((l) => l.key !== key).map((l) => ({ ...l, local: inverse ? multiply4(inverse, l.matrix) : l.matrix })),
      auto: true,
      virtual: !own,
      matrix: own?.matrix ?? identity4(),
    };
  }
  lastContext = { assembly, subs: s.doc.subassemblies, display: s.display, partId: s.activePartId, key: chosen, auto: !!s.assemblyContext?.auto, result };
  return result;
}

/** Clé d'affichage d'une pièce voisine (préfixe `ctx:` + clé de la pièce dépliée). */
export const CONTEXT_PREFIX = 'ctx:';

/**
 * Recalcule la position des voisines dans les références en contexte (faces d'appui, arêtes
 * reprises), d'après l'assemblage du document en position de référence ; les liens figés et les
 * voisines introuvables (insertion retirée) gardent leur dernière position. Renvoie le même objet
 * si rien ne change.
 */
export function syncContexts(
  doc: CadDocument,
  meshOf: (partId: Id) => MeshData | null | undefined,
  sketchesOf?: SolveOptions['sketchesOf'],
): CadDocument {
  const assembly = doc.assembly;
  if (!assembly) return doc;
  const cache = new Map<Id, ContextLeaf[] | null>();
  const options: SolveOptions = { ...(sketchesOf ? { sketchesOf } : {}), subassemblyOf: (id) => subassemblyContent(doc, id) };
  const update = (ctx: AssemblyContext): AssemblyContext => {
    if (ctx.frozen) return ctx;
    if (!cache.has(ctx.instanceId)) cache.set(ctx.instanceId, contextLeaves(assembly, ctx.instanceId, meshOf, options));
    const leaf = cache.get(ctx.instanceId)?.find((l) => l.key === ctx.otherInstanceId);
    return leaf && !sameMatrix(leaf.local, ctx.matrix) ? { ...ctx, matrix: [...leaf.local] } : ctx;
  };
  let changed = false;
  const feature = (f: Feature): Feature => {
    if (f.type !== 'sketch') return f;
    const support = f.params.support;
    const nextSupport = support.kind === 'face' && support.context ? { ...support, context: update(support.context) } : support;
    let entitiesChanged = false;
    const entities = f.params.entities.map((e) => {
      if ((e.type !== 'line' && e.type !== 'circle') || !e.reference?.context) return e;
      const context = update(e.reference.context);
      if (context === e.reference.context) return e;
      entitiesChanged = true;
      return { ...e, reference: { ...e.reference, context } };
    });
    const supportChanged = nextSupport !== support && (nextSupport as { context?: AssemblyContext }).context !== (support as { context?: AssemblyContext }).context;
    if (!supportChanged && !entitiesChanged) return f;
    changed = true;
    return { ...f, params: { ...f.params, support: supportChanged ? nextSupport : support, entities: entitiesChanged ? entities : f.params.entities } };
  };
  const parts = doc.parts.map((p) => {
    const features = p.features.map(feature);
    return features.some((f, i) => f !== p.features[i]) ? { ...p, features } : p;
  });
  return changed ? { ...doc, parts } : doc;
}

/** Repère `frame` déplacé par la matrice `m` (pour l'exprimer dans le repère d'une autre pièce). */
export function frameInFrame(m: Mat4, frame: Frame3D): Frame3D {
  return {
    origin: transformPoint4(m, frame.origin),
    xAxis: transformDirection4(m, frame.xAxis),
    yAxis: transformDirection4(m, frame.yAxis),
    normal: transformDirection4(m, frame.normal),
  };
}
