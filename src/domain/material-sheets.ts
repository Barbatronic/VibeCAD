/**
 * Fiches matière : une matière telle qu'on l'achète (« PLA blanc », « Acrylique rouge 3 mm »), avec
 * le procédé qui la met en forme et son apparence. Voir docs/conception-matieres.md.
 *
 * La **base** d'une fiche est l'une des matières de `part-material.ts` (masse volumique) et de la
 * simulation : une fiche « PLA rouge » se pèse et se calcule comme du PLA. Une pièce désigne sa fiche
 * par `Part.make` ; son champ `material` garde la base de la fiche, que les versions plus anciennes de
 * VibeCAD savent lire.
 */
import type { CadDocument, Id, Part, PartPaint } from './model';
import { PART_MATERIALS } from './part-material';

/** Aspect de surface : mat (bois), satiné (impression), brillant (acrylique), métal. */
export type MaterialFinish = 'matte' | 'satin' | 'glossy' | 'metal';

export const FINISHES: readonly MaterialFinish[] = ['matte', 'satin', 'glossy', 'metal'];

export const FINISH_LABELS: Record<MaterialFinish, string> = { matte: 'Mat', satin: 'Satiné', glossy: 'Brillant', metal: 'Métal' };

/** Façon dont la pièce est obtenue. */
export type MakeProcess = 'print' | 'laser' | 'machining' | 'bought';

export const MAKE_PROCESSES: readonly MakeProcess[] = ['print', 'laser', 'machining', 'bought'];

export const PROCESS_LABELS: Record<MakeProcess, string> = {
  print: 'Impression 3D',
  laser: 'Découpe laser',
  machining: 'Usinage',
  bought: 'Achetée',
};

/** Fiche matière, enregistrée dans le projet (`CadDocument.materials`) ou dans un catalogue. */
export interface MaterialSheet {
  id: Id;
  name: string;
  /** Identifiant d'une matière de `PART_MATERIALS` (pla, acrylic…). */
  base: string;
  process: MakeProcess;
  /** Couleur `#rrggbb`. */
  color: string;
  /** Opacité (0,2 → 1) : 1 = opaque ; un acrylique transparent vaut environ 0,35. */
  opacity?: number;
  /** Épaisseur de la plaque (mm), pour une matière découpée. */
  thickness?: number;
  /** Couleur des chants d'une matière découpée (`#rrggbb`) : brûlés par le laser pour le bois. */
  edge?: string;
  /** Aspect de surface (absent : satiné, comme une impression 3D). */
  finish?: MaterialFinish;
  /** Marque, référence… (facultatif). */
  brand?: string;
}

/** Chant de bois brûlé par le laser. */
export const BURNT = '#4b2e1d';

const sheet = (id: string, name: string, base: string, process: MakeProcess, color: string, extra: Partial<MaterialSheet> = {}): MaterialSheet => ({
  id: `std-${id}`,
  name,
  base,
  process,
  color,
  ...extra,
});

