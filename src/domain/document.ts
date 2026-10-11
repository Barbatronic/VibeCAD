/**
 * Opérations pures sur le document (aucune mutation). Les dépendances entre fonctions sont
 * fournies par un résolveur injecté (`DependencyResolver`), pour que le domaine ne dépende pas
 * du registre des fonctions.
 */
import { createId } from './ids';
import type {
  LoftFeature,
  ShellFeature,
  PrimitiveFeature,
  PrimitiveShape,
  MirrorFeature,
  MirrorParams,
  MirrorPlane,
  PatternFeature,
  PatternParams,
  RevolveAxis,
  RevolveFeature,
  Assembly,
  AssemblyInstance,
  AssemblyJoint,
  JointKind,
  CadDocument,
  ChamferFeature,
  EdgeRef,
  ExtentDirection,
  ExtrudeFeature,
  FaceRef,
  Feature,
  FeatureType,
  FilletFeature,
  Id,
  ImportedSolidFeature,
  Part,
  PocketExtent,
  PocketFeature,
  Resource,
  SketchFeature,
  SketchSupport,
} from './model';

export type DependencyResolver = (feature: Feature) => Id[];

export const PART_COLORS = ['#4f86c6', '#e08a3c', '#57a35b', '#a676c2', '#d05c5c', '#3fa7a3'] as const;

const FEATURE_PREFIX: Record<FeatureType, string> = {
  sketch: 'Esquisse',
  extrude: 'Extrusion',
  pocket: 'Poche',
  revolve: 'Révolution',
  'imported-solid': 'Solide importé',
  fillet: 'Congé',
  chamfer: 'Chanfrein',
  pattern: 'Répétition',
  mirror: 'Symétrie',
  primitive: 'Forme',
  shell: 'Coque',
  loft: 'Lissage',
};

export function nowIso(): string {
  return new Date().toISOString();
}

function allIds(doc: CadDocument): Set<string> {
  const ids = new Set<string>([doc.id]);
  for (const p of doc.parts) {
    ids.add(p.id);
    for (const f of p.features) ids.add(f.id);
  }
  for (const r of Object.keys(doc.resources)) ids.add(r);
  return ids;
}

export function createDocument(name = 'Projet sans titre'): CadDocument {
  const now = nowIso();
  const doc: CadDocument = {
    id: createId('doc'),
    name,
    units: 'mm',
    parts: [],
    resources: {},
    createdAt: now,
    modifiedAt: now,
  };
  return addPart(doc).doc;
}

export function nextPartName(doc: CadDocument): string {
  let n = doc.parts.length + 1;
  const names = new Set(doc.parts.map((p) => p.name));
  while (names.has(`Pièce ${n}`)) n++;
  return `Pièce ${n}`;
}

export function addPart(doc: CadDocument, name?: string): { doc: CadDocument; partId: Id } {
  const partId = createId('part', allIds(doc));
  const part: Part = {
    id: partId,
    name: name ?? nextPartName(doc),
    color: PART_COLORS[doc.parts.length % PART_COLORS.length]!,
    visible: true,
    features: [],
  };
  return { doc: { ...doc, parts: [...doc.parts, part] }, partId };
}

export function findPart(doc: CadDocument, partId: Id): Part | undefined {
  return doc.parts.find((p) => p.id === partId);
}

export function findFeature(doc: CadDocument, featureId: Id): { part: Part; feature: Feature; index: number } | undefined {
  for (const part of doc.parts) {
    const index = part.features.findIndex((f) => f.id === featureId);
    if (index >= 0) return { part, feature: part.features[index]!, index };
  }
  return undefined;
}

export function updatePart(doc: CadDocument, partId: Id, update: (part: Part) => Part): CadDocument {
  return { ...doc, parts: doc.parts.map((p) => (p.id === partId ? update(p) : p)) };
}

export function renamePart(doc: CadDocument, partId: Id, name: string): CadDocument {
  return updatePart(doc, partId, (p) => ({ ...p, name }));
}

export function setPartVisible(doc: CadDocument, partId: Id, visible: boolean): CadDocument {
  return updatePart(doc, partId, (p) => ({ ...p, visible }));
}

export function setPartColor(doc: CadDocument, partId: Id, color: string): CadDocument {
  return updatePart(doc, partId, (p) => ({ ...p, color }));
}

export function removePart(doc: CadDocument, partId: Id): CadDocument {
  let next: CadDocument = { ...doc, parts: doc.parts.filter((p) => p.id !== partId) };
  // Les insertions de cette pièce dans l'assemblage (et leurs liaisons) disparaissent avec elle.
  const gone = (doc.assembly?.instances ?? []).filter((i) => i.partId === partId).map((i) => i.id);
  for (const id of gone) next = removeInstance(next, id);
  return collectUnusedResources(next);
}

