/**
 * Historique des versions d'un projet : stockage.
 *
 * Une version (`VersionCommit`) désigne par leur empreinte le contenu du projet à un instant :
 * une « coquille » (assemblage, paramètres, matières…) et une entrée par pièce. Les contenus sont
 * rangés une seule fois dans `objects` (clé = empreinte) : une version ne pèse que les pièces qui
 * ont changé. Dans le fichier, `objects` est un bloc compressé (`packed`) que l'ouverture du projet
 * ne décode pas : il n'est lu qu'à l'ouverture du menu des versions.
 */
import type { Id, Resource } from '../domain/model';

export interface VersionCommit {
  id: string;
  /** Versions dont celle-ci dérive (une seule sans fusion). */
  parents: string[];
  message: string;
  date: string;
  /** Version du format des contenus (pour les migrations). */
  schemaVersion: number;
  /** Empreinte du projet sans ses pièces ni ses ressources. */
  shell: string;
  /** Empreintes des pièces, dans l'ordre de la liste. */
  parts: string[];
  /** Ressources importées (STEP, images) dont la version a besoin. */
  resources: Id[];
}

export interface VersionBranch {
  name: string;
  /** Dernière version de la branche. */
  head: string;
}

export interface VersionHistory {
  commits: VersionCommit[];
  branches: VersionBranch[];
  /** Branche de travail. */
  current: string;
  /** Contenus par empreinte ; `null` tant que le bloc compressé n'a pas été décodé. */
  objects: Record<string, string> | null;
  /** Bloc compressé à jour de `objects` (gzip, base64) ; `null` s'il est à refaire. */
  packed: string | null;
  /** Ressources connues des versions (celles du projet courant comprises, sans copie). */
  resources: Record<Id, Resource>;
}

/** Forme enregistrée dans le fichier (champ facultatif `history`). */
export interface VersionHistoryFile {
  commits: VersionCommit[];
  branches: VersionBranch[];
  current: string;
  packed?: string;
  objects?: Record<string, string>;
  /** Ressources que le projet courant n'a plus mais qu'une version utilise encore. */
  resources?: Record<Id, Resource>;
}

export const DEFAULT_BRANCH = 'principal';

/** Empreinte de 128 bits d'un texte (non cryptographique : dédoublonnage, pas sécurité). */
export function hashText(text: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Compresse les contenus ; `null` si le navigateur ne sait pas compresser (ils restent en clair). */
export async function packObjects(objects: Record<string, string>): Promise<string | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([JSON.stringify(objects)]).stream().pipeThrough(new CompressionStream('gzip'));
  return toBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function unpackObjects(packed: string): Promise<Record<string, string>> {
  const stream = new Blob([fromBase64(packed)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const raw: unknown = JSON.parse(await new Response(stream).text());
  if (!isRecord(raw) || Object.values(raw).some((x) => typeof x !== 'string')) throw new Error('Bloc de versions illisible');
  return raw as Record<string, string>;
}

/** Forme à écrire dans le fichier. `docResources` : ressources du projet courant, déjà dans le fichier. */
export function historyToFile(h: VersionHistory, docResources: Record<Id, Resource>): VersionHistoryFile {
  const used = new Set(h.commits.flatMap((c) => c.resources));
  const orphans = Object.fromEntries(Object.entries(h.resources).filter(([id]) => used.has(id) && !(id in docResources)));
  return {
    commits: h.commits,
    branches: h.branches,
    current: h.current,
    ...(h.packed ? { packed: h.packed } : { objects: h.objects ?? {} }),
    ...(Object.keys(orphans).length > 0 ? { resources: orphans } : {}),
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const isText = (x: unknown): x is string => typeof x === 'string';
const isTextList = (x: unknown): x is string[] => Array.isArray(x) && x.every(isText);

/**
 * Lit le champ `history` d'un fichier. Un historique abîmé n'empêche jamais d'ouvrir le projet :
 * il est écarté, avec un avertissement. Les ressources sont validées par l'appelant.
 */
export function readHistoryFile(raw: unknown, resources: Record<Id, Resource>): { history: VersionHistory | null; warning: string | null } {
  const dropped = { history: null, warning: 'L’historique des versions est illisible : il a été écarté.' };
  if (raw === undefined || raw === null) return { history: null, warning: null };
  if (!isRecord(raw) || !Array.isArray(raw.commits) || !Array.isArray(raw.branches) || !isText(raw.current)) return dropped;
  const commits: VersionCommit[] = [];
  for (const c of raw.commits) {
    if (!isRecord(c) || !isText(c.id) || !isTextList(c.parents) || !isText(c.message) || !isText(c.date) || !isText(c.shell) || !isTextList(c.parts) || !isTextList(c.resources)) return dropped;
    if (typeof c.schemaVersion !== 'number' || !Number.isInteger(c.schemaVersion) || c.schemaVersion < 1) return dropped;
    commits.push({ id: c.id, parents: c.parents, message: c.message, date: c.date, schemaVersion: c.schemaVersion, shell: c.shell, parts: c.parts, resources: c.resources });
  }
  const ids = new Set(commits.map((c) => c.id));
  if (ids.size !== commits.length || commits.some((c) => c.parents.some((p) => !ids.has(p)))) return dropped;
  const branches: VersionBranch[] = [];
  for (const b of raw.branches) {
    if (!isRecord(b) || !isText(b.name) || !isText(b.head) || !ids.has(b.head) || branches.some((o) => o.name === b.name)) return dropped;
    branches.push({ name: b.name, head: b.head });
  }
  if (commits.length === 0) return { history: null, warning: null };
  if (!branches.some((b) => b.name === raw.current)) return dropped;
  let objects: Record<string, string> | null = null;
  let packed: string | null = null;
  if (isText(raw.packed)) packed = raw.packed;
  else if (isRecord(raw.objects) && Object.values(raw.objects).every(isText)) objects = raw.objects as Record<string, string>;
  else return dropped;
  // En clair, les contenus se vérifient tout de suite ; compressés, à leur décodage.
  if (objects && !objectsComplete(commits, objects)) return dropped;
  return { history: { commits, branches, current: raw.current, objects, packed, resources }, warning: null };
}

/** Tous les contenus désignés par les versions sont présents. */
export function objectsComplete(commits: VersionCommit[], objects: Record<string, string>): boolean {
  return commits.every((c) => c.shell in objects && c.parts.every((p) => p in objects));
}

/** Poids approché de l'historique dans le fichier, en octets. */
export function historyBytes(h: VersionHistory, docResources: Record<Id, Resource>): number {
  const file = historyToFile(h, docResources);
  const objects = file.packed ? file.packed.length : Object.values(file.objects ?? {}).reduce((n, t) => n + t.length, 0);
  const resources = Object.values(file.resources ?? {}).reduce((n, r) => n + r.data.length, 0);
  return objects + resources + JSON.stringify(file.commits).length;
}
