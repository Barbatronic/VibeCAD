/**
 * Sous-assemblages : des assemblages nommés, insérés dans d'autres comme un bloc rigide.
 *
 * Pour en modifier un, le document « l'ouvre » : son contenu passe dans `assembly` (là où tous les
 * outils de l'onglet Assemblage travaillent) et l'assemblage principal prend sa place dans
 * `subassemblies`, sous le même identifiant ; `editingSubassembly` le rappelle. Fermer fait
 * l'échange inverse. Un document est toujours enregistré fermé (`closedDocument`).
 */
import { createId } from './ids';
import type { Assembly, AssemblyFastener, AssemblyInstance, CadDocument, Id, SubAssembly } from './model';

const contentOf = (s: SubAssembly): Assembly => {
  const { id: _id, name: _name, ...rest } = s;
  return rest;
};

/** Document avec le sous-assemblage `id` ouvert (un autre ouvert est d'abord refermé). */
export function openSubassembly(doc: CadDocument, id: Id): CadDocument {
  const closed = closedDocument(doc);
  const sub = closed.subassemblies?.find((s) => s.id === id);
  if (!sub) return closed;
  const main: Assembly = closed.assembly ?? { instances: [], joints: [] };
  return {
    ...closed,
    assembly: contentOf(sub),
    subassemblies: closed.subassemblies!.map((s) => (s.id === id ? { ...main, id: s.id, name: s.name } : s)),
    editingSubassembly: id,
  };
}

/** Document refermé : l'assemblage principal à sa place, chaque sous-assemblage dans la liste. */
export function closedDocument(doc: CadDocument): CadDocument {
  const id = doc.editingSubassembly;
  if (!id) return doc;
  const { editingSubassembly: _e, ...rest } = doc;
  const slot = doc.subassemblies?.find((s) => s.id === id);
  if (!slot) return rest;
  const edited: SubAssembly = { ...(doc.assembly ?? { instances: [], joints: [] }), id, name: slot.name };
  const main = contentOf(slot);
  const hasMain = main.instances.length > 0 || main.joints.length > 0 || !!main.fasteners?.length || !!main.couplings?.length;
  const { assembly: _a, ...withoutAssembly } = rest;
  return {
    ...(hasMain ? { ...withoutAssembly, assembly: main } : withoutAssembly),
    subassemblies: doc.subassemblies!.map((s) => (s.id === id ? edited : s)),
  };
}

/** Sous-assemblages tels qu'enregistrés (le contenu réel de celui qui est ouvert). */
export function subassemblyList(doc: CadDocument): SubAssembly[] {
  return closedDocument(doc).subassemblies ?? [];
}

/** Contenu d'un sous-assemblage (celui qui est ouvert : son contenu en cours de modification). */
export function subassemblyContent(doc: CadDocument, id: Id): Assembly | undefined {
  if (doc.editingSubassembly === id) return doc.assembly ?? { instances: [], joints: [] };
  const s = doc.subassemblies?.find((x) => x.id === id);
  return s ? contentOf(s) : undefined;
}

/** Nouveau sous-assemblage vide, nommé « Sous-assemblage n ». */
export function addSubassembly(doc: CadDocument, name?: string): { doc: CadDocument; id: Id } {
  const list = doc.subassemblies ?? [];
  const id = createId('sa', new Set(list.map((s) => s.id)));
  let n = list.length + 1;
  while (list.some((s) => s.name === `Sous-assemblage ${n}`)) n++;
  return { doc: { ...doc, subassemblies: [...list, { id, name: name ?? `Sous-assemblage ${n}`, instances: [], joints: [] }] }, id };
}

export function renameSubassembly(doc: CadDocument, id: Id, name: string): CadDocument {
  return { ...doc, subassemblies: doc.subassemblies?.map((s) => (s.id === id ? { ...s, name } : s)) };
}

/** Assemblages qui insèrent ce sous-assemblage (« l'assemblage principal », « Sous-assemblage 2 »…). */
export function subassemblyUses(doc: CadDocument, id: Id): string[] {
  const closed = closedDocument(doc);
  const out: string[] = [];
  if (closed.assembly?.instances.some((i) => i.subassemblyId === id)) out.push('l’assemblage principal');
  for (const s of closed.subassemblies ?? []) if (s.instances.some((i) => i.subassemblyId === id)) out.push(`« ${s.name} »`);
  return out;
}

/** Insère un sous-assemblage comme un bloc (nommé comme lui, numéroté s'il est déjà inséré). */
export function addSubassemblyInstance(doc: CadDocument, subId: Id, position: { x: number; y: number; z: number }): { doc: CadDocument; instanceId: Id } {
  const assembly = doc.assembly ?? { instances: [], joints: [] };
  const sub = subassemblyList(doc).find((s) => s.id === subId);
  const id = createId('in', new Set(assembly.instances.map((i) => i.id)));
  const count = assembly.instances.filter((i) => i.subassemblyId === subId).length;
  const instance: AssemblyInstance = { id, partId: '', subassemblyId: subId, name: `${sub?.name ?? 'Sous-assemblage'}${count > 0 ? ` (${count + 1})` : ''}`, position };
  return { doc: { ...doc, assembly: { ...assembly, instances: [...assembly.instances, instance] } }, instanceId: id };
}

/**
 * Contenu complet d'un assemblage, blocs compris (pour la nomenclature) : nombre d'exemplaires de
 * chaque pièce et toute la visserie (celle d'un bloc inséré deux fois compte deux fois).
 */
export function assemblyContents(doc: CadDocument, assembly: Assembly | undefined, depth = 0): { counts: Map<Id, number>; fasteners: AssemblyFastener[] } {
  const counts = new Map<Id, number>();
  const fasteners: AssemblyFastener[] = [...(assembly?.fasteners ?? [])];
  if (!assembly || depth > 8) return { counts, fasteners };
  for (const inst of assembly.instances) {
    if (!inst.subassemblyId) {
      counts.set(inst.partId, (counts.get(inst.partId) ?? 0) + 1);
      continue;
    }
    const inner = assemblyContents(doc, subassemblyContent(doc, inst.subassemblyId), depth + 1);
    for (const [id, n] of inner.counts) counts.set(id, (counts.get(id) ?? 0) + n);
    for (const f of inner.fasteners) fasteners.push({ ...f, id: `${inst.id}/${f.id}` });
  }
  return { counts, fasteners };
}

/** Supprime un sous-assemblage (à vérifier avant : il ne doit être inséré nulle part). */
export function removeSubassembly(doc: CadDocument, id: Id): CadDocument {
  const closed = closedDocument(doc);
  const list = (closed.subassemblies ?? []).filter((s) => s.id !== id);
  const { subassemblies: _s, ...rest } = closed;
  return list.length ? { ...rest, subassemblies: list } : rest;
}

/** Vrai si le sous-assemblage `outer` contient `inner`, directement ou à travers d'autres blocs. */
export function subassemblyContains(doc: CadDocument, outer: Id, inner: Id, seen = new Set<Id>()): boolean {
  if (outer === inner) return true;
  if (seen.has(outer)) return false;
  seen.add(outer);
  const content = subassemblyContent(doc, outer);
  return !!content?.instances.some((i) => i.subassemblyId && subassemblyContains(doc, i.subassemblyId, inner, seen));
}
