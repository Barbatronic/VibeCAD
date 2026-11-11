/**
 * Ensembles de la liste des pièces : un ensemble est un sous-assemblage (voir `subassemblies.ts`)
 * manié depuis la liste. Y ranger une pièce déplace ses exemplaires de l'assemblage principal vers
 * le sous-assemblage, qui est inséré comme un bloc dans l'assemblage : l'ensemble se déplace alors
 * d'un seul tenant. Toutes les fonctions travaillent sur le document refermé.
 */
import { removeInstance } from './document';
import { createId } from './ids';
import { eulerXYZ, identity4, invertRigid4, multiply4, rotationXYZ4, translation4, type Mat4 } from '../math/mat4';
import type { Assembly, AssemblyInstance, CadDocument, Id } from './model';
import { addSubassembly, addSubassemblyInstance, closedDocument, removeSubassembly } from './subassemblies';

type Vec = { x: number; y: number; z: number };
const ZERO: Vec = { x: 0, y: 0, z: 0 };

/** Placement d'un exemplaire libre : position puis orientation (comme `instanceMatrix` de l'assemblage). */
function poseMatrix(i: Pick<AssemblyInstance, 'position' | 'rotation'>): Mat4 {
  const r = i.rotation;
  return r && (r.x || r.y || r.z) ? multiply4(translation4(i.position), rotationXYZ4(r)) : translation4(i.position);
}

/** Position et orientation d'un placement (arrondies : pas de bruit de calcul dans le fichier). */
function poseOf(m: Mat4): Pick<AssemblyInstance, 'position' | 'rotation'> {
  const round = (v: number) => Math.round(v * 1e6) / 1e6 || 0;
  const e = eulerXYZ(m);
  const rotation = { x: round(e.x), y: round(e.y), z: round(e.z) };
  return { position: { x: round(m[12]!), y: round(m[13]!), z: round(m[14]!) }, ...(rotation.x || rotation.y || rotation.z ? { rotation } : {}) };
}

/** Exemplaire replacé par `shift` (matrice appliquée à son placement). */
function moved(inst: AssemblyInstance, shift: Mat4): Omit<AssemblyInstance, 'id'> {
  const { id: _id, position: _p, rotation: _r, ...rest } = inst;
  return { ...rest, ...poseOf(multiply4(shift, poseMatrix(inst))) };
}

/** Contenu d'un conteneur : l'assemblage principal (`null`) ou un ensemble. */
function content(doc: CadDocument, container: Id | null): Assembly {
  if (container === null) return doc.assembly ?? { instances: [], joints: [] };
  const sub = doc.subassemblies?.find((s) => s.id === container);
  if (!sub) return { instances: [], joints: [] };
  const { id: _id, name: _name, ...rest } = sub;
  return rest;
}

function setContent(doc: CadDocument, container: Id | null, assembly: Assembly): CadDocument {
  if (container === null) return { ...doc, assembly };
  return { ...doc, subassemblies: doc.subassemblies?.map((s) => (s.id === container ? { ...assembly, id: s.id, name: s.name } : s)) };
}

/** Retire un exemplaire de son conteneur, avec les liaisons et la visserie qui le concernent. */
function removeFrom(doc: CadDocument, container: Id | null, instanceId: Id): CadDocument {
  const inner = removeInstance({ ...doc, assembly: content(doc, container) }, instanceId).assembly!;
  return setContent(doc, container, inner);
}

function addTo(doc: CadDocument, container: Id | null, inst: Omit<AssemblyInstance, 'id'>): CadDocument {
  const assembly = content(doc, container);
  const id = createId('in', new Set(assembly.instances.map((i) => i.id)));
  return setContent(doc, container, { ...assembly, instances: [...assembly.instances, { ...inst, id }] });
}

/** Blocs de l'ensemble insérés dans l'assemblage principal. */
function blocks(doc: CadDocument, subId: Id): AssemblyInstance[] {
  return (doc.assembly?.instances ?? []).filter((i) => i.subassemblyId === subId);
}

/**
 * Place du (premier) bloc de l'ensemble dans l'assemblage : sert à garder une pièce où elle est
 * quand elle entre dans l'ensemble ou en sort (identité si l'ensemble n'est pas encore inséré).
 * Le bloc est pris là où il est posé, sans tenir compte d'une liaison qui le déplacerait.
 */
function blockMatrix(doc: CadDocument, subId: Id | null): Mat4 {
  const block = subId ? blocks(doc, subId)[0] : undefined;
  return block ? poseMatrix(block) : identity4();
}

/** Ensemble où la pièce est rangée (le premier qui en contient un exemplaire), sinon `null`. */
export function ensembleOf(docIn: CadDocument, partId: Id): Id | null {
  const doc = closedDocument(docIn);
  return doc.subassemblies?.find((s) => s.instances.some((i) => i.partId === partId && !i.subassemblyId))?.id ?? null;
}

/** Vrai si un exemplaire de la pièce, là où elle est rangée, porte une liaison ou une vis. */
export function partIsJointed(docIn: CadDocument, partId: Id): boolean {
  const doc = closedDocument(docIn);
  const a = content(doc, ensembleOf(doc, partId));
  const ids = new Set(a.instances.filter((i) => i.partId === partId && !i.subassemblyId).map((i) => i.id));
  return a.joints.some((j) => ids.has(j.base.instanceId) || ids.has(j.moving.instanceId)) || !!a.fasteners?.some((f) => ids.has(f.at.instanceId));
}

