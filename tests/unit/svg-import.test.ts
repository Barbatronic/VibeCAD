import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importSvgShape, MAX_STAMP_PIECES } from '../../src/io/svg-import';
import { addStamp, emptySketch } from '../../src/sketch/model';
import { extractProfiles, profileArea } from '../../src/sketch/profiles';
import { isValidOutline, layoutStamp } from '../../src/sketch/stamp';
import { contourPolyline } from '../../src/sketch/text';
import { projectStamps, stampGallery } from '../../src/stamps';
import { createDocument } from '../../src/domain/document';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;
const svg = (body: string, attrs = 'viewBox="0 0 100 100"') => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const load = (body: string, attrs?: string) => {
  const r = importSvgShape(svg(body, attrs), 'dessin');
  if (!r.ok) throw new Error(r.error);
  return r;
};
const areaOf = (outline: string, size = 100) => {
  const res = extractProfiles(addStamp(emptySketch(XY), { x: 0, y: 0 }, { name: 'x', outline }, size).sketch);
  expect(res.ok).toBe(true);
  return profileArea(res);
};
/** Boîte englobante à la taille 1, y vers le haut. */
const boxOf = (outline: string) => {
  const pts = layoutStamp(outline, { x: 0, y: 0 }, 1).flatMap((c) => contourPolyline(c, 16));
  return { w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)), h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)), top: Math.max(...pts.map((p) => p.y)) };
};
const refused = (text: string) => {
  const r = importSvgShape(text, 'dessin');
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
};

