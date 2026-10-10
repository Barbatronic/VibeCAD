import type { Id } from './model';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomSuffix(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Identifiant stable et lisible, par exemple `part-k3x9q2m1`. Les identifiants ne sont jamais
 * réutilisés ni recalculés : ils servent aux références entre fonctions.
 */
export function createId(prefix: string, taken?: ReadonlySet<string>): Id {
  for (;;) {
    const id = `${prefix}-${randomSuffix(8)}`;
    if (!taken || !taken.has(id)) return id;
  }
}

/** Identifiant local à une esquisse : `p1`, `l2`, `c3`… (plus petit numéro libre après le max). */
export function nextLocalId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of existing) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}
