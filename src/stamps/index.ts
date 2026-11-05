/**
 * Galerie des tampons : chaque fichier .svg de ce dossier est une forme, chargée automatiquement.
 * Pour en ajouter une, y déposer le fichier (son <title> donne le nom affiché).
 */
import type { CadDocument } from '../domain/model';
import { importSvgShape } from '../io/svg-import';
import type { StampShape } from '../sketch/stamp';

const files = import.meta.glob<string>('./*.svg', { query: '?raw', import: 'default', eager: true });

let gallery: StampShape[] | null = null;

/** Formes de la galerie, par ordre alphabétique. */
export function stampGallery(): StampShape[] {
  gallery ??= Object.entries(files)
    .flatMap(([path, svg]) => {
      const r = importSvgShape(svg, path.replace(/^.*\/|\.svg$/g, ''));
      return r.ok ? [r.shape] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return gallery;
}

/** Formes importées déjà utilisées dans le projet : elles voyagent avec lui. */
export function projectStamps(doc: CadDocument, extra: (StampShape | null)[] = []): StampShape[] {
  const known = new Set(stampGallery().map((s) => s.outline));
  const out: StampShape[] = [];
  const add = (shape: StampShape) => {
    if (known.has(shape.outline)) return;
    known.add(shape.outline);
    out.push({ name: shape.name, outline: shape.outline });
  };
  for (const part of doc.parts) {
    for (const f of part.features) {
      if (f.type !== 'sketch') continue;
      for (const e of f.params.entities) if (e.type === 'stamp') add(e);
    }
  }
  for (const shape of extra) if (shape) add(shape);
  return out;
}
