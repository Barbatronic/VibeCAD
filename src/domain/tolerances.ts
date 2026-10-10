/**
 * Tolérances géométriques explicites, en millimètres. Elles sont indépendantes du pas de grille
 * (aide au dessin) et de la précision d'affichage (arrondi des libellés).
 */
export const TOLERANCES = {
  /** Deux points plus proches que cette distance sont confondus lors de la construction d'un profil. */
  linear: 1e-6,
  /** Résidu maximal accepté pour qu'une contrainte d'esquisse soit considérée satisfaite. */
  solver: 1e-9,
  /** Plus petite cote ou profondeur acceptée. */
  minLength: 0.01,
  /** Plus grande cote acceptée (10 m), garde-fou contre les fautes de frappe. */
  maxLength: 10_000,
  /** Tolérance relative des contrôles de volume dans les tests. */
  volumeRelative: 1e-6,
  /** Angle (degrés) sous lequel un segment dessiné est proposé horizontal ou vertical. */
  inferenceAngleDeg: 4,
} as const;

/** Précision d'affichage des cotes (nombre maximal de décimales). */
export const DISPLAY_DECIMALS = 2;

/** Précision de saisie : les valeurs saisies sont arrondies au micromètre. */
export const INPUT_DECIMALS = 3;

/** Qualité de maillage pour l'affichage (n'affecte ni le solide B-Rep ni l'export STEP). */
export const DISPLAY_MESH = {
  /** Flèche maximale relative à la taille de la pièce. */
  relativeDeflection: 0.0015,
  minDeflection: 0.005,
  maxDeflection: 0.5,
  angularDeflection: 0.25,
} as const;

/** Qualité de maillage pour l'export STL (plus fine que l'affichage). */
export const EXPORT_MESH = {
  relativeDeflection: 0.0005,
  minDeflection: 0.002,
  maxDeflection: 0.1,
  angularDeflection: 0.1,
} as const;
