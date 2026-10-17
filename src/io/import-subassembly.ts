/**
 * Import d'un autre projet `.vibecad` comme sous-assemblage : ses pièces rejoignent le projet,
 * son assemblage devient un sous-assemblage (ses propres sous-assemblages aussi), prêt à être
 * inséré. Les identifiants importés (pièces, étapes, ressources, sous-assemblages) sont renommés
 * pour ne pas entrer en collision ; les équations sont figées à leur valeur (les paramètres du
 * projet importé ne sont pas repris).
 */
import { createId } from '../domain/ids';
import type { CadDocument, Feature, Id, Part, Resource, SubAssembly, Assembly } from '../domain/model';
import { closedDocument } from '../domain/subassemblies';
import { parseNativeFile } from './native-format';

export type SubassemblyImport =
  | { ok: true; doc: CadDocument; subassemblyId: Id; name: string; parts: number; warnings: string[] }
  | { ok: false; error: string };

/** Étape sans équation (la valeur calculée est déjà dans ses paramètres). */
function frozen(f: Feature): Feature {
  const { expressions: _e, ...rest } = f;
  if (rest.type !== 'sketch') return rest as Feature;
  return { ...rest, params: { ...rest.params, constraints: rest.params.constraints.map((c) => ('expression' in c ? (({ expression: _x, ...k }) => k)(c) : c)) } } as Feature;
}

const prefixOf = (id: string) => (id.includes('-') ? id.slice(0, id.indexOf('-')) : 'id');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function importProjectAsSubassembly(docIn: CadDocument, text: string, fileName: string): SubassemblyImport {
  const parsed = parseNativeFile(text);
  if (!parsed.ok) return { ok: false, error: `« ${fileName} » ne peut pas être lu : ${parsed.error}` };
  const src = closedDocument(parsed.doc);
  if (!src.assembly?.instances.length) {
    return { ok: false, error: `« ${src.name} » n’a pas d’assemblage : ouvrez-le, insérez ses pièces dans l’onglet Assemblage et enregistrez-le, puis importez-le à nouveau.` };
  }
  // Identifiants déjà pris dans le projet (ouvert ou non sur un sous-assemblage).
  const doc = docIn;
  const taken = new Set<string>([doc.id, ...doc.parts.flatMap((p) => [p.id, ...p.features.map((f) => f.id)]), ...Object.keys(doc.resources), ...(doc.subassemblies ?? []).map((s) => s.id)]);
  const mapping = new Map<string, string>();
  const rename = (old: string) => {
    if (mapping.has(old)) return;
    const next = createId(prefixOf(old), taken);
    taken.add(next);
    mapping.set(old, next);
  };
  for (const p of src.parts) {
    rename(p.id);
    for (const f of p.features) rename(f.id);
  }
  for (const r of Object.keys(src.resources)) rename(r);
  for (const s of src.subassemblies ?? []) rename(s.id);
  // Remplacement des identifiants dans tout le contenu importé (valeurs et clés exactes).
  let json = JSON.stringify({ parts: src.parts, resources: src.resources, assembly: src.assembly, subassemblies: src.subassemblies ?? [] });
  for (const [old, next] of mapping) json = json.replace(new RegExp(`"${escape(old)}"`, 'g'), `"${next}"`);
  const imported = JSON.parse(json) as { parts: Part[]; resources: Record<Id, Resource>; assembly: Assembly; subassemblies: SubAssembly[] };
  // Pièces : équations figées ; un nom déjà pris reçoit le nom du projet importé.
  const names = new Set(doc.parts.map((p) => p.name));
  const parts = imported.parts.map((p) => ({ ...p, name: names.has(p.name) ? `${p.name} (${src.name})` : p.name, features: p.features.map(frozen) }));
  // Le sous-assemblage prend le nom du projet (numéroté s'il existe déjà).
  const subNames = new Set([...(doc.subassemblies ?? []).map((s) => s.name), ...imported.subassemblies.map((s) => s.name)]);
  let name = src.name;
  for (let n = 2; subNames.has(name); n++) name = `${src.name} (${n})`;
  const subassemblyId = createId('sa', taken);
  const sub: SubAssembly = { ...imported.assembly, id: subassemblyId, name };
  const warnings = [...parsed.warnings];
  if (src.parameters?.length) warnings.push('Les paramètres du projet importé ne sont pas repris : ses cotes et champs gardent leur valeur actuelle.');
  return {
    ok: true,
    doc: { ...doc, parts: [...doc.parts, ...parts], resources: { ...doc.resources, ...imported.resources }, subassemblies: [...(doc.subassemblies ?? []), ...imported.subassemblies, sub] },
    subassemblyId,
    name,
    parts: parts.length,
    warnings,
  };
}
