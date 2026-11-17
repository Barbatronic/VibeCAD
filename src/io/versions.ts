/**
 * Historique des versions d'un projet : opérations (créer une version, branches, retour à une
 * version, comparaison, tracé du graphe). Fonctions pures ; le stockage est dans `version-store`.
 */
import type { CadDocument, Id } from '../domain/model';
import { APP_NAME, APP_VERSION } from '../meta';
import { FORMAT_ID, parseNativeFile, SCHEMA_VERSION, toNativeFile, type ParseOutcome } from './native-format';
import { canonicalText, DEFAULT_BRANCH, hashText, type VersionCommit, type VersionHistory } from './version-store';

/** Contenu d'un projet découpé comme dans une version, avec les textes désignés par les empreintes. */
export interface VersionTree {
  shell: string;
  parts: string[];
  resources: Id[];
  texts: Record<string, string>;
}

/**
 * Découpe le projet : une entrée par pièce, et la coquille (tout le reste). L'identité du projet
 * (identifiant, nom, dates) n'en fait pas partie : revenir à une version ne renomme pas le projet.
 */
export function treeOf(doc: CadDocument): VersionTree {
  const { parts, resources, id: _id, name: _name, createdAt: _createdAt, modifiedAt: _modifiedAt, ...shell } = toNativeFile(doc, '').document;
  const texts: Record<string, string> = {};
  const put = (value: unknown): string => {
    const text = canonicalText(value);
    const hash = hashText(text);
    texts[hash] = text;
    return hash;
  };
  return { shell: put(shell), parts: parts.map(put), resources: Object.keys(resources), texts };
}

export function sameTree(a: { shell: string; parts: string[] }, b: { shell: string; parts: string[] }): boolean {
  return a.shell === b.shell && a.parts.length === b.parts.length && a.parts.every((p, i) => p === b.parts[i]);
}

export const commitOf = (h: VersionHistory, id: string): VersionCommit | undefined => h.commits.find((c) => c.id === id);
export const headOf = (h: VersionHistory, branch = h.current): VersionCommit | undefined => commitOf(h, h.branches.find((b) => b.name === branch)?.head ?? '');

/**
 * Nouvelle version sur la branche de travail. `null` : rien n'a changé depuis la dernière.
 * `merged` : versions fusionnées dans celle-ci (elle est alors créée même sans changement).
 * `h.objects` doit être décodé.
 */
export function createVersion(h: VersionHistory | null, doc: CadDocument, message: string, date: string, merged: string[] = []): VersionHistory | null {
  const tree = treeOf(doc);
  const head = h ? headOf(h) : undefined;
  if (head && sameTree(head, tree) && merged.length === 0) return null;
  const body = { parents: [...(head ? [head.id] : []), ...merged], message, date, schemaVersion: SCHEMA_VERSION, shell: tree.shell, parts: tree.parts, resources: tree.resources };
  const commit: VersionCommit = { id: hashText(JSON.stringify(body)), ...body };
  const current = h?.current ?? DEFAULT_BRANCH;
  const branches = h ? h.branches.map((b) => (b.name === current ? { ...b, head: commit.id } : b)) : [{ name: current, head: commit.id }];
  return {
    commits: [...(h?.commits ?? []), commit],
    branches,
    current,
    objects: { ...(h?.objects ?? {}), ...tree.texts },
    packed: null,
    resources: { ...(h?.resources ?? {}), ...doc.resources },
  };
}

/** Nouvelle branche partant d'une version ; elle devient la branche de travail. */
export function addBranch(h: VersionHistory, name: string, from: string): VersionHistory {
  return { ...h, branches: [...h.branches, { name, head: from }], current: name };
}

export function switchBranch(h: VersionHistory, name: string): VersionHistory {
  return { ...h, current: name };
}

/** Supprime une branche (pas celle de travail) et les versions qu'elle était seule à garder. */
export function deleteBranch(h: VersionHistory, name: string): VersionHistory {
  const branches = h.branches.filter((b) => b.name !== name);
  const keep = new Set<string>();
  const visit = (id: string) => {
    if (keep.has(id)) return;
    keep.add(id);
    commitOf(h, id)?.parents.forEach(visit);
  };
  branches.forEach((b) => visit(b.head));
  const commits = h.commits.filter((c) => keep.has(c.id));
  const used = new Set(commits.flatMap((c) => [c.shell, ...c.parts]));
  const usedResources = new Set(commits.flatMap((c) => c.resources));
  return {
    ...h,
    branches,
    commits,
    objects: h.objects ? Object.fromEntries(Object.entries(h.objects).filter(([hash]) => used.has(hash))) : null,
    packed: null,
    resources: Object.fromEntries(Object.entries(h.resources).filter(([id]) => usedResources.has(id))),
  };
}

