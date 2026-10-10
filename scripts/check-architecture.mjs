#!/usr/bin/env node
/**
 * Vérification de l'architecture (npm run lint:arch) :
 * 1. règles de couches : le domaine ne dépend ni du DOM, ni de Three.js, ni du noyau concret ;
 *    seuls certains dossiers peuvent importer Three.js, Preact ou Open CASCADE ;
 * 2. absence de dépendances circulaires entre modules (imports exécutés, hors `import type`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SRC = join(ROOT, 'src');

/** Pour chaque couche : préfixes de modules internes et paquets externes interdits. */
const RULES = [
  {
    layer: 'math',
    forbidInternal: ['domain', 'sketch', 'features', 'geometry', 'io', 'persistence', 'commands', 'app', 'ui', 'viewport', 'workers', 'tutorials'],
    forbidPackages: ['three', 'preact', 'replicad-opencascadejs'],
  },
  {
    layer: 'domain',
    forbidInternal: ['sketch', 'features', 'geometry', 'io', 'persistence', 'commands', 'app', 'ui', 'viewport', 'workers', 'tutorials'],
    forbidPackages: ['three', 'preact', 'replicad-opencascadejs'],
  },
  {
    layer: 'sketch',
    forbidInternal: ['features', 'geometry', 'io', 'persistence', 'commands', 'app', 'ui', 'viewport', 'workers', 'tutorials'],
    forbidPackages: ['three', 'preact', 'replicad-opencascadejs'],
  },
  {
    layer: 'commands',
    forbidInternal: ['geometry/occt', 'app', 'ui', 'viewport', 'workers'],
    forbidPackages: ['three', 'preact', 'replicad-opencascadejs'],
  },
  {
    layer: 'features',
    forbidInternal: ['geometry/occt', 'io', 'persistence', 'commands', 'app', 'ui', 'viewport', 'workers', 'tutorials'],
    forbidPackages: ['three', 'preact', 'replicad-opencascadejs'],
  },
  {
    layer: 'geometry',
    forbidInternal: ['app', 'ui', 'viewport', 'persistence', 'tutorials'],
    forbidPackages: ['three', 'preact'],
  },
  {
    layer: 'io',
    forbidInternal: ['geometry/occt', 'app', 'ui', 'viewport', 'workers', 'persistence', 'tutorials'],
    forbidPackages: ['three', 'preact', 'replicad-opencascadejs'],
  },
  {
    layer: 'persistence',
    forbidInternal: ['geometry/occt', 'app', 'ui', 'viewport', 'workers', 'tutorials'],
    forbidPackages: ['three', 'preact', 'replicad-opencascadejs'],
  },
  {
    layer: 'viewport',
    forbidInternal: ['app', 'ui', 'workers', 'geometry/occt', 'persistence', 'tutorials'],
    forbidPackages: ['preact', 'replicad-opencascadejs'],
  },
  {
    layer: 'workers',
    forbidInternal: ['app', 'ui', 'viewport', 'persistence', 'tutorials'],
    forbidPackages: ['three', 'preact'],
  },
  { layer: 'ui', forbidInternal: ['geometry/occt', 'workers'], forbidPackages: ['replicad-opencascadejs', 'three'] },
  { layer: 'app', forbidInternal: ['geometry/occt', 'workers'], forbidPackages: ['replicad-opencascadejs', 'three'] },
  {
    layer: 'tutorials',
    forbidInternal: ['geometry/occt', 'workers', 'viewport', 'ui'],
    forbidPackages: ['three', 'preact', 'replicad-opencascadejs'],
  },
];

function listSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSources(full));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

function parseImports(file) {
  const text = readFileSync(file, 'utf8');
  const imports = [];
  let m;
  while ((m = IMPORT_RE.exec(text))) {
    const spec = m[4] ?? m[5] ?? m[6];
    if (!spec) continue;
    const typeOnly = !!m[2] || (m[3] !== undefined && /^\{[^}]*\}$/.test(m[3].trim()) && m[3].trim().slice(1, -1).split(',').every((s) => s.trim() === '' || s.trim().startsWith('type ')));
    imports.push({ spec, typeOnly });
  }
  return imports;
}

function resolveInternal(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const rel = (f) => relative(SRC, f).split('\\').join('/');
const files = listSources(SRC);
const graph = new Map();
const violations = [];

/** Exception documentée : le panneau d'une fonction (features/<type>/panel.tsx) est du code d'interface. */
const PANEL_RULE = {
  layer: 'features (panneau)',
  forbidInternal: ['geometry/occt', 'workers', 'app', 'viewport', 'persistence', 'io'],
  forbidPackages: ['three', 'replicad-opencascadejs'],
};

for (const file of files) {
  const r = rel(file);
  const rule = /^features\/[^/]+\/panel\.tsx$/.test(r) ? PANEL_RULE : RULES.find((x) => r === `${x.layer}.ts` || r.startsWith(`${x.layer}/`));
  const deps = [];
  for (const { spec, typeOnly } of parseImports(file)) {
    const target = resolveInternal(file, spec);
    if (target) {
      const t = rel(target);
      if (!typeOnly) deps.push(target);
      const forbidden = rule?.forbidInternal.find((p) => t === `${p}.ts` || t.startsWith(`${p}/`));
      // Les fichiers de types partagés (interfaces) peuvent être importés en `import type`.
      if (forbidden && !typeOnly) violations.push(`${r} → ${t} : la couche « ${rule.layer} » ne doit pas dépendre de « ${forbidden} »`);
      else if (forbidden && typeOnly && !['viewport', 'app'].includes(rule.layer)) {
        violations.push(`${r} → ${t} (type) : la couche « ${rule.layer} » ne doit pas dépendre de « ${forbidden} »`);
      }
    } else if (!spec.startsWith('.')) {
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      const forbidden = rule?.forbidPackages.includes(pkg);
      if (forbidden && !typeOnly) violations.push(`${r} → ${spec} : la couche « ${rule.layer} » ne doit pas utiliser « ${pkg} »`);
    }
  }
  graph.set(file, deps);
}

// Détection des cycles (DFS itératif sur les imports exécutés).
const cycles = [];
const state = new Map();
const stack = [];
function visit(node) {
  state.set(node, 1);
  stack.push(node);
  for (const dep of graph.get(node) ?? []) {
    if (state.get(dep) === 1) {
      const cycle = stack.slice(stack.indexOf(dep)).concat(dep).map(rel);
      cycles.push(cycle.join(' → '));
    } else if (!state.has(dep)) visit(dep);
  }
  stack.pop();
  state.set(node, 2);
}
for (const f of files) if (!state.has(f)) visit(f);

for (const c of cycles) violations.push(`dépendance circulaire : ${c}`);

if (violations.length > 0) {
  console.error(`Architecture : ${violations.length} problème(s)\n`);
  for (const v of violations) console.error(`  ✗ ${v}`);
  process.exit(1);
}
console.log(`Architecture : ${files.length} modules vérifiés, aucune violation de couche ni dépendance circulaire.`);