describe('import SVG', () => {
  it('normalise : centré, plus grand côté à 1, quelle que soit l’échelle du fichier', () => {
    const { shape } = load('<rect x="1000" y="2000" width="400" height="100"/>', 'viewBox="0 0 5000 5000"');
    expect(boxOf(shape.outline).w).toBeCloseTo(1, 4);
    expect(boxOf(shape.outline).h).toBeCloseTo(0.25, 4);
    expect(areaOf(shape.outline, 80)).toBeCloseTo(80 * 20, 3);
  });

  it('retourne l’axe Y : le haut du dessin reste en haut', () => {
    const { shape } = load('<path d="M50 10 L90 90 L10 90 Z"/>');
    const pts = layoutStamp(shape.outline, { x: 0, y: 0 }, 1)[0]!.pieces.flatMap((p) => (p.kind === 'line' ? [p.start] : []));
    expect(pts[0]!.y).toBeCloseTo(0.5, 4);
    expect(pts[0]!.x).toBeCloseTo(0, 4);
  });

  it('lit toutes les commandes de tracé, absolues et relatives', () => {
    // Même carré de 40 écrit de plusieurs façons.
    const square = 1600;
    for (const d of ['M0 0 H40 V40 H0 Z', 'm0,0 h40 v40 h-40 z', 'M0 0L40 0 40 40 0 40z', 'M0,0 40,0 40,40 0,40Z']) {
      expect(areaOf(load(`<path d="${d}"/><path d="M0 0" fill="none"/>`).shape.outline, 40)).toBeCloseTo(square, 3);
    }
    const disc = load('<path d="M10 50a40 40 0 1 1 80 0a40 40 0 1 1-80 0z"/>').shape.outline;
    expect(areaOf(disc, 80)).toBeCloseTo(Math.PI * 1600, -1);
    expect(isValidOutline(load('<path d="M10 80 Q 52 10 95 80 T 180 80 V 200 H 10 Z"/>').shape.outline)).toBe(true);
    expect(isValidOutline(load('<path d="M10 80 C 40 10 65 10 95 80 S 150 150 180 80 V 200 H 10 Z"/>').shape.outline)).toBe(true);
  });

  it('accepte les nombres collés et les drapeaux d’arc compacts', () => {
    const a = load('<path d="M10 50a40 40 0 1 1 80 0a40 40 0 1 1-80 0z"/>').shape.outline;
    const b = load('<path d="M10 50a40 40 0 1180 0a40 40 0 11-80 0z"/>').shape.outline;
    expect(b).toBe(a);
  });

  it('lit rectangle arrondi, cercle, ellipse, polygone', () => {
    expect(areaOf(load('<circle cx="50" cy="50" r="40"/>').shape.outline, 80)).toBeCloseTo(Math.PI * 1600, -1);
    expect(areaOf(load('<ellipse cx="50" cy="50" rx="40" ry="20"/>').shape.outline, 80)).toBeCloseTo(Math.PI * 800, -1);
    expect(areaOf(load('<rect width="80" height="40" rx="10"/>').shape.outline, 80)).toBeCloseTo(3200 - (4 - Math.PI) * 100, -1);
    expect(areaOf(load('<polygon points="0,0 40,0 40,40 0,40"/>').shape.outline, 40)).toBeCloseTo(1600, 3);
  });

  it('applique les transformations imbriquées', () => {
    const { shape } = load('<g transform="translate(10 10)"><g transform="rotate(90)"><rect width="40" height="10" transform="scale(2 1)"/></g></g>');
    expect(boxOf(shape.outline).h).toBeCloseTo(1, 4);
    expect(boxOf(shape.outline).w).toBeCloseTo(0.125, 4);
  });

  it('garde les trous, comme sur le dessin', () => {
    const { shape } = load('<path d="M0 0H100V100H0Z M40 40H60V60H40Z"/>');
    expect(areaOf(shape.outline, 100)).toBeCloseTo(10000 - 400, 3);
  });

  it('ignore ce qui n’est pas dessiné', () => {
    const { shape } = load(`
      <!-- <circle r="9"/> -->
      <defs><circle id="c" r="50"/></defs>
      <clipPath><rect width="900" height="900"/></clipPath>
      <g display="none"><rect width="900" height="900"/></g>
      <rect width="900" height="900" style="display:none"/>
      <rect width="900" height="900" fill="none"/>
      <rect x="10" y="10" width="20" height="20"/>`);
    expect(boxOf(shape.outline).h).toBeCloseTo(1, 4);
    expect(areaOf(shape.outline, 20)).toBeCloseTo(400, 3);
  });

  it('suit les styles hérités et les classes CSS', () => {
    const r = load(`<style>.vide,.rien{fill:none}</style>
      <g style="fill:none" stroke="black"><path d="M0 0 L50 50 L0 50"/></g>
      <path class="vide" stroke="#000" d="M0 0 L90 90"/>
      <path class="rien" d="M0 0 L10 90"/>
      <circle cx="50" cy="50" r="40"/>`);
    expect(areaOf(r.shape.outline, 80)).toBeCloseTo(Math.PI * 1600, -1);
    expect(r.warnings.join()).toMatch(/2 trait/);
  });

  it('ferme un tracé rempli, ignore un trait ouvert sans remplissage', () => {
    expect(areaOf(load('<path d="M0 0 L40 0 L40 40 L0 40"/>').shape.outline, 40)).toBeCloseTo(1600, 3);
  });

  it('ignore un fond plein qui couvre tout le dessin', () => {
    for (const bg of ['<rect width="100" height="100" fill="#fff"/>', '<rect width="100%" height="100%" fill="white"/>']) {
      const r = load(`${bg}<circle cx="50" cy="50" r="10"/>`);
      expect(r.warnings.join()).toMatch(/fond/);
      expect(areaOf(r.shape.outline, 20)).toBeCloseTo(Math.PI * 100, -1);
    }
  });

  it('prend le titre du fichier pour nom, sinon le nom du fichier', () => {
    expect(load('<title>Mon chat &amp; moi</title><circle r="4"/>').shape.name).toBe('Mon chat & moi');
    expect(load('<circle r="4"/>').shape.name).toBe('dessin');
  });

  it('explique ce qui ne peut pas devenir une forme', () => {
    expect(refused('bonjour')).toMatch(/pas un dessin SVG/);
    expect(refused(svg(''))).toMatch(/aucune forme/);
    expect(refused(svg('<image href="data:image/png;base64,AAAA" width="10" height="10"/>'))).toMatch(/pixels/);
    expect(refused(svg('<path d="M0 0 L50 50" fill="none" stroke="black"/>'))).toMatch(/traits ouverts/);
    expect(refused(svg('<circle cx="40" cy="50" r="30"/><circle cx="60" cy="50" r="30"/>'))).toMatch(/Union/);
    expect(refused(svg('<path d="M0 0 L100 100 L100 0 L0 100 Z"/>'))).toMatch(/croise/);
    // Pétales en arcs qui se croisent de très peu : le noyau refuserait ce contour à l'extrusion.
    expect(refused(svg('<path d="M39.17 20.24 A12.5 12.5 0 1 1 60.83 20.24 A12.5 12.5 0 1 1 77.43 34.16 A12.5 12.5 0 1 1 81.19 55.5 A12.5 12.5 0 1 1 70.36 74.26 A12.5 12.5 0 1 1 50 81.67 A12.5 12.5 0 1 1 29.64 74.26 A12.5 12.5 0 1 1 18.81 55.5 A12.5 12.5 0 1 1 22.57 34.16 A12.5 12.5 0 1 1 39.17 20.24 Z"/>'))).toMatch(/croise/);
    const dust = Array.from({ length: MAX_STAMP_PIECES }, (_, i) => `<rect x="${(i % 40) * 3}" y="${Math.floor(i / 40) * 3}" width="2" height="2"/>`).join('');
    expect(refused(svg(dust))).toMatch(/trop détaillé/);
  });

  it('ne se laisse pas perturber par du contenu actif : seul le contour ressort', () => {
    const r = load('<script>alert(1)</script><circle cx="50" cy="50" r="40" onclick="alert(1)"/>');
    expect(r.shape.outline).toMatch(/^[-\d.eMLCZ ]+$/);
  });
});