/** Projet décrit par des empreintes, relu par le lecteur du format (validation, migrations). */
function documentOf(
  tree: { schemaVersion: number; shell: string; parts: string[]; resources: Id[] },
  texts: Record<string, string>,
  pool: Record<Id, CadDocument['resources'][Id]>,
  current: CadDocument,
  date: string,
): ParseOutcome {
  const missing = [tree.shell, ...tree.parts].some((hash) => !(hash in texts));
  if (missing) return { ok: false, error: 'Le contenu de cette version est incomplet.', details: [] };
  const file = {
    format: FORMAT_ID,
    schemaVersion: tree.schemaVersion,
    generator: { name: APP_NAME, version: APP_VERSION },
    savedAt: date,
    document: {
      ...(JSON.parse(texts[tree.shell]!) as Record<string, unknown>),
      id: current.id,
      name: current.name,
      createdAt: current.createdAt,
      modifiedAt: date,
      parts: tree.parts.map((hash) => JSON.parse(texts[hash]!) as unknown),
      resources: Object.fromEntries(tree.resources.filter((id) => id in pool).map((id) => [id, pool[id]])),
    },
  };
  return parseNativeFile(JSON.stringify(file));
}

/**
 * Projet tel qu'il était à une version, relu par le lecteur du format (validation, migrations).
 * L'identité vient du projet courant.
 */
export function documentAt(h: VersionHistory, commit: VersionCommit, current: CadDocument): ParseOutcome {
  return documentOf(commit, h.objects ?? {}, { ...h.resources, ...current.resources }, current, commit.date);
}

// ---------------------------------------------------------------------------
// Fusion

/** Versions dont une version dérive, elle comprise. */
export function ancestorsOf(h: VersionHistory, id: string): Set<string> {
  const seen = new Set<string>();
  const visit = (x: string) => {
    if (seen.has(x)) return;
    seen.add(x);
    commitOf(h, x)?.parents.forEach(visit);
  };
  visit(id);
  return seen;
}

/**
 * Où en est `theirs` par rapport à `ours` : déjà contenue (`merged`), en avance sur la même lignée
 * (`forward` : il suffit d'avancer), ou sur une autre lignée (`diverged` : fusion).
 */
export function mergeState(h: VersionHistory, ours: string, theirs: string): 'merged' | 'forward' | 'diverged' {
  if (ancestorsOf(h, ours).has(theirs)) return 'merged';
  return ancestorsOf(h, theirs).has(ours) ? 'forward' : 'diverged';
}

/** Dernière version commune à deux versions (celle qui a le plus long passé). */
export function mergeBase(h: VersionHistory, a: string, b: string): VersionCommit | undefined {
  const mine = ancestorsOf(h, a);
  const common = [...ancestorsOf(h, b)].filter((id) => mine.has(id));
  let best: string | undefined;
  let depth = -1;
  for (const id of common) {
    const d = ancestorsOf(h, id).size;
    if (d > depth) [best, depth] = [id, d];
  }
  return best ? commitOf(h, best) : undefined;
}

/** Avance la branche de travail sur une version qui en dérive. */
export function advanceBranch(h: VersionHistory, to: string): VersionHistory {
  return { ...h, branches: h.branches.map((b) => (b.name === h.current ? { ...b, head: to } : b)) };
}

/** Contenu d'une version au format courant (une version ancienne est d'abord convertie). */
export function treeAt(h: VersionHistory, commit: VersionCommit, current: CadDocument): VersionTree | null {
  if (commit.schemaVersion === SCHEMA_VERSION) return { shell: commit.shell, parts: commit.parts, resources: commit.resources, texts: h.objects ?? {} };
  const parsed = documentAt(h, commit, current);
  return parsed.ok ? treeOf(parsed.doc) : null;
}

export type MergeSide = 'ours' | 'theirs';

/** Pièce ou partie du projet modifiée des deux côtés, différemment : il faut choisir un côté. */
export interface MergeConflict {
  /** « part:identifiant » ou « section:clé ». */
  key: string;
  name: string;
  /** Ce que chaque côté en a fait depuis la version commune. */
  ours: ChangeStatus;
  theirs: ChangeStatus;
}

export interface MergeResult {
  tree: VersionTree;
  conflicts: MergeConflict[];
}