// ---------------------------------------------------------------------------
// Assemblage

export function emptyAssembly(): Assembly {
  return { instances: [], joints: [] };
}

/** Insère une pièce dans l'assemblage, posée à côté des autres (la première est fixe, à l'origine). */
export function addInstance(doc: CadDocument, partId: Id, position: { x: number; y: number; z: number }): { doc: CadDocument; instanceId: Id } {
  const assembly = doc.assembly ?? emptyAssembly();
  const part = findPart(doc, partId);
  const taken = new Set(assembly.instances.map((i) => i.id));
  const id = createId('in', taken);
  const count = assembly.instances.filter((i) => i.partId === partId).length;
  const name = `${part?.name ?? 'Pièce'}${count > 0 ? ` (${count + 1})` : ''}`;
  const instance: AssemblyInstance = { id, partId, name, position };
  return { doc: { ...doc, assembly: { ...assembly, instances: [...assembly.instances, instance] } }, instanceId: id };
}

/** Retire une pièce insérée et les liaisons qui la concernent. */
export function removeInstance(doc: CadDocument, instanceId: Id): CadDocument {
  const assembly = doc.assembly;
  if (!assembly) return doc;
  return {
    ...doc,
    assembly: {
      instances: assembly.instances.filter((i) => i.id !== instanceId),
      joints: assembly.joints.filter((j) => j.moving.instanceId !== instanceId && j.base.instanceId !== instanceId),
    },
  };
}

export const JOINT_LABELS: Record<JointKind, string> = { fixed: 'Fixe', revolute: 'Pivot', slider: 'Glissière', cylindrical: 'Pivot glissant', spherical: 'Rotule' };

/** Ce que fait chaque liaison, avec un exemple de la vie courante. */
export const JOINT_EXPLANATIONS: Record<JointKind, string> = {
  fixed: 'Les deux pièces sont collées : rien ne bouge, comme une étagère vissée au mur.',
  revolute: 'La pièce tourne autour d’un axe, comme une roue, une porte ou l’aiguille d’une montre.',
  slider: 'La pièce glisse le long d’un axe sans tourner, comme un tiroir.',
  cylindrical: 'La pièce tourne et glisse le long d’un axe, comme un piston ou le siège d’un tabouret à vis.',
  spherical: 'La pièce tourne dans tous les sens autour d’un point, comme l’épaule, une lampe de bureau ou une manette de jeu.',
};

export function addJoint(doc: CadDocument, joint: Omit<AssemblyJoint, 'id' | 'name'>): { doc: CadDocument; jointId: Id } {
  const assembly = doc.assembly ?? emptyAssembly();
  const id = createId('jt', new Set(assembly.joints.map((j) => j.id)));
  const names = new Set(assembly.joints.map((j) => j.name));
  let n = assembly.joints.length + 1;
  while (names.has(`Liaison ${n}`)) n++;
  const full: AssemblyJoint = { ...joint, id, name: `Liaison ${n}` };
  return { doc: { ...doc, assembly: { ...assembly, joints: [...assembly.joints, full] } }, jointId: id };
}

export function updateJoint(doc: CadDocument, jointId: Id, update: (j: AssemblyJoint) => AssemblyJoint): CadDocument {
  const assembly = doc.assembly;
  if (!assembly) return doc;
  return { ...doc, assembly: { ...assembly, joints: assembly.joints.map((j) => (j.id === jointId ? update(j) : j)) } };
}

export function removeJoint(doc: CadDocument, jointId: Id): CadDocument {
  const assembly = doc.assembly;
  if (!assembly) return doc;
  return { ...doc, assembly: { ...assembly, joints: assembly.joints.filter((j) => j.id !== jointId) } };
}

export function updateInstance(doc: CadDocument, instanceId: Id, update: (i: AssemblyInstance) => AssemblyInstance): CadDocument {
  const assembly = doc.assembly;
  if (!assembly) return doc;
  return { ...doc, assembly: { ...assembly, instances: assembly.instances.map((i) => (i.id === instanceId ? update(i) : i)) } };
}

export function nextFeatureName(part: Part, type: FeatureType): string {
  const prefix = FEATURE_PREFIX[type];
  const names = new Set(part.features.map((f) => f.name));
  let n = part.features.filter((f) => f.type === type).length + 1;
  while (names.has(`${prefix} ${n}`)) n++;
  return `${prefix} ${n}`;
}