describe('contour de tampon', () => {
  it('refuse un contour illisible', () => {
    expect(isValidOutline('M 0 0 L 1 1 Z')).toBe(true);
    for (const bad of ['', 'M 0 0', 'L 1 1 Z', 'M 0 x L 1 1 Z', 'M 0 0 L 1 1', '<script>']) expect(isValidOutline(bad)).toBe(false);
  });

  it('applique taille, rotation et position', () => {
    const { shape } = load('<rect width="100" height="50"/>');
    const pts = layoutStamp(shape.outline, { x: 10, y: 20 }, 40, 90).flatMap((c) => c.pieces.flatMap((p) => (p.kind === 'line' ? [p.start] : [])));
    expect(Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))).toBeCloseTo(40, 3);
    expect(Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))).toBeCloseTo(20, 3);
    expect((Math.max(...pts.map((p) => p.x)) + Math.min(...pts.map((p) => p.x))) / 2).toBeCloseTo(10, 3);
  });
});

describe('galerie de tampons', () => {
  it('charge chaque fichier du dossier, sans exception', () => {
    const files = readdirSync('src/stamps').filter((f) => f.endsWith('.svg'));
    expect(files.length).toBeGreaterThan(10);
    const broken = files.filter((f) => {
      const r = importSvgShape(readFileSync(`src/stamps/${f}`, 'utf8'), f);
      return !r.ok || r.warnings.length > 0;
    });
    expect(broken).toEqual([]);
    expect(stampGallery()).toHaveLength(files.length);
  });

  it('chaque forme a un nom unique et donne un profil', () => {
    const shapes = stampGallery();
    expect(new Set(shapes.map((s) => s.name)).size).toBe(shapes.length);
    for (const s of shapes) expect(areaOf(s.outline, 30)).toBeGreaterThan(30);
  });

  it('retrouve les formes importées du projet, pas celles de la galerie', () => {
    const doc = createDocument('Test');
    const imported = { name: 'Le mien', outline: 'M 0 0 L 1 0 L 1 1 Z' };
    expect(projectStamps(doc, [imported, stampGallery()[0]!, null])).toEqual([imported]);
  });
});
