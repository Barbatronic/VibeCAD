/**
 * Paramètres du projet : calcul de leurs valeurs (dans l'ordre de leurs dépendances), puis report
 * dans les étapes et les cotes d'esquisse qui portent une équation. Un champ d'étape est désigné
 * par son nom dans le panneau (`distance`, `x`, `tx`…), traduit ici en chemin dans les paramètres.
 */
import type { CadDocument, Feature, ProjectParameter } from '../domain/model';
import { evaluateExpression, expressionNames } from '../domain/units';

export interface ResolvedParameters {
  /** Valeurs par nom en minuscules. */
  values: Map<string, number>;
  /** Problème de chaque paramètre fautif (par nom tel qu'écrit). */
  errors: Map<string, string>;
}

/** Valeurs des paramètres ; un paramètre peut utiliser ceux définis ailleurs dans la liste. */
export function resolveParameters(params: readonly ProjectParameter[]): ResolvedParameters {
  const values = new Map<string, number>();
  const errors = new Map<string, string>();
  const known = new Set<string>();
  const pending: ProjectParameter[] = [];
  for (const p of params) {
    const key = p.name.toLowerCase();
    if (known.has(key)) errors.set(p.name, `Le nom « ${p.name} » est déjà utilisé par un autre paramètre.`);
    else {
      known.add(key);
      pending.push(p);
    }
  }
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i]!;
      const names = expressionNames(p.expression);
      const missing = names.find((n) => !known.has(n));
      if (missing) {
        errors.set(p.name, `« ${missing} » n’est pas un paramètre du projet.`);
        pending.splice(i--, 1);
        progress = true;
        continue;
      }
      if (names.some((n) => !values.has(n))) continue;
      const r = evaluateExpression(p.expression, values);
      if (r.ok) values.set(p.name.toLowerCase(), r.value);
      else errors.set(p.name, `L’équation de « ${p.name} » n’est pas valide.`);
      pending.splice(i--, 1);
      progress = true;
    }
  }
  // Ce qui reste dépend de soi-même, directement ou par d'autres paramètres.
  for (const p of pending) errors.set(p.name, `« ${p.name} » dépend de lui-même (boucle entre paramètres).`);
  return { values, errors };
}

/** Chemin du réglage d'un champ du panneau (nom du champ → chemin dans `params`). */
function fieldPath(feature: Feature, field: string): string[] | null {
  const special: Partial<Record<Feature['type'], Record<string, string>>> = {
    fillet: { size: 'radius' },
    chamfer: { size: 'distance' },
    pocket: { distance: 'extent.distance', distance2: 'extent2.distance' },
    pattern: { count2: 'second.count', spacing2: 'second.spacing' },
    move: { tx: 'translation.x', ty: 'translation.y', tz: 'translation.z', cx: 'center.x', cy: 'center.y', cz: 'center.z' },
  };
  const path = special[feature.type]?.[field] ?? (['x', 'y', 'z'].includes(field) ? `position.${field}` : field);
  const parts = path.split('.');
  // Le chemin doit mener à un nombre existant.
  let o: unknown = feature.params;
  for (const k of parts) {
    if (typeof o !== 'object' || o === null || !(k in o)) return null;
    o = (o as Record<string, unknown>)[k];
  }
  return typeof o === 'number' ? parts : null;
}

function setPath(obj: Record<string, unknown>, path: readonly string[], value: number): Record<string, unknown> {
  const [k, ...rest] = path;
  if (rest.length === 0) return { ...obj, [k!]: value };
  return { ...obj, [k!]: setPath(obj[k!] as Record<string, unknown>, rest, value) };
}