const statusOf = (base: string | undefined, now: string | undefined): ChangeStatus => (now === undefined ? 'removed' : base === undefined ? 'added' : 'modified');

const text = (x: unknown): string | undefined => (x === undefined ? undefined : JSON.stringify(x));
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Liste d'éléments identifiés (exemplaires, liaisons, matières…) : elle se fusionne élément par élément. */
const isIdList = (x: unknown): x is ({ id: string } & Record<string, unknown>)[] => Array.isArray(x) && x.every((e) => isObject(e) && typeof e.id === 'string');

/**
 * Fusion d'une valeur du projet : ce qu'un seul côté a changé est repris, en descendant dans les
 * objets et les listes d'éléments identifiés. Là où les deux côtés diffèrent vraiment, `theirs`
 * dit quel côté l'emporte, et `conflict` le signale.
 */
function mergeValues(b: unknown, o: unknown, t: unknown, theirs: boolean): { value: unknown; conflict: boolean } {
  const [tb, to, tt] = [text(b), text(o), text(t)];
  if (to === tt || tt === tb) return { value: o, conflict: false };
  if (to === tb) return { value: t, conflict: false };
  let conflict = false;
  const sub = (x: unknown, y: unknown, z: unknown): unknown => {
    const r = mergeValues(x, y, z, theirs);
    conflict ||= r.conflict;
    return r.value;
  };
  if (isIdList(o) && isIdList(t) && (b === undefined || isIdList(b))) {
    const map = (list: { id: string }[] | undefined) => new Map((list ?? []).map((e) => [e.id, e]));
    const [mb, mo, mt] = [map(b as { id: string }[] | undefined), map(o), map(t)];
    const value = [...new Set([...mo.keys(), ...mt.keys()])].map((id) => sub(mb.get(id), mo.get(id), mt.get(id))).filter((e) => e !== undefined);
    return { value, conflict };
  }
  if (isObject(o) && isObject(t) && (b === undefined || isObject(b))) {
    const value: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(o), ...Object.keys(t)])) {
      const v = sub((b as Record<string, unknown> | undefined)?.[key], o[key], t[key]);
      if (v !== undefined) value[key] = v;
    }
    return { value, conflict };
  }
  return { value: theirs ? t : o, conflict: true };
}

/**
 * Fusion de `theirs` dans `ours`, pièce par pièce puis partie par partie du reste du projet :
 * ce qu'un seul côté a changé depuis `base` est repris ; ce que les deux ont changé différemment
 * est un conflit, tranché par `choices` (à défaut, notre côté).
 */
export function mergeTrees(base: VersionTree | null, ours: VersionTree, theirs: VersionTree, choices: Record<string, MergeSide> = {}): MergeResult {
  const conflicts: MergeConflict[] = [];
  const pick = (key: string, name: () => string, b: string | undefined, o: string | undefined, t: string | undefined): string | undefined => {
    if (o === t || t === b) return o;
    if (o === b) return t;
    conflicts.push({ key, name: name(), ours: statusOf(b, o), theirs: statusOf(b, t) });
    return choices[key] === 'theirs' ? t : o;
  };
  const texts = { ...(base?.texts ?? {}), ...theirs.texts, ...ours.texts };
  // Pièces : par identifiant ; l'ordre est le nôtre, les pièces venues de l'autre côté à la suite.
  const byId = (tree: VersionTree | null) => new Map((tree?.parts ?? []).flatMap((hash) => {
    const p = parsePart(tree!.texts[hash]);
    return p ? [[p.id!, hash] as const] : [];
  }));
  const [bp, op, tp] = [byId(base), byId(ours), byId(theirs)];
  const nameOf = (id: string) => parsePart(texts[op.get(id) ?? tp.get(id) ?? bp.get(id) ?? ''])?.name ?? '?';
  const parts: string[] = [];
  for (const id of new Set([...op.keys(), ...tp.keys()])) {
    const hash = pick(`part:${id}`, () => nameOf(id), bp.get(id), op.get(id), tp.get(id));
    if (hash !== undefined) parts.push(hash);
  }
  // Reste du projet : par partie (assemblage, paramètres, matières…), fusionnée en profondeur.
  const sections = (tree: VersionTree | null): Record<string, unknown> => {
    try {
      return JSON.parse(tree?.texts[tree.shell] ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const [bs, os, ts] = [sections(base), sections(ours), sections(theirs)];
  const shell: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(os), ...Object.keys(ts)])) {
    const merged = mergeValues(bs[key], os[key], ts[key], choices[`section:${key}`] === 'theirs');
    if (merged.conflict) conflicts.push({ key: `section:${key}`, name: SECTION_LABELS[key] ?? key, ours: statusOf(text(bs[key]), text(os[key])), theirs: statusOf(text(bs[key]), text(ts[key])) });
    if (merged.value !== undefined) shell[key] = merged.value;
  }
  const shellText = canonicalText(shell);
  const shellHash = hashText(shellText);
  texts[shellHash] = shellText;
  return { tree: { shell: shellHash, parts, resources: [...new Set([...ours.resources, ...theirs.resources])], texts }, conflicts };
}