/** Fiches livrées avec VibeCAD : les matières courantes d'un atelier de fabrication numérique. */
export const STARTER_MATERIALS: readonly MaterialSheet[] = [
  sheet('pla-white', 'PLA blanc', 'pla', 'print', '#f2f0ea'),
  sheet('pla-black', 'PLA noir', 'pla', 'print', '#262626'),
  sheet('pla-grey', 'PLA gris', 'pla', 'print', '#8a8d91'),
  sheet('pla-red', 'PLA rouge', 'pla', 'print', '#d23b33'),
  sheet('pla-orange', 'PLA orange', 'pla', 'print', '#ee7a2c'),
  sheet('pla-yellow', 'PLA jaune', 'pla', 'print', '#f2c434'),
  sheet('pla-green', 'PLA vert', 'pla', 'print', '#3f9b4a'),
  sheet('pla-blue', 'PLA bleu', 'pla', 'print', '#2f6fd1'),
  sheet('pla-purple', 'PLA violet', 'pla', 'print', '#7b4cc4'),
  sheet('pla-pink', 'PLA rose', 'pla', 'print', '#ee8fb7'),
  sheet('petg-black', 'PETG noir', 'petg', 'print', '#1f1f1f'),
  sheet('petg-clear', 'PETG transparent', 'petg', 'print', '#dfeef2', { opacity: 0.55, finish: 'glossy' }),
  sheet('tpu-black', 'TPU noir (souple)', 'tpu', 'print', '#2a2a2a'),
  sheet('acrylic-clear-3', 'Acrylique transparent 3 mm', 'acrylic', 'laser', '#d8eef5', { opacity: 0.35, thickness: 3, finish: 'glossy' }),
  sheet('acrylic-red-3', 'Acrylique rouge 3 mm', 'acrylic', 'laser', '#d1262b', { opacity: 0.85, thickness: 3, finish: 'glossy' }),
  sheet('acrylic-black-3', 'Acrylique noir 3 mm', 'acrylic', 'laser', '#151515', { thickness: 3, finish: 'glossy' }),
  sheet('acrylic-white-3', 'Acrylique blanc 3 mm', 'acrylic', 'laser', '#f5f5f2', { thickness: 3, finish: 'glossy' }),
  sheet('plywood-3', 'Contreplaqué peuplier 3 mm', 'plywood', 'laser', '#d9b98a', { thickness: 3, edge: BURNT, finish: 'matte' }),
  sheet('plywood-5', 'Contreplaqué peuplier 5 mm', 'plywood', 'laser', '#d4b080', { thickness: 5, edge: BURNT, finish: 'matte' }),
  sheet('aluminium', 'Aluminium usiné', 'aluminium', 'machining', '#b9bec4', { finish: 'metal' }),
  sheet('steel-bought', 'Acier (visserie, axes)', 'steel', 'bought', '#8c9097', { finish: 'metal' }),
  sheet('aluminium-bought', 'Aluminium (profilés)', 'aluminium', 'bought', '#c3c7cc', { finish: 'metal' }),
];

const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Erreurs d'une fiche (vide si elle est valide). */
export function sheetProblems(s: MaterialSheet): string[] {
  const out: string[] = [];
  if (!s.name.trim()) out.push('la fiche n’a pas de nom');
  if (!PART_MATERIALS.some((m) => m.id === s.base)) out.push(`matière de base inconnue « ${s.base} »`);
  if (!MAKE_PROCESSES.includes(s.process)) out.push(`procédé inconnu « ${s.process} »`);
  if (!COLOR.test(s.color)) out.push('couleur #rrggbb attendue');
  if (s.opacity !== undefined && !(s.opacity >= 0.2 && s.opacity <= 1)) out.push('opacité entre 0,2 et 1 attendue');
  if (s.thickness !== undefined && !(s.thickness > 0)) out.push('épaisseur positive attendue');
  if (s.edge !== undefined && !COLOR.test(s.edge)) out.push('couleur des chants #rrggbb attendue');
  if (s.finish !== undefined && !FINISHES.includes(s.finish)) out.push(`aspect inconnu « ${s.finish} »`);
  return out;
}

/** Fiche matière de la pièce dans le projet (absente si aucune n'est choisie). */
export function sheetOf(doc: Pick<CadDocument, 'materials'>, part: Pick<Part, 'make'>): MaterialSheet | undefined {
  return part.make ? doc.materials?.find((m) => m.id === part.make) : undefined;
}

/**
 * Les matières du projet sont exactement celles de ses pièces : une fiche que plus aucune pièce
 * n'utilise est retirée (elle reste dans le catalogue d'où elle vient).
 */
export function pruneSheets(doc: CadDocument): CadDocument {
  const used = new Set(doc.parts.flatMap((p) => [...(p.make ? [p.make] : []), ...(p.paint?.faces.map((f) => f.material) ?? []), ...engraveMaterials(p)]));
  const materials = (doc.materials ?? []).filter((m) => used.has(m.id));
  if (materials.length === (doc.materials?.length ?? 0)) return doc;
  const { materials: _old, ...rest } = doc;
  return materials.length ? { ...rest, materials } : rest;
}