export function newFeatureId(doc: CadDocument, type: FeatureType): Id {
  const prefix = { sketch: 'sk', extrude: 'ex', pocket: 'po', revolve: 're', 'imported-solid': 'im', fillet: 'fi', chamfer: 'ch', pattern: 'pa', mirror: 'mi', primitive: 'pr', shell: 'sh', loft: 'lo' }[type];
  return createId(prefix, allIds(doc));
}

export function makeSketchFeature(doc: CadDocument, part: Part, support: SketchSupport): SketchFeature {
  return {
    id: newFeatureId(doc, 'sketch'),
    type: 'sketch',
    name: nextFeatureName(part, 'sketch'),
    visible: true,
    params: { support, entities: [], constraints: [] },
  };
}

export function makeExtrudeFeature(
  doc: CadDocument,
  part: Part,
  sketchId: Id,
  distance: number,
  direction: ExtentDirection = 'default',
): ExtrudeFeature {
  return {
    id: newFeatureId(doc, 'extrude'),
    type: 'extrude',
    name: nextFeatureName(part, 'extrude'),
    params: { sketchId, distance, direction },
  };
}

export function makeRevolveFeature(doc: CadDocument, part: Part, sketchId: Id, axis: RevolveAxis, angle = 360, reversed = false): RevolveFeature {
  return { id: newFeatureId(doc, 'revolve'), type: 'revolve', name: nextFeatureName(part, 'revolve'), params: { sketchId, axis, angle, reversed } };
}

/** Étapes qu'une répétition peut copier : celles qui ajoutent ou retirent un volume dessiné. */
export const PATTERN_SOURCE_TYPES: readonly FeatureType[] = ['extrude', 'pocket', 'revolve', 'primitive', 'loft'];

export function makePatternFeature(doc: CadDocument, part: Part, sourceId: Id, kind: PatternParams['kind'] = 'linear'): PatternFeature {
  return {
    id: newFeatureId(doc, 'pattern'),
    type: 'pattern',
    name: nextFeatureName(part, 'pattern'),
    params: { sourceId, kind, axis: { kind: 'axis', axis: kind === 'linear' ? 'X' : 'Z' }, count: kind === 'linear' ? 3 : 6, spacing: 10, angle: 360, reversed: false },
  };
}

export function makeMirrorFeature(doc: CadDocument, part: Part, source: MirrorParams['source'] = { kind: 'part' }, plane: MirrorPlane = { kind: 'plane', plane: 'YZ' }): MirrorFeature {
  return { id: newFeatureId(doc, 'mirror'), type: 'mirror', name: nextFeatureName(part, 'mirror'), params: { source, plane } };
}

export function makePrimitiveFeature(doc: CadDocument, part: Part, shape: PrimitiveShape = 'box', operation: 'add' | 'cut' = 'add'): PrimitiveFeature {
  return {
    id: newFeatureId(doc, 'primitive'),
    type: 'primitive',
    name: nextFeatureName(part, 'primitive'),
    params: { shape, position: { x: 0, y: 0, z: 0 }, width: 20, depth: 20, height: 20, diameter: 20, thickness: 6, operation },
  };
}

export function makeShellFeature(doc: CadDocument, part: Part, open: FaceRef[] = [], thickness = 2): ShellFeature {
  return { id: newFeatureId(doc, 'shell'), type: 'shell', name: nextFeatureName(part, 'shell'), params: { open, thickness, outward: false } };
}

export function makeLoftFeature(doc: CadDocument, part: Part, sketchIds: Id[]): LoftFeature {
  return { id: newFeatureId(doc, 'loft'), type: 'loft', name: nextFeatureName(part, 'loft'), params: { sketchIds, ruled: false, operation: 'add' } };
}

export function makePocketFeature(
  doc: CadDocument,
  part: Part,
  sketchId: Id,
  extent: PocketExtent,
  direction: ExtentDirection = 'default',
): PocketFeature {
  return {
    id: newFeatureId(doc, 'pocket'),
    type: 'pocket',
    name: nextFeatureName(part, 'pocket'),
    params: { sketchId, extent, direction },
  };
}

export function makeImportedSolidFeature(
  doc: CadDocument,
  part: Part,
  resourceId: Id,
  solidIndex: number,
  name?: string,
): ImportedSolidFeature {
  return {
    id: newFeatureId(doc, 'imported-solid'),
    type: 'imported-solid',
    name: name ?? nextFeatureName(part, 'imported-solid'),
    params: { resourceId, solidIndex },
  };
}

export function makeFilletFeature(doc: CadDocument, part: Part, edges: EdgeRef[], radius: number): FilletFeature {
  return { id: newFeatureId(doc, 'fillet'), type: 'fillet', name: nextFeatureName(part, 'fillet'), params: { edges, radius } };
}

