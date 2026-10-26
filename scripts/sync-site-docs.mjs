#!/usr/bin/env node
/**
 * Copie la documentation utilisateur (docs/) dans le site barbatronic.fr (dépôt
 * barbatronic.github.io, collection Jekyll `_docs/vibecad/`). docs/ reste la seule source : on
 * relance ce script après chaque évolution, puis on relit et on publie le site.
 *
 *   node scripts/sync-site-docs.mjs [chemin du dépôt du site]   (défaut : ../barbatronic.github.io)
 *
 * Pour chaque page : en-tête Jekyll (titre = le « # » de tête, description = premier paragraphe,
 * date = dernier commit du fichier, ordre du menu), images copiées dans
 * assets/img/projets/vibecad/docs/, liens vers les autres pages publiées réécrits vers le site,
 * les autres vers GitHub. Le texte est protégé de Liquid ({% raw %}). Les pages générées
 * auparavant et retirées de la liste sont supprimées du site.
 *
 * Règles du site appliquées à la copie (docs/ n'est pas modifié) :
 * - pas de tiret long ni demi-cadratin : une incise « — … — » passe entre parenthèses, un tiret
 *   seul devient « : » (ou « , » si la suite de la ligne contient déjà « : »), « 3–5 » devient
 *   « 3-5 ». Les blocs de code ``` ne sont pas touchés ;
 * - captures PNG converties en JPG (qualité 85, fond blanc) avec ImageMagick (`convert`), pour
 *   alléger le site ; les autres formats sont copiés tels quels.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = resolve(ROOT, process.argv[2] ?? '../barbatronic.github.io');
const PROJECT = 'vibecad';
const GITHUB = 'https://github.com/Barbatronic/VibeCAD/blob/main/';
const IMAGES_URL = `/assets/img/projets/${PROJECT}/docs/`;
const MARK = '<!-- Page générée par scripts/sync-site-docs.mjs';

/** Doc utilisateur, dans l'ordre du menu de la fiche projet. */
const PAGES = [
  'guide-pedagogique',
  'assemblage',
  'sous-assemblages',
  'references-entre-pieces',
  'conception-en-contexte',
  'images-reference',
  'tolerie',
  'fabrication',
  'simulation',
  'optimisation-topologique',
  'bibliotheques',
  'export-freecad',
  'navigateurs',
];

if (!existsSync(join(SITE, '_config.yml'))) {
  console.error(`Dépôt du site introuvable : ${SITE}`);
  process.exit(1);
}
const docsDir = join(SITE, '_docs', PROJECT);
const imagesDir = join(SITE, 'assets', 'img', 'projets', PROJECT, 'docs');
mkdirSync(docsDir, { recursive: true });
mkdirSync(imagesDir, { recursive: true });

const lastCommitDate = (file) => {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: ROOT, encoding: 'utf8' }).trim() || today();
  } catch {
    return today();
  }
};
const today = () => new Date().toISOString().slice(0, 10);

/** Premier paragraphe en texte simple, coupé à la fin d'une phrase (≈ 220 caractères au plus). */
function description(body) {
  const para = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(#|!\[|```|\||- |\d+\. |>)/.test(p));
  if (!para) return '';
  const text = para
    .replace(/\s+/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '');
  if (text.length <= 220) return text;
  const cut = text.slice(0, 220);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' : '));
  return (end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`).trim();
}

/** Réécrit une cible de lien ou d'image relative à docs/. */
function rewrite(target, copied) {
  if (/^([a-z]+:|#|\/)/i.test(target)) return target;
  const [path, anchor = ''] = target.split('#');
  const hash = anchor ? `#${anchor}` : '';
  if (path.startsWith('images/')) {
    const source = join(ROOT, 'docs', path);
    let name = path.slice('images/'.length);
    if (name.endsWith('.png')) {
      name = name.replace(/\.png$/, '.jpg');
      if (!copied.has(name)) {
        execFileSync('convert', [source, '-background', 'white', '-flatten', '-strip', '-quality', '85', join(imagesDir, name)]);
      }
    } else {
      copyFileSync(source, join(imagesDir, name));
    }
    copied.add(name);
    return `${IMAGES_URL}${name}`;
  }
  const page = path.replace(/\.md$/, '');
  if (path.endsWith('.md') && PAGES.includes(page)) return `/projets/${PROJECT}/${page}/${hash}`;
  return `${GITHUB}${posix.normalize(posix.join('docs', path))}${hash}`;
}

/** Remplace les tirets longs et demi-cadratins d'une ligne de texte (règle du site). */
function undashLine(line) {
  return line
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
    .replace(/ [–—] ([^–—\n]+?) [–—] /g, ' ($1) ')
    .replace(/ [–—] (.*)$/, (_, rest) => (rest.includes(' : ') ? `, ${rest}` : ` : ${rest}`))
    .replace(/[–—]/g, '-');
}

/** Applique undashLine hors des blocs de code ```. */
function undash(text) {
  let code = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) code = !code;
      return code || /^\s*```/.test(line) ? line : undashLine(line);
    })
    .join('\n');
}

const copied = new Set();
PAGES.forEach((name, i) => {
  const source = `docs/${name}.md`;
  const text = undash(readFileSync(join(ROOT, source), 'utf8'));
  const match = text.match(/^#\s+(.+)\n/);
  if (!match) throw new Error(`${source} : titre « # » attendu en première ligne`);
  const title = match[1].trim();
  const body = text.slice(match[0].length).replace(/(!?\[[^\]]*\])\(([^)\s]+)\)/g, (_, label, target) => `${label}(${rewrite(target, copied)})`);
  const front = [
    '---',
    'published: true',
    `title: ${JSON.stringify(title)}`,
    `project: ${PROJECT}`,
    `order: ${i + 1}`,
    `date: ${lastCommitDate(source)}`,
    `description: ${JSON.stringify(description(body))}`,
    '---',
  ].join('\n');
  const out = `${front}\n\n${MARK} depuis VibeCAD/${source} : modifier la source, pas cette page. -->\n\n{% raw %}\n${body.trim()}\n{% endraw %}\n`;
  writeFileSync(join(docsDir, `${name}.md`), out);
});

// Pages et images générées auparavant, retirées de la liste.
for (const file of readdirSync(docsDir)) {
  if (!file.endsWith('.md') || PAGES.includes(file.replace(/\.md$/, ''))) continue;
  if (readFileSync(join(docsDir, file), 'utf8').includes(MARK)) rmSync(join(docsDir, file));
}
for (const file of readdirSync(imagesDir)) if (!copied.has(file)) rmSync(join(imagesDir, file));

console.log(`${PAGES.length} pages et ${copied.size} images copiées dans ${SITE}`);