/**
 * Choisit la fiche d'une pièce : la fiche est copiée dans le projet si besoin (le projet reste
 * complet sans le catalogue), et `material` reçoit sa base. `null` : retour à « non choisie ».
 * L'ancienne fiche quitte le projet si plus aucune pièce ne l'utilise.
 */
export function assignSheet(doc: CadDocument, partId: Id, sheet: MaterialSheet | null): CadDocument {
  const known = sheet && doc.materials?.some((m) => m.id === sheet.id);
  const materials = sheet && !known ? [...(doc.materials ?? []), { ...sheet }] : doc.materials;
  return pruneSheets({
    ...doc,
    ...(materials ? { materials } : {}),
    parts: doc.parts.map((p) => {
      if (p.id !== partId) return p;
      if (!sheet) {
        const { make: _make, ...rest } = p;
        return rest;
      }
      return { ...p, make: sheet.id, material: sheet.base };
    }),
  });
}

/** Modifie une fiche du projet ; les pièces qui l'utilisent suivent (base, donc masse). */
export function updateSheet(doc: CadDocument, sheet: MaterialSheet): CadDocument {
  return {
    ...doc,
    materials: (doc.materials ?? []).map((m) => (m.id === sheet.id ? { ...sheet } : m)),
    parts: doc.parts.map((p) => (p.make === sheet.id ? { ...p, material: sheet.base } : p)),
  };
}

/** Retire une fiche de toutes les pièces, donc du projet : elles n'ont plus de fiche choisie. */
export function removeSheet(doc: CadDocument, sheetId: Id): CadDocument {
  const materials = (doc.materials ?? []).filter((m) => m.id !== sheetId);
  const { materials: _old, ...rest } = doc;
  return {
    ...rest,
    ...(materials.length ? { materials } : {}),
    parts: doc.parts.map((p) => {
      const faces = p.paint?.faces.filter((f) => f.material !== sheetId);
      const { make: _make, paint: _paint, ...other } = p;
      return { ...other, ...(p.make && p.make !== sheetId ? { make: p.make } : {}), ...(faces?.length ? { paint: { faces } } : {}) };
    }),
  };
}

/** Peinture d'une pièce, avec la fiche copiée dans le projet si besoin ; l'inutile quitte le projet. */
export function setPaint(doc: CadDocument, partId: Id, paint: PartPaint | undefined, sheet?: MaterialSheet): CadDocument {
  const known = !sheet || doc.materials?.some((m) => m.id === sheet.id);
  const materials = known ? doc.materials : [...(doc.materials ?? []), { ...sheet! }];
  return pruneSheets({
    ...doc,
    ...(materials ? { materials } : {}),
    parts: doc.parts.map((p) => {
      if (p.id !== partId) return p;
      const { paint: _old, ...rest } = p;
      return paint ? { ...rest, paint } : rest;
    }),
  });
}

/**
 * Chants d'une pièce découpée : les faces dont la normale est perpendiculaire à la plaque. La plaque
 * est donnée par la plus grande face plane. Renvoie, pour chaque face, vrai si c'est un chant.
 */
export function cutEdgeFaces(faces: readonly { plane?: { normal: { x: number; y: number; z: number } }; area: number }[]): boolean[] {
  let main: { x: number; y: number; z: number } | null = null;
  let best = 0;
  for (const f of faces) {
    if (f.plane && f.area > best) {
      best = f.area;
      main = f.plane.normal;
    }
  }
  if (!main) return faces.map(() => false);
  const n = main;
  // Une face parallèle à la plaque (dessus, dessous, gravure à plat) n'est pas un chant.
  return faces.map((f) => !(f.plane && Math.abs(f.plane.normal.x * n.x + f.plane.normal.y * n.y + f.plane.normal.z * n.z) > 0.99));
}

