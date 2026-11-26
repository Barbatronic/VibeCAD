/**
 * Réglages de la scène de rendu (atelier Rendu, style d'affichage Rendu, export d'images et de
 * vidéos) : lumière principale, ambiance, sol et fond. Rangés dans le projet ; chaque réglage absent
 * prend sa valeur par défaut.
 */

export type RenderGround = 'none' | 'shadow' | 'color';
export type RenderBackground = 'view' | 'color' | 'gradient';

export interface RenderSettings {
  /** Direction de la lumière principale vue du dessus (degrés, 0 : vers +X, sens trigonométrique). */
  lightAzimuth: number;
  /** Hauteur de la lumière au-dessus de l'horizon (degrés, 5 à 90). */
  lightElevation: number;
  lightIntensity: number;
  /** Douceur du bord des ombres (0 : net). */
  shadowSoftness: number;
  /** Opacité de l'ombre portée sur le sol (0 à 1). */
  shadowOpacity: number;
  /** Reflets de la pièce d'environnement (0 à 2). */
  environment: number;
  exposure: number;
  /** Ombrage des creux. */
  occlusion: boolean;
  /** Sol : aucun, ombre seule (invisible), ou sol coloré qui reçoit l'ombre. */
  ground: RenderGround;
  groundColor: string;
  /** Fond : celui de la vue, une couleur, ou un dégradé vertical. */
  background: RenderBackground;
  backgroundColor: string;
  backgroundBottom: string;
}

export const DEFAULT_RENDER: Readonly<RenderSettings> = {
  lightAzimuth: 237,
  lightElevation: 56,
  lightIntensity: 1.5,
  shadowSoftness: 5,
  shadowOpacity: 0.22,
  environment: 0.3,
  exposure: 0.95,
  occlusion: true,
  ground: 'shadow',
  groundColor: '#d9dde3',
  background: 'view',
  backgroundColor: '#ffffff',
  backgroundBottom: '#d5dbe3',
};

/** Bornes des réglages numériques. */
export const RENDER_LIMITS: Readonly<Record<'lightAzimuth' | 'lightElevation' | 'lightIntensity' | 'shadowSoftness' | 'shadowOpacity' | 'environment' | 'exposure', readonly [number, number]>> = {
  lightAzimuth: [0, 360],
  lightElevation: [5, 90],
  lightIntensity: [0, 5],
  shadowSoftness: [0, 12],
  shadowOpacity: [0, 1],
  environment: [0, 2],
  exposure: [0.2, 3],
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Réglages complets d'un projet (valeurs par défaut pour ceux qu'il n'a pas). */
export function renderSettings(stored: Partial<RenderSettings> | undefined): RenderSettings {
  return { ...DEFAULT_RENDER, ...(stored ?? {}) };
}

/**
 * Réglages lus dans un fichier : seuls ceux qui ont le bon type sont gardés, ramenés dans leurs
 * bornes (un réglage de rendu ne doit pas empêcher d'ouvrir un projet). Rien : undefined.
 */
export function readRenderSettings(raw: unknown): Partial<RenderSettings> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: Partial<RenderSettings> = {};
  for (const [key, [min, max]] of Object.entries(RENDER_LIMITS) as [keyof typeof RENDER_LIMITS, readonly [number, number]][]) {
    const x = o[key];
    if (typeof x === 'number' && Number.isFinite(x)) out[key] = Math.min(max, Math.max(min, x));
  }
  if (typeof o.occlusion === 'boolean') out.occlusion = o.occlusion;
  if (o.ground === 'none' || o.ground === 'shadow' || o.ground === 'color') out.ground = o.ground;
  if (o.background === 'view' || o.background === 'color' || o.background === 'gradient') out.background = o.background;
  for (const key of ['groundColor', 'backgroundColor', 'backgroundBottom'] as const) {
    const x = o[key];
    if (typeof x === 'string' && HEX.test(x)) out[key] = x.toLowerCase();
  }
  return Object.keys(out).length ? out : undefined;
}

/** Réglages à ranger dans le projet : seulement ceux qui diffèrent des valeurs par défaut. */
export function storedRender(settings: RenderSettings): Partial<RenderSettings> | undefined {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_RENDER) as (keyof RenderSettings)[]) {
    if (settings[key] !== DEFAULT_RENDER[key]) out[key] = settings[key];
  }
  return Object.keys(out).length ? (out as Partial<RenderSettings>) : undefined;
}

/** Direction (unitaire, Z vers le haut) d'où vient la lumière principale. */
export function lightDirection(s: Pick<RenderSettings, 'lightAzimuth' | 'lightElevation'>): { x: number; y: number; z: number } {
  const a = (s.lightAzimuth * Math.PI) / 180;
  const e = (s.lightElevation * Math.PI) / 180;
  return { x: Math.cos(e) * Math.cos(a), y: Math.cos(e) * Math.sin(a), z: Math.sin(e) };
}