/** Projet d'un contenu fusionné (au format courant), relu par le lecteur du format. */
export function documentOfTree(h: VersionHistory, tree: VersionTree, current: CadDocument, date: string): ParseOutcome {
  return documentOf({ ...tree, schemaVersion: SCHEMA_VERSION }, tree.texts, { ...h.resources, ...current.resources }, current, date);
}

export type ChangeStatus = 'added' | 'removed' | 'modified';

/** Ce qui change dans une pièce : ses étapes, ou une de ses propriétés (« Couleur », « Nom »…). */
export interface StepChange {
  name: string;
  status: ChangeStatus;
}

export interface PartChange {
  id: Id;
  name: string;
  status: ChangeStatus;
  /** Détail d'une pièce modifiée. */
  steps: StepChange[];
}

export interface VersionDiff {
  parts: PartChange[];
  /** Parties du projet hors pièces qui diffèrent (« Assemblage », « Paramètres »…). */
  sections: string[];
}

const SECTION_LABELS: Record<string, string> = {
  assembly: 'Assemblage',
  subassemblies: 'Ensembles',
  folders: 'Dossiers',
  materials: 'Matières',
  fabrication: 'Fabrication',
  parameters: 'Paramètres',
  simulation: 'Simulation',
  units: 'Unités',
};

const PROPERTY_LABELS: Record<string, string> = {
  name: 'Nom',
  color: 'Couleur',
  visible: 'Visibilité',
  material: 'Matière',
  make: 'Fabrication',
  paint: 'Peinture',
  folder: 'Dossier',
  component: 'Composant',
};

type RawPart = { id?: string; name?: string; features?: { id?: string; name?: string }[] } & Record<string, unknown>;

function parsePart(text: string | undefined): RawPart | null {
  try {
    const p = JSON.parse(text ?? '') as RawPart;
    return p && typeof p.id === 'string' ? p : null;
  } catch {
    return null;
  }
}

/** Étapes et propriétés qui diffèrent entre deux états d'une même pièce. */
function stepChanges(a: RawPart, b: RawPart): StepChange[] {
  const changes: StepChange[] = [];
  const old = new Map((a.features ?? []).map((f) => [f.id, f]));
  const now = new Map((b.features ?? []).map((f) => [f.id, f]));
  for (const [id, f] of now) {
    const before = old.get(id);
    if (!before) changes.push({ name: f.name ?? '?', status: 'added' });
    else if (JSON.stringify(before) !== JSON.stringify(f)) changes.push({ name: f.name ?? '?', status: 'modified' });
  }
  for (const [id, f] of old) if (!now.has(id)) changes.push({ name: f.name ?? '?', status: 'removed' });
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'features' || key === 'id') continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changes.push({ name: PROPERTY_LABELS[key] ?? key, status: 'modified' });
  }
  // Seul l'ordre des étapes a changé.
  if (changes.length === 0) changes.push({ name: 'Ordre des étapes', status: 'modified' });
  return changes;
}

/** Ce qui change de `from` (absent : projet vide) à `to`. `text` rend le contenu d'une empreinte. */
export function diffTrees(from: { shell: string; parts: string[] } | null, to: { shell: string; parts: string[] }, text: (hash: string) => string | undefined): VersionDiff {
  const partsOf = (hashes: string[]) => new Map(hashes.map((hash) => [hash, parsePart(text(hash))] as const).flatMap(([hash, p]) => (p ? [[p.id!, { hash, part: p }] as const] : [])));
  const a = partsOf(from?.parts ?? []);
  const b = partsOf(to.parts);
  const diff: VersionDiff = { parts: [], sections: [] };
  for (const [id, p] of b) {
    const old = a.get(id);
    if (!old) diff.parts.push({ id, name: p.part.name ?? '?', status: 'added', steps: [] });
    else if (old.hash !== p.hash) diff.parts.push({ id, name: p.part.name ?? '?', status: 'modified', steps: stepChanges(old.part, p.part) });
  }
  for (const [id, p] of a) if (!b.has(id)) diff.parts.push({ id, name: p.part.name ?? '?', status: 'removed', steps: [] });
  if (from && from.shell !== to.shell) {
    try {
      const x = JSON.parse(text(from.shell) ?? '{}') as Record<string, unknown>;
      const y = JSON.parse(text(to.shell) ?? '{}') as Record<string, unknown>;
      for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) diff.sections.push(SECTION_LABELS[key] ?? key);
      }
    } catch {
      diff.sections.push('Projet');
    }
  }
  return diff;
}