/** Étape dont le champ prend la valeur donnée (épaisseur signée de « Épaissir » : le sens est gardé). */
export function applyFieldValue(feature: Feature, field: string, value: number): Feature {
  const path = fieldPath(feature, field);
  if (!path) return feature;
  let v = value;
  if (feature.type === 'thicken' && field === 'distance') v = Math.sign(feature.params.distance || 1) * Math.abs(value);
  if ((feature.type === 'pattern' && (field === 'count' || field === 'count2')) || (feature.type === 'gear' && field === 'teeth')) v = Math.round(v);
  return { ...feature, params: setPath(feature.params as unknown as Record<string, unknown>, path, v) } as unknown as Feature;
}

/**
 * Projet dont les champs et les cotes liés à des paramètres sont recalculés. Une équation devenue
 * invalide (paramètre supprimé, boucle) laisse la dernière valeur en place.
 */
export function applyParameters(doc: CadDocument): CadDocument {
  const { values } = resolveParameters(doc.parameters ?? []);
  let changed = false;
  const parts = doc.parts.map((part) => {
    let partChanged = false;
    const features = part.features.map((f) => {
      let next: Feature = f;
      for (const [field, expr] of Object.entries(f.expressions ?? {})) {
        const r = evaluateExpression(expr, values);
        if (r.ok) next = applyFieldValue(next, field, r.value);
      }
      if (next.type === 'sketch') {
        let constraintsChanged = false;
        const constraints = next.params.constraints.map((c) => {
          if (!('value' in c) || !c.expression) return c;
          const r = evaluateExpression(c.expression, values);
          if (!r.ok || r.value < 0 || r.value === c.value) return c;
          constraintsChanged = true;
          return { ...c, value: r.value };
        });
        if (constraintsChanged) next = { ...next, params: { ...next.params, constraints } };
      }
      if (next !== f && JSON.stringify(next.params) !== JSON.stringify(f.params)) {
        partChanged = true;
        return next;
      }
      return f;
    });
    if (!partChanged) return part;
    changed = true;
    return { ...part, features };
  });
  return changed ? { ...doc, parts } : doc;
}

const usesName = (expr: string, name: string) => expressionNames(expr).includes(name.toLowerCase());

/** Ce qui utilise un paramètre (« Esquisse 1 (cote) », « Extrusion 1 », autre paramètre…). */
export function parameterUses(doc: CadDocument, name: string): string[] {
  const out: string[] = [];
  for (const p of doc.parameters ?? []) if (p.name.toLowerCase() !== name.toLowerCase() && usesName(p.expression, name)) out.push(`paramètre ${p.name}`);
  for (const part of doc.parts)
    for (const f of part.features) {
      if (Object.values(f.expressions ?? {}).some((e) => usesName(e, name))) out.push(f.name);
      if (f.type === 'sketch' && f.params.constraints.some((c) => 'value' in c && c.expression && usesName(c.expression, name))) out.push(`${f.name} (cote)`);
    }
  return out;
}

/** Remplace un nom de paramètre (mot entier, sans tenir compte des majuscules) dans une équation. */
function renameIn(expr: string, from: string, to: string): string {
  return expr.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'giu'), `$1${to}`);
}

/** Projet où le paramètre renommé l'est aussi dans toutes les équations qui l'utilisent. */
export function renameParameterUses(doc: CadDocument, from: string, to: string): CadDocument {
  const parameters = doc.parameters?.map((p) => (usesName(p.expression, from) ? { ...p, expression: renameIn(p.expression, from, to) } : p));
  const parts = doc.parts.map((part) => ({
    ...part,
    features: part.features.map((f) => {
      let next: Feature = f;
      if (f.expressions) next = { ...next, expressions: Object.fromEntries(Object.entries(f.expressions).map(([k, e]) => [k, renameIn(e, from, to)])) };
      if (next.type === 'sketch') {
        next = { ...next, params: { ...next.params, constraints: next.params.constraints.map((c) => ('value' in c && c.expression ? { ...c, expression: renameIn(c.expression, from, to) } : c)) } };
      }
      return next;
    }),
  }));
  return { ...doc, parts, ...(parameters ? { parameters } : {}) };
}
