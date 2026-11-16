/**
 * Lecteur S-expression (format des fichiers KiCad) : listes `( … )`, atomes nus et chaînes entre
 * guillemets (avec échappements). Les nombres restent du texte ; `num` les lit.
 */
export type SExpr = string | SList;
export interface SList {
  head: string;
  items: SExpr[];
}

export function parseSExpr(text: string): SList {
  let pos = 0;
  const stack: SExpr[][] = [];
  let root: SExpr[] | null = null;
  const n = text.length;
  while (pos < n) {
    const c = text.charCodeAt(pos);
    if (c === 40) {
      stack.push([]);
      pos++;
    } else if (c === 41) {
      const items = stack.pop();
      if (!items) throw new Error('Parenthèse fermante en trop.');
      const list: SList = { head: typeof items[0] === 'string' ? items[0] : '', items: items.slice(1) };
      const top = stack[stack.length - 1];
      if (top) top.push(list);
      else {
        root = [list];
        break;
      }
      pos++;
    } else if (c === 34) {
      let out = '';
      pos++;
      while (pos < n && text.charCodeAt(pos) !== 34) {
        if (text.charCodeAt(pos) === 92 && pos + 1 < n) {
          const e = text[pos + 1]!;
          out += e === 'n' ? '\n' : e;
          pos += 2;
        } else out += text[pos++];
      }
      pos++;
      stack[stack.length - 1]?.push(out);
    } else if (c <= 32) {
      pos++;
    } else {
      const start = pos;
      while (pos < n) {
        const d = text.charCodeAt(pos);
        if (d <= 32 || d === 40 || d === 41) break;
        pos++;
      }
      stack[stack.length - 1]?.push(text.slice(start, pos));
    }
  }
  const list = root?.[0];
  if (!list || typeof list === 'string') throw new Error('Fichier incomplet.');
  return list;
}

export const isList = (e: SExpr | undefined): e is SList => typeof e === 'object' && e !== null;

/** Premier enfant liste de tête `head`. */
export const child = (l: SList, head: string): SList | undefined => l.items.find((e): e is SList => isList(e) && e.head === head);
/** Enfants listes de tête `head`. */
export const children = (l: SList, head: string): SList[] => l.items.filter((e): e is SList => isList(e) && e.head === head);
/** Atome n° `i` (0 : premier après la tête). */
export const atom = (l: SList | undefined, i = 0): string | undefined => {
  const e = l?.items[i];
  return typeof e === 'string' ? e : undefined;
};
export const num = (l: SList | undefined, i = 0, fallback = 0): number => {
  const v = Number(atom(l, i));
  return Number.isFinite(v) ? v : fallback;
};
