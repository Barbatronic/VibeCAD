import { DISPLAY_DECIMALS, INPUT_DECIMALS, TOLERANCES } from './tolerances';

/** Formate une longueur en français : `12,5 mm`, `60 mm`. */
export function formatLength(value: number, decimals = DISPLAY_DECIMALS, withUnit = true): string {
  const text = formatNumber(value, decimals);
  return withUnit ? `${text} mm` : text;
}

export function formatNumber(value: number, decimals = DISPLAY_DECIMALS): string {
  const factor = 10 ** decimals;
  let rounded = Math.round(value * factor) / factor;
  if (Object.is(rounded, -0)) rounded = 0;
  return rounded.toLocaleString('fr-FR', { maximumFractionDigits: decimals, useGrouping: false });
}

/** Formate un angle en degrés : `45°`, `22,5°`. */
export function formatAngle(value: number, decimals = DISPLAY_DECIMALS): string {
  return `${formatNumber(value, decimals)}°`;
}

/** Lit un angle en degrés (0 < angle < 180), avec les mêmes facilités que les longueurs. */
export function parseAngle(input: string, label = 'L’angle'): ParseResult {
  const value = readNumber(input);
  if (input.trim() === '') return { ok: false, error: `${label} est vide : saisissez un nombre de degrés, par exemple 45.` };
  if (value === null) return { ok: false, error: `${label} doit être un nombre de degrés (exemple : 45 ou 22,5).` };
  const factor = 10 ** INPUT_DECIMALS;
  const rounded = Math.round(value * factor) / factor;
  if (rounded <= 0 || rounded >= 180) return { ok: false, error: `${label} doit être compris entre 0° et 180° (exclus).` };
  return { ok: true, value: rounded };
}

export function formatArea(value: number): string {
  return `${formatNumber(value, 2)} mm²`;
}

export function formatVolume(value: number): string {
  return `${formatNumber(value, 2)} mm³`;
}

export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

export interface LengthRules {
  /** Valeur minimale (incluse). Par défaut la plus petite cote acceptée. */
  min?: number;
  max?: number;
  /** Autorise la valeur 0 (ex. distance horizontale nulle). */
  allowZero?: boolean;
  /** Libellé utilisé dans les messages, par exemple « La profondeur ». */
  label?: string;
}

/**
 * Lit une longueur saisie au clavier. Accepte la virgule ou le point décimal, l'unité « mm »
 * facultative, les espaces, et les opérations simples (`60/2`, `30 + 5,5`, `(10+2)*3`).
 * Ne lève jamais d'exception : renvoie un message compréhensible en cas d'erreur.
 */
export function parseLength(input: string, rules: LengthRules = {}): ParseResult {
  const label = rules.label ?? 'La valeur';
  let text = input.trim().toLowerCase();
  if (text.endsWith('mm')) text = text.slice(0, -2).trim();
  if (text === '') return { ok: false, error: `${label} est vide : saisissez un nombre, par exemple 12,5.` };
  text = text.replace(/,/g, '.').replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  if (/[^0-9.+\-*/()]/.test(text)) {
    return { ok: false, error: `${label} doit être un nombre (exemple : 12,5). Les lettres ne sont pas acceptées.` };
  }
  const parsed = evaluateExpression(text);
  if (parsed === null || !Number.isFinite(parsed)) {
    return { ok: false, error: `${label} n’est pas un nombre valide. Exemple : 12,5 ou 60/2.` };
  }
  const factor = 10 ** INPUT_DECIMALS;
  const value = Math.round(parsed * factor) / factor;
  const min = rules.min ?? TOLERANCES.minLength;
  const max = rules.max ?? TOLERANCES.maxLength;
  if (value === 0 && rules.allowZero) return { ok: true, value: 0 };
  if (value < 0) return { ok: false, error: `${label} doit être positive.` };
  if (value < min) {
    return { ok: false, error: `${label} doit être au moins ${formatLength(min, 3)}.` };
  }
  if (value > max) return { ok: false, error: `${label} ne peut pas dépasser ${formatLength(max, 0)}.` };
  return { ok: true, value };
}

/** Valeur numérique d'une saisie (virgule, unité et expressions acceptées), ou null. */
export function readNumber(input: string): number | null {
  let text = input.trim().toLowerCase();
  if (text.endsWith('mm')) text = text.slice(0, -2).trim();
  if (text.endsWith('°')) text = text.slice(0, -1).trim();
  text = text.replace(/,/g, '.').replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  if (text === '' || /[^0-9.+\-*/()]/.test(text)) return null;
  const v = evaluateExpression(text);
  return v !== null && Number.isFinite(v) ? v : null;
}

export interface StepRules {
  /** Valeur la plus basse atteignable par les flèches (par défaut : la plus petite cote). */
  min?: number;
  max?: number;
  /** Valeur de départ quand la saisie est vide ou invalide (ex. la dimension en cours de tracé). */
  fallback?: number;
}

/**
 * Augmente ou diminue une saisie d'un pas (flèches, molette). Renvoie le nouveau texte, ou null
 * si rien ne change (saisie illisible sans valeur de départ, ou limite atteinte).
 */
export function stepNumberText(text: string, direction: 1 | -1, step: number, rules: StepRules = {}): string | null {
  const current = readNumber(text) ?? rules.fallback;
  if (current === undefined) return null;
  const factor = 10 ** INPUT_DECIMALS;
  let next = Math.round((current + direction * step) * factor) / factor;
  const min = rules.min ?? TOLERANCES.minLength;
  const max = rules.max ?? TOLERANCES.maxLength;
  // Hors limites : la valeur ne bouge pas (1 mm − 1 ne devient pas 0,01 mm par surprise).
  if (next < min || next > max) next = current;
  if (next === current && readNumber(text) !== null) return null;
  return formatNumber(next, INPUT_DECIMALS);
}

/** Évaluateur d'expressions arithmétiques sûr (sans eval) : + − × ÷ et parenthèses. */
function evaluateExpression(text: string): number | null {
  let pos = 0;
  const peek = () => text[pos];
  const parseNumber = (): number | null => {
    const start = pos;
    while (pos < text.length && /[0-9.]/.test(text[pos]!)) pos++;
    const token = text.slice(start, pos);
    if (token === '' || token === '.' || (token.match(/\./g)?.length ?? 0) > 1) return null;
    return Number(token);
  };
  const parseFactor = (): number | null => {
    const c = peek();
    if (c === '+') {
      pos++;
      return parseFactor();
    }
    if (c === '-') {
      pos++;
      const v = parseFactor();
      return v === null ? null : -v;
    }
    if (c === '(') {
      pos++;
      const v = parseSum();
      if (v === null || peek() !== ')') return null;
      pos++;
      return v;
    }
    return parseNumber();
  };
  const parseProduct = (): number | null => {
    let left = parseFactor();
    while (left !== null && (peek() === '*' || peek() === '/')) {
      const op = text[pos++];
      const right = parseFactor();
      if (right === null) return null;
      if (op === '/' && right === 0) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  };
  const parseSum = (): number | null => {
    let left = parseProduct();
    while (left !== null && (peek() === '+' || peek() === '-')) {
      const op = text[pos++];
      const right = parseProduct();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  const result = parseSum();
  return pos === text.length ? result : null;
}
