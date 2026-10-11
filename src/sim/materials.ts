/**
 * Matériaux de la simulation. Les valeurs sont prudentes : une pièce imprimée (couches, remplissage)
 * est moins résistante que le plastique moulé, et le résultat reste indicatif.
 */
import type { Material } from './fea';

export interface SimMaterial extends Material {
  id: string;
  name: string;
  /** Contrainte (MPa) au-delà de laquelle la pièce risque de casser ou de se tordre pour de bon. */
  strength: number;
}

export const SIM_MATERIALS: SimMaterial[] = [
  { id: 'pla', name: 'PLA imprimé', E: 3000, nu: 0.36, strength: 30 },
  { id: 'petg', name: 'PETG imprimé', E: 2000, nu: 0.38, strength: 30 },
  { id: 'abs', name: 'ABS imprimé', E: 1900, nu: 0.35, strength: 25 },
  { id: 'plywood', name: 'Contreplaqué', E: 6000, nu: 0.3, strength: 25 },
  // Acrylique (PMMA, plaques de découpe laser) : cassant, et les bords découpés ont des
  // micro-fissures ; résistance retenue bien sous les 60 à 70 MPa annoncés.
  { id: 'acrylic', name: 'Acrylique (PMMA)', E: 3000, nu: 0.37, strength: 35 },
  { id: 'aluminium', name: 'Aluminium', E: 69000, nu: 0.33, strength: 150 },
  { id: 'steel', name: 'Acier', E: 200000, nu: 0.3, strength: 250 },
];

export function simMaterial(id: string): SimMaterial {
  return SIM_MATERIALS.find((m) => m.id === id) ?? SIM_MATERIALS[0]!;
}

/** Pesanteur (m/s²) : une masse de m kg posée pèse m × 9,81 N. */
export const GRAVITY = 9.81;
