/**
 * Bibliothèques de composants : dépôts (GitHub ou toute adresse web) qui exposent un catalogue
 * `index.json`. Un dossier du dépôt = une collection ; un composant = des fichiers de même nom
 * (<id>.vibecad paramétrique, <id>.step, vignette <id>.png, fiche <id>.json). Voir
 * docs/bibliotheques.md et le dépôt Barbatronic/VibeCAD-Components.
 */

export const DEFAULT_LIBRARIES = ['https://github.com/Barbatronic/VibeCAD-Components'];

export interface LibraryComponent {
  id: string;
  name: string;
  description: string;
  tags: string[];
  dimensions: Record<string, number>;
  material?: string;
  mass?: number;
  size?: [number, number, number];
  files: { vibecad: string | null; step: string | null; preview: string | null };
}

export interface LibraryCollection {
  id: string;
  name: string;
  description: string;
  components: LibraryComponent[];
}

export interface LibraryIndex {
  name: string;
  description: string;
  license?: string;
  collections: LibraryCollection[];
}

export type LibraryCatalog =
  | { source: string; status: 'loading' }
  | { source: string; status: 'ready'; base: string; index: LibraryIndex }
  | { source: string; status: 'error'; error: string };

/**
 * Adresse de base (finie par « / ») d'une bibliothèque : un dépôt GitHub
 * (`https://github.com/compte/dépôt`, éventuellement `/tree/branche/dossier`) est lu sur
 * raw.githubusercontent.com (branche par défaut : HEAD) ; toute autre adresse https est prise telle
 * quelle. Null si l'adresse n'est pas utilisable.
 */
export function libraryBaseUrl(source: string): string | null {
  let url: URL;
  try {
    url = new URL(source.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) return null;
  if (url.hostname === 'github.com') {
    const [owner, repo, kind, branch, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;
    const ref = kind === 'tree' && branch ? branch : 'HEAD';
    const path = kind === 'tree' ? rest.join('/') : '';
    return `https://raw.githubusercontent.com/${owner}/${repo.replace(/\.git$/, '')}/${ref}/${path ? `${path}/` : ''}`;
  }
  return url.href.replace(/index\.json$/, '').replace(/\/?$/, '/');
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const fileOrNull = (v: unknown) => (typeof v === 'string' && v && !v.includes('..') && !/^[a-z]+:/i.test(v) ? v : null);

/** Lit un catalogue `index.json` ; lève une erreur lisible s'il n'en est pas un. */
export function parseLibraryIndex(raw: unknown): LibraryIndex {
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== 'vibecad-library') {
    throw new Error('Ce n’est pas un catalogue de bibliothèque VibeCAD (index.json).');
  }
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) throw new Error(`Version de catalogue non prise en charge (${String(o.version)}) : mettez VibeCAD à jour.`);
  const collections = (Array.isArray(o.collections) ? o.collections : []).flatMap((c): LibraryCollection[] => {
    if (!c || typeof c !== 'object') return [];
    const co = c as Record<string, unknown>;
    const components = (Array.isArray(co.components) ? co.components : []).flatMap((k): LibraryComponent[] => {
      if (!k || typeof k !== 'object') return [];
      const ko = k as Record<string, unknown>;
      const files = (ko.files ?? {}) as Record<string, unknown>;
      const entry: LibraryComponent = {
        id: str(ko.id),
        name: str(ko.name, str(ko.id)),
        description: str(ko.description),
        tags: Array.isArray(ko.tags) ? ko.tags.filter((t): t is string => typeof t === 'string') : [],
        dimensions: ko.dimensions && typeof ko.dimensions === 'object' ? (Object.fromEntries(Object.entries(ko.dimensions).filter(([, v]) => typeof v === 'number')) as Record<string, number>) : {},
        ...(typeof ko.material === 'string' ? { material: ko.material } : {}),
        ...(typeof ko.mass === 'number' ? { mass: ko.mass } : {}),
        ...(Array.isArray(ko.size) && ko.size.length === 3 && ko.size.every((n) => typeof n === 'number') ? { size: ko.size as [number, number, number] } : {}),
        files: { vibecad: fileOrNull(files.vibecad), step: fileOrNull(files.step), preview: fileOrNull(files.preview) },
      };
      return entry.id && (entry.files.vibecad || entry.files.step) ? [entry] : [];
    });
    return components.length ? [{ id: str(co.id), name: str(co.name, str(co.id)), description: str(co.description), components }] : [];
  });
  return { name: str(o.name, 'Bibliothèque'), description: str(o.description), ...(typeof o.license === 'string' ? { license: o.license } : {}), collections };
}

/** Composants qui répondent à une recherche (nom, description, mots-clés), sans accents ni casse. */
export function matchesSearch(component: LibraryComponent, query: string): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = norm([component.name, component.description, ...component.tags].join(' '));
  return words.every((w) => text.includes(w));
}

/** Charge le catalogue d'une bibliothèque. */
export async function fetchLibrary(source: string, fetcher: typeof fetch = fetch): Promise<LibraryCatalog> {
  const base = libraryBaseUrl(source);
  if (!base) return { source, status: 'error', error: 'Adresse invalide : indiquez l’adresse https d’un dépôt GitHub ou d’un dossier web contenant index.json.' };
  try {
    const res = await fetcher(`${base}index.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status === 404 ? 'Catalogue index.json introuvable à cette adresse.' : `Réponse ${res.status} du serveur.`);
    return { source, status: 'ready', base, index: parseLibraryIndex(await res.json()) };
  } catch (err) {
    const message = err instanceof TypeError ? 'Bibliothèque injoignable (réseau coupé ou adresse fausse).' : (err as Error).message;
    return { source, status: 'error', error: message };
  }
}