export const diffIsEmpty = (d: VersionDiff): boolean => d.parts.length + d.sections.length === 0;

/** Ce qu'une version change par rapport à celle dont elle dérive. */
export function commitDiff(h: VersionHistory, commit: VersionCommit): VersionDiff {
  return diffTrees(commitOf(h, commit.parents[0] ?? '') ?? null, commit, (hash) => h.objects?.[hash]);
}

/** Versions qui ont touché une pièce, de la plus récente à la plus ancienne, avec ce qu'elles y ont fait. */
export function partHistory(h: VersionHistory, partId: Id): { commit: VersionCommit; change: PartChange }[] {
  return layoutGraph(h).rows.flatMap(({ commit }) => {
    const change = commitDiff(h, commit).parts.find((p) => p.id === partId);
    return change ? [{ commit, change }] : [];
  });
}

// ---------------------------------------------------------------------------
// Tracé du graphe

export interface GraphRow {
  commit: VersionCommit;
  /** Colonne du point. */
  lane: number;
  /** Branches dont cette version est la dernière. */
  branches: string[];
}

/** Lien d'une version (ligne `from`) vers une version dont elle dérive (ligne `to`, plus bas). */
export interface GraphEdge {
  from: number;
  fromLane: number;
  to: number;
  toLane: number;
  /** Colonne suivie entre les deux lignes. */
  lane: number;
}

export interface VersionGraph {
  rows: GraphRow[];
  edges: GraphEdge[];
  lanes: number;
}

/** Versions de la plus récente à la plus ancienne (une version toujours au-dessus de ses parents), rangées en colonnes. */
export function layoutGraph(h: VersionHistory): VersionGraph {
  // Ordre : parmi les versions dont tous les enfants sont déjà placés, la plus récente.
  const children = new Map<string, number>(h.commits.map((c) => [c.id, 0]));
  for (const c of h.commits) for (const p of c.parents) children.set(p, (children.get(p) ?? 0) + 1);
  const index = new Map(h.commits.map((c, i) => [c.id, i]));
  const ready = h.commits.filter((c) => children.get(c.id) === 0);
  const ordered: VersionCommit[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (a.date === b.date ? index.get(a.id)! - index.get(b.id)! : a.date < b.date ? -1 : 1));
    const c = ready.pop()!;
    ordered.push(c);
    for (const p of c.parents) {
      const left = children.get(p)! - 1;
      children.set(p, left);
      if (left === 0) ready.push(commitOf(h, p)!);
    }
  }
  // Colonnes : chaque colonne attend une version (le parent de ce qui est au-dessus).
  const waiting: (string | null)[] = [];
  const free = () => {
    const i = waiting.indexOf(null);
    return i < 0 ? waiting.length : i;
  };
  const rows: GraphRow[] = [];
  const pending: { from: number; fromLane: number; parent: string; lane: number }[] = [];
  let lanes = 0;
  ordered.forEach((commit, row) => {
    const mine = waiting.flatMap((id, i) => (id === commit.id ? [i] : []));
    const lane = mine[0] ?? free();
    for (const i of mine) waiting[i] = null;
    commit.parents.forEach((parent, k) => {
      let travel = k === 0 ? lane : waiting.indexOf(parent);
      if (travel < 0) travel = free();
      // Colonne déjà prise par un autre parent en attente (fusion) : une colonne libre.
      if (waiting[travel] != null && waiting[travel] !== parent) travel = free();
      waiting[travel] = parent;
      pending.push({ from: row, fromLane: lane, parent, lane: travel });
    });
    lanes = Math.max(lanes, lane + 1, waiting.length);
    rows.push({ commit, lane, branches: h.branches.filter((b) => b.head === commit.id).map((b) => b.name) });
  });
  const rowOf = new Map(rows.map((r, i) => [r.commit.id, i]));
  const edges = pending.flatMap((e) => {
    const to = rowOf.get(e.parent);
    return to === undefined ? [] : [{ from: e.from, fromLane: e.fromLane, to, toLane: rows[to]!.lane, lane: e.lane }];
  });
  return { rows, edges, lanes };
}