/** Gravures d'une pièce qui donnent une autre matière à leur zone (impression 3D). */
export function engraveColors(part: Pick<Part, 'features'>): { featureId: Id; material: Id }[] {
  return part.features.flatMap((f) => (f.type === 'engrave' && f.params.material ? [{ featureId: f.id, material: f.params.material }] : []));
}

const engraveMaterials = (part: Pick<Part, 'features'>) => engraveColors(part).map((e) => e.material);

/** Couleur et opacité d'une pièce selon le mode d'affichage : conception (sa couleur) ou matières (sa fiche). */
export function displayLook(doc: Pick<CadDocument, 'materials'>, part: Pick<Part, 'make' | 'color'>, mode: 'design' | 'materials'): { color: string; opacity: number } {
  const s = mode === 'materials' ? sheetOf(doc, part) : undefined;
  return s ? { color: s.color, opacity: s.opacity ?? 1 } : { color: part.color, opacity: 1 };
}

/** Lit un catalogue (fichier JSON exporté) : les fiches valides, et ce qui a été écarté. */
export function readCatalogue(text: string): { sheets: MaterialSheet[]; rejected: number } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { materials?: unknown }).materials) ? (raw as { materials: unknown[] }).materials : null;
  if (!list) return null;
  const sheets: MaterialSheet[] = [];
  let rejected = 0;
  for (const item of list) {
    const s = toSheet(item);
    if (s && sheetProblems(s).length === 0) sheets.push(s);
    else rejected++;
  }
  return { sheets, rejected };
}

/** Fiche bien formée à partir d'un objet quelconque (champs connus seulement), ou null. */
export function toSheet(x: unknown): MaterialSheet | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.base !== 'string' || typeof o.process !== 'string' || typeof o.color !== 'string') return null;
  return {
    id: o.id,
    name: o.name,
    base: o.base,
    process: o.process as MakeProcess,
    color: o.color,
    ...(typeof o.opacity === 'number' ? { opacity: o.opacity } : {}),
    ...(typeof o.thickness === 'number' ? { thickness: o.thickness } : {}),
    ...(typeof o.edge === 'string' ? { edge: o.edge } : {}),
    ...(typeof o.finish === 'string' ? { finish: o.finish as MaterialFinish } : {}),
    ...(typeof o.brand === 'string' && o.brand ? { brand: o.brand } : {}),
  };
}

/** Texte d'un catalogue à enregistrer (fichier `.json`). */
export function catalogueText(sheets: readonly MaterialSheet[]): string {
  return `${JSON.stringify({ format: 'vibecad-materials', version: 1, materials: sheets }, null, 2)}\n`;
}

/**
 * Fiches d'un autre projet utilisées par une pièce copiée (composant de bibliothèque) : celles qui
 * manquent sont ajoutées, pour que la pièce ne désigne jamais une fiche absente.
 */
export function importSheetsFor(doc: CadDocument, partId: Id, from: readonly MaterialSheet[] | undefined): CadDocument {
  const part = doc.parts.find((p) => p.id === partId);
  if (!part) return doc;
  const needed = new Set([...(part.make ? [part.make] : []), ...(part.paint?.faces.map((f) => f.material) ?? []), ...engraveMaterials(part)]);
  const have = new Set((doc.materials ?? []).map((m) => m.id));
  const added = (from ?? []).filter((m) => needed.has(m.id) && !have.has(m.id));
  const materials = [...(doc.materials ?? []), ...added.map((m) => ({ ...m }))];
  const known = new Set(materials.map((m) => m.id));
  // Une référence vers une fiche introuvable est retirée plutôt que laissée cassée.
  const clean: Part = {
    ...part,
    ...(part.make && !known.has(part.make) ? { make: undefined } : {}),
  };
  if (clean.make === undefined) delete clean.make;
  return { ...doc, ...(materials.length ? { materials } : {}), parts: doc.parts.map((p) => (p.id === partId ? clean : p)) };
}