export function makeChamferFeature(doc: CadDocument, part: Part, edges: EdgeRef[], distance: number): ChamferFeature {
  return { id: newFeatureId(doc, 'chamfer'), type: 'chamfer', name: nextFeatureName(part, 'chamfer'), params: { edges, distance } };
}

/** Égalité de deux références d'arête (l'ordre des deux faces est indifférent). */
export function sameEdgeRef(a: EdgeRef, b: EdgeRef): boolean {
  const same = (x: FaceRef, y: FaceRef) =>
    x.featureId === y.featureId && x.role === y.role && (x.entityId ?? null) === (y.entityId ?? null) && (x.index ?? null) === (y.index ?? null);
  return (same(a.faces[0], b.faces[0]) && same(a.faces[1], b.faces[1])) || (same(a.faces[0], b.faces[1]) && same(a.faces[1], b.faces[0]));
}

export function addFeature(doc: CadDocument, partId: Id, feature: Feature): CadDocument {
  return updatePart(doc, partId, (p) => ({ ...p, features: [...p.features, feature] }));
}

/** Insère une fonction juste après `afterId` (null : en tête de l'historique de la pièce). */
export function insertFeatureAfter(doc: CadDocument, partId: Id, afterId: Id | null, feature: Feature): CadDocument {
  return updatePart(doc, partId, (p) => {
    const index = afterId === null ? 0 : p.features.findIndex((f) => f.id === afterId) + 1;
    if (afterId !== null && index === 0) return { ...p, features: [...p.features, feature] };
    return { ...p, features: [...p.features.slice(0, index), feature, ...p.features.slice(index)] };
  });
}

export function replaceFeature(doc: CadDocument, feature: Feature): CadDocument {
  return {
    ...doc,
    parts: doc.parts.map((p) =>
      p.features.some((f) => f.id === feature.id) ? { ...p, features: p.features.map((f) => (f.id === feature.id ? feature : f)) } : p,
    ),
  };
}

export function updateFeature<F extends Feature>(doc: CadDocument, featureId: Id, update: (feature: F) => F): CadDocument {
  const found = findFeature(doc, featureId);
  if (!found) return doc;
  return replaceFeature(doc, update(found.feature as F));
}

export function renameFeature(doc: CadDocument, featureId: Id, name: string): CadDocument {
  return updateFeature(doc, featureId, (f) => ({ ...f, name }));
}

/** Fonctions de la pièce qui dépendent (directement ou non) des fonctions données. */
export function dependentsOf(part: Part, featureIds: Iterable<Id>, dependenciesOf: DependencyResolver): Id[] {
  const affected = new Set(featureIds);
  const out: Id[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of part.features) {
      if (affected.has(f.id)) continue;
      if (dependenciesOf(f).some((d) => affected.has(d))) {
        affected.add(f.id);
        out.push(f.id);
        changed = true;
      }
    }
  }
  return out;
}

/** Supprime des fonctions et toutes celles qui en dépendent ; renvoie la liste supprimée. */
export function removeFeaturesCascade(
  doc: CadDocument,
  partId: Id,
  featureIds: Id[],
  dependenciesOf: DependencyResolver,
): { doc: CadDocument; removed: Id[] } {
  const part = findPart(doc, partId);
  if (!part) return { doc, removed: [] };
  const removed = [...featureIds.filter((id) => part.features.some((f) => f.id === id)), ...dependentsOf(part, featureIds, dependenciesOf)];
  const set = new Set(removed);
  const next = updatePart(doc, partId, (p) => ({ ...p, features: p.features.filter((f) => !set.has(f.id)) }));
  return { doc: collectUnusedResources(next), removed };
}

export function addResource(doc: CadDocument, resource: Resource): CadDocument {
  return { ...doc, resources: { ...doc.resources, [resource.id]: resource } };
}

export function newResourceId(doc: CadDocument): Id {
  return createId('res', allIds(doc));
}

/** Retire les ressources embarquées qui ne sont plus utilisées par aucune fonction. */
export function collectUnusedResources(doc: CadDocument): CadDocument {
  const used = new Set<Id>();
  for (const p of doc.parts) for (const f of p.features) if (f.type === 'imported-solid') used.add(f.params.resourceId);
  const ids = Object.keys(doc.resources);
  if (ids.every((id) => used.has(id))) return doc;
  const resources: Record<Id, Resource> = {};
  for (const id of ids) if (used.has(id)) resources[id] = doc.resources[id]!;
  return { ...doc, resources };
}

export function sketchesOf(part: Part): SketchFeature[] {
  return part.features.filter((f): f is SketchFeature => f.type === 'sketch');
}
