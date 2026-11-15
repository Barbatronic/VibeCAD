/**
 * Historique des versions d'un projet : opérations (créer une version, branches, retour à une
 * version, comparaison, tracé du graphe). Fonctions pures ; le stockage est dans `version-store`.
 */
import type { CadDocument, Id } from '../domain/model';
import { APP_NAME, APP_VERSION } from '../meta';
import { FORMAT_ID, parseNativeFile, SCHEMA_VERSION, toNativeFile, type ParseOutcome } from './native-format';
import { DEFAULT_BRANCH, hashText, type VersionCommit, type VersionHistory } from './version-store';

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
    const text = JSON.stringify(value);
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
 * `h.objects` doit être décodé.
 */
export function createVersion(h: VersionHistory | null, doc: CadDocument, message: string, date: string): VersionHistory | null {
  const tree = treeOf(doc);
  const head = h ? headOf(h) : undefined;
  if (head && sameTree(head, tree)) return null;
  const body = { parents: head ? [head.id] : [], message, date, schemaVersion: SCHEMA_VERSION, shell: tree.shell, parts: tree.parts, resources: tree.resources };
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

/**
 * Projet tel qu'il était à une version, relu par le lecteur du format (validation, migrations).
 * L'identité vient du projet courant.
 */
export function documentAt(h: VersionHistory, commit: VersionCommit, current: CadDocument): ParseOutcome {
  const objects = h.objects ?? {};
  const missing = [commit.shell, ...commit.parts].some((hash) => !(hash in objects));
  if (missing) return { ok: false, error: 'Le contenu de cette version est incomplet.', details: [] };
  const pool = { ...h.resources, ...current.resources };
  const file = {
    format: FORMAT_ID,
    schemaVersion: commit.schemaVersion,
    generator: { name: APP_NAME, version: APP_VERSION },
    savedAt: commit.date,
    document: {
      ...(JSON.parse(objects[commit.shell]!) as Record<string, unknown>),
      id: current.id,
      name: current.name,
      createdAt: current.createdAt,
      modifiedAt: commit.date,
      parts: commit.parts.map((hash) => JSON.parse(objects[hash]!) as unknown),
      resources: Object.fromEntries(commit.resources.filter((id) => id in pool).map((id) => [id, pool[id]])),
    },
  };
  return parseNativeFile(JSON.stringify(file));
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
