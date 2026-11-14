/**
 * Parcours guidé « préparer la fabrication » : plateau d'impression 3D, découpe laser et
 * documents (mise en plan, gabarit, nomenclature). Il suppose au moins une pièce avec un volume.
 */
import type { AppState } from '../app/state';
import type { TutorialStep } from './types';

const hasSolid = (s: AppState) => s.doc.parts.some((p) => (s.display[p.id]?.result.analysis?.solidCount ?? 0) > 0);
const fab = (s: AppState) => s.doc.fabrication;

export const FABRICATION_TUTORIAL: TutorialStep[] = [
  {
    id: 'intro',
    title: 'Préparer la fabrication',
    body: [
      'Une pièce dessinée peut être **imprimée en 3D**, **découpée au laser** dans une plaque, ou fabriquée à la main d’après un **plan**.',
      'Il faut au moins **une pièce avec un volume**. Si le projet est vide, faites d’abord le parcours « La plaque percée ».',
    ],
    check: hasSolid,
  },
  {
    id: 'tab',
    title: '1. Ouvrir l’onglet Fabrication',
    body: [
      'Cliquez sur l’onglet **Fabrication**, en haut. On arrive sur **Matières** : pour chaque pièce, on choisit dans quoi elle sera fabriquée (PLA, acrylique…), ce qui lui donne sa couleur réelle.',
    ],
    target: 'tab-fabrication',
    check: (s) => s.workspace === 'fabrication',
  },
  {
    id: 'copies',
    title: '2. Imprimer deux exemplaires',
    body: [
      'Cliquez **Impression 3D** dans la barre d’outils : la vue montre le plateau de l’imprimante.',
      'À gauche, mettez **2** dans « Exemplaires » : les pièces se rangent seules sur le plateau. S’il y en a trop, elles passent sur un deuxième plateau.',
      'La matière nécessaire (en grammes de PLA) s’affiche à droite.',
    ],
    check: (s) => (fab(s)?.print.items ?? []).some((i) => i.copies >= 2),
  },
  {
    id: 'down-face',
    title: '3. Choisir la face posée sur le plateau',
    body: [
      'Cliquez **Face du dessous**, puis une face plate de la pièce dans la vue : la pièce se retourne pour se poser sur cette face. Une grande face plate en bas imprime mieux.',
      'Le bouton **Exporter 3MF** produit le fichier pour le logiciel d’impression (PrusaSlicer, Bambu Studio, Cura…).',
    ],
    check: (s) => (fab(s)?.print.items ?? []).some((i) => !!i.downFace),
  },
  {
    id: 'laser',
    title: '4. La découpe laser',
    body: [
      'Cliquez **Découpe laser** dans la barre d’outils. Mettez **1** exemplaire à découper : le contour de la pièce est tracé à taille réelle sur une plaque.',
      'Chaque matériau a sa page (contreplaqué 3 mm, 5 mm…) : la pièce va d’elle-même sur le matériau de la même épaisseur.',
    ],
    target: 'fab-laser',
    check: (s) => s.fabricationTab === 'laser' && (fab(s)?.laser.items ?? []).some((i) => i.copies >= 1),
  },
  {
    id: 'docs',
    title: '5. Les documents',
    body: [
      'Cliquez **Documents** : la **mise en plan** montre la pièce de face, de dessus et de gauche avec ses dimensions.',
      'Vous pouvez aussi imprimer un **gabarit 1:1** pour tracer la pièce sur du carton ou du bois, et la **nomenclature** (la liste des pièces).',
    ],
    target: 'fab-docs',
    check: (s) => s.fabricationTab === 'docs',
  },
  {
    id: 'end',
    title: 'Fabrication préparée',
    body: ['La pièce est prête pour l’impression 3D, la découpe laser ou l’atelier. Vérifiez l’échelle du gabarit imprimé avec son trait de 50 mm.'],
  },
];
