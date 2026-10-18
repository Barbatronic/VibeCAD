/**
 * Couleurs de la vue 3D. Elles reprennent les jetons de `styles/tokens.css` ; la vue lit les
 * valeurs calculées au démarrage et au changement de thème (clair / sombre).
 */
export interface ViewportPalette {
  background: string;
  backgroundBottom: string;
  gridMinor: string;
  gridMajor: string;
  axisX: string;
  axisY: string;
  axisZ: string;
  edge: string;
  sketch: string;
  sketchConstrained: string;
  sketchSelected: string;
  sketchHover: string;
  /** Géométrie reprise de la pièce (fixe). */
  sketchReference: string;
  dimension: string;
  preview: string;
  previewAdd: string;
  previewCut: string;
  selection: string;
  hover: string;
  error: string;
  plane: string;
  stale: string;
}

const FALLBACK: ViewportPalette = {
  background: '#eef2f7',
  backgroundBottom: '#d9e1eb',
  gridMinor: '#c7d0dc',
  gridMajor: '#a7b4c4',
  axisX: '#d64545',
  axisY: '#2f9e44',
  axisZ: '#2f6fd6',
  edge: '#27303c',
  sketch: '#1f5fbf',
  sketchConstrained: '#1d8a4a',
  sketchSelected: '#e06c00',
  sketchHover: '#3d8bff',
  sketchReference: '#a03fc4',
  dimension: '#46505e',
  preview: '#6b7685',
  previewAdd: '#2fa36b',
  previewCut: '#d64545',
  selection: '#e06c00',
  hover: '#f2c200',
  error: '#d1342f',
  plane: '#5b8fd9',
  stale: '#9aa3ad',
};

const TOKENS: Record<keyof ViewportPalette, string> = {
  background: '--vp-bg',
  backgroundBottom: '--vp-bg-bottom',
  gridMinor: '--vp-grid-minor',
  gridMajor: '--vp-grid-major',
  axisX: '--vp-axis-x',
  axisY: '--vp-axis-y',
  axisZ: '--vp-axis-z',
  edge: '--vp-edge',
  sketch: '--vp-sketch',
  sketchConstrained: '--vp-sketch-constrained',
  sketchSelected: '--vp-sketch-selected',
  sketchHover: '--vp-sketch-hover',
  sketchReference: '--vp-sketch-reference',
  dimension: '--vp-dimension',
  preview: '--vp-preview',
  previewAdd: '--vp-preview-add',
  previewCut: '--vp-preview-cut',
  selection: '--vp-selection',
  hover: '--vp-hover',
  error: '--vp-error',
  plane: '--vp-plane',
  stale: '--vp-stale',
};

export function readPalette(element: Element | null): ViewportPalette {
  if (!element || typeof getComputedStyle === 'undefined') return { ...FALLBACK };
  const style = getComputedStyle(element);
  const out = { ...FALLBACK };
  for (const key of Object.keys(TOKENS) as (keyof ViewportPalette)[]) {
    const v = style.getPropertyValue(TOKENS[key]).trim();
    if (v) out[key] = v;
  }
  return out;
}