/** Range une pièce dans un ensemble, ou la remet dans l'assemblage principal (`null`), sans la déplacer. */
export function movePartToEnsemble(docIn: CadDocument, partId: Id, subId: Id | null): CadDocument {
  let doc = closedDocument(docIn);
  const part = doc.parts.find((p) => p.id === partId);
  const from = ensembleOf(doc, partId);
  if (!part || from === subId || (subId !== null && !doc.subassemblies?.some((s) => s.id === subId))) return docIn;
  const mine = content(doc, from).instances.filter((i) => i.partId === partId && !i.subassemblyId);
  // Pièce encore nulle part dans l'assemblage : elle y entre à sa place de dessin.
  const list: AssemblyInstance[] = mine.length ? mine : [{ id: '', partId, name: part.name, position: ZERO }];
  // Du conteneur de départ vers le monde, puis du monde vers le conteneur d'arrivée.
  const shift = multiply4(invertRigid4(blockMatrix(doc, subId)), blockMatrix(doc, from));
  for (const inst of list) {
    if (inst.id) doc = removeFrom(doc, from, inst.id);
    doc = addTo(doc, subId, moved(inst, shift));
  }
  if (subId && blocks(doc, subId).length === 0) doc = addSubassemblyInstance(doc, subId, ZERO).doc;
  // Ensemble vidé : son bloc quitte l'assemblage (l'ensemble reste dans la liste, vide).
  if (from && content(doc, from).instances.length === 0) for (const b of blocks(doc, from)) doc = removeFrom(doc, null, b.id);
  return doc;
}

/** Nouvel ensemble (« Ensemble n ») contenant la pièce donnée. */
export function createEnsemble(docIn: CadDocument, partId: Id): { doc: CadDocument; id: Id } {
  const doc = closedDocument(docIn);
  const names = new Set((doc.subassemblies ?? []).map((s) => s.name));
  let n = 1;
  while (names.has(`Ensemble ${n}`)) n++;
  const r = addSubassembly(doc, `Ensemble ${n}`);
  return { doc: movePartToEnsemble(r.doc, partId, r.id), id: r.id };
}

/** Défait un ensemble : son contenu revient dans l'assemblage principal, ses liaisons internes sont perdues. */
export function dissolveEnsemble(docIn: CadDocument, subId: Id): CadDocument {
  let doc = closedDocument(docIn);
  if (!doc.subassemblies?.some((s) => s.id === subId)) return docIn;
  const shift = blockMatrix(doc, subId);
  const inside = content(doc, subId).instances;
  for (const b of blocks(doc, subId)) doc = removeFrom(doc, null, b.id);
  for (const inst of inside) doc = addTo(doc, null, moved(inst, shift));
  return removeSubassembly(doc, subId);
}

/**
 * Copie liée d'une pièce : un exemplaire de plus, là où elle est rangée, décalé de `dx` mm du
 * dernier. Tous les exemplaires partagent la forme de la pièce.
 */
export function addLinkedCopy(docIn: CadDocument, partId: Id, dx: number): CadDocument {
  let doc = closedDocument(docIn);
  const part = doc.parts.find((p) => p.id === partId);
  if (!part) return docIn;
  const container = ensembleOf(doc, partId);
  let mine = content(doc, container).instances.filter((i) => i.partId === partId && !i.subassemblyId);
  if (mine.length === 0) {
    doc = addTo(doc, container, { partId, name: part.name, position: ZERO });
    mine = content(doc, container).instances.filter((i) => i.partId === partId && !i.subassemblyId);
  }
  const last = mine[mine.length - 1]!;
  const { id: _id, jointValues: _v, flexible: _f, ...rest } = last;
  return addTo(doc, container, { ...rest, name: `${part.name} (${mine.length + 1})`, position: { x: last.position.x + dx, y: last.position.y, z: last.position.z } });
}

/** Renomme un ensemble, et ses blocs insérés qui portaient encore son nom (« Nom », « Nom (2) »). */
export function renameEnsemble(docIn: CadDocument, subId: Id, name: string): CadDocument {
  const doc = closedDocument(docIn);
  const old = doc.subassemblies?.find((s) => s.id === subId)?.name;
  if (old === undefined || old === name) return docIn;
  const rename = (i: AssemblyInstance): AssemblyInstance => {
    if (i.subassemblyId !== subId) return i;
    if (i.name === old) return { ...i, name };
    const suffix = /^ \(\d+\)$/.test(i.name.slice(old.length)) && i.name.startsWith(old) ? i.name.slice(old.length) : null;
    return suffix ? { ...i, name: `${name}${suffix}` } : i;
  };
  return {
    ...doc,
    ...(doc.assembly ? { assembly: { ...doc.assembly, instances: doc.assembly.instances.map(rename) } } : {}),
    subassemblies: doc.subassemblies!.map((s) => ({ ...s, ...(s.id === subId ? { name } : {}), instances: s.instances.map(rename) })),
  };
}
