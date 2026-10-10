/** Parcours guidés proposés dans le panneau « Parcours ». */
import { ASSEMBLY_TUTORIAL } from './assembly-tutorial';
import { FABRICATION_TUTORIAL } from './fabrication-tutorial';
import { PLATE_TUTORIAL } from './plate-tutorial';
import type { TutorialStep } from './types';

export type TutorialId = 'plate' | 'assembly' | 'fabrication';

export interface TutorialInfo {
  id: TutorialId;
  title: string;
  description: string;
  steps: TutorialStep[];
}

export const TUTORIALS: TutorialInfo[] = [
  { id: 'plate', title: 'La plaque percée', description: 'Première pièce : esquisse, cotes, extrusion, perçage, modification.', steps: PLATE_TUTORIAL },
  { id: 'assembly', title: 'Assembler et faire bouger', description: 'Insérer des pièces, les relier par une liaison pivot, les faire tourner.', steps: ASSEMBLY_TUTORIAL },
  { id: 'fabrication', title: 'Préparer la fabrication', description: 'Impression 3D, découpe laser, mise en plan et gabarit.', steps: FABRICATION_TUTORIAL },
];

export function tutorialById(id: TutorialId): TutorialInfo {
  return TUTORIALS.find((t) => t.id === id) ?? TUTORIALS[0]!;
}

export type { TutorialStep };
