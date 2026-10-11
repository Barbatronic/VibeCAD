/**
 * Ressources embarquées : le contenu exact des fichiers importés est conservé dans le projet
 * (jamais un chemin vers le fichier d'origine), avec son empreinte SHA-256.
 */
import type { Id, StepResource } from '../domain/model';
import type { ResourceData, ResourceProvider } from '../features/evaluation';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Crée la ressource d'un fichier STEP : texte UTF-8 tel quel si possible, sinon base64. */
export async function createStepResource(id: Id, fileName: string, bytes: Uint8Array, importedAt = new Date().toISOString(), kind: StepResource['kind'] = 'step'): Promise<StepResource> {
  let encoding: StepResource['encoding'] = 'utf8';
  let data: string;
  try {
    data = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Le texte doit se ré-encoder à l'identique (sinon l'empreinte ne correspondrait plus).
    const back = new TextEncoder().encode(data);
    if (back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) throw new Error('round-trip');
  } catch {
    encoding = 'base64';
    data = bytesToBase64(bytes);
  }
  return { id, kind, fileName, encoding, data, byteLength: bytes.length, sha256: await sha256Hex(bytes), importedAt };
}

export function resourceBytes(resource: StepResource): Uint8Array {
  return resource.encoding === 'utf8' ? new TextEncoder().encode(resource.data) : base64ToBytes(resource.data);
}

/** Vérifie l'intégrité des ressources d'un projet ouvert ; renvoie les noms de fichiers altérés. */
export async function verifyResources(resources: Record<Id, StepResource>): Promise<string[]> {
  const altered: string[] = [];
  for (const r of Object.values(resources)) {
    const bytes = resourceBytes(r);
    if (bytes.length !== r.byteLength || (await sha256Hex(bytes)) !== r.sha256) altered.push(r.fileName);
  }
  return altered;
}

/** Noms de produits d'un fichier STEP (décodage des échappements ISO 10303-21 courants). */
export function stepProductNames(bytes: Uint8Array): string[] {
  const text = new TextDecoder('latin1').decode(bytes.length > 4_000_000 ? bytes.subarray(0, 4_000_000) : bytes);
  const names: string[] = [];
  const re = /PRODUCT\s*\(\s*'((?:[^']|'')*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = decodeStepString(m[1]!);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function decodeStepString(raw: string): string {
  let s = raw.replace(/''/g, "'");
  s = s.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_all, hex: string) => {
    let out = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
  });
  s = s.replace(/\\X\\([0-9A-Fa-f]{2})/g, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  // Texte UTF-8 brut lu en latin1 : on tente de le redécoder.
  try {
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
    if (Array.from(s).every((c) => c.charCodeAt(0) < 256)) {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      s = decoded;
    }
  } catch {
    // Pas de l'UTF-8 : on garde le latin1.
  }
  return s.trim();
}

/** Fournisseur de ressources pour le moteur de recalcul (octets décodés à la demande). */
export function createResourceProvider(resources: Record<Id, StepResource>): ResourceProvider {
  const cache = new Map<Id, ResourceData>();
  return {
    get(id) {
      const hit = cache.get(id);
      if (hit) return hit;
      const r = resources[id];
      if (!r) return undefined;
      const data = { sha256: r.sha256, fileName: r.fileName, bytes: resourceBytes(r), kind: r.kind };
      cache.set(id, data);
      return data;
    },
  };
}
