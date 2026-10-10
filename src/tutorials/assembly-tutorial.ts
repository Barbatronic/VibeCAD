/**
 * Parcours guidé « assembler et faire bouger » : insérer deux exemplaires d'une pièce, les relier
 * par une liaison pivot, puis la faire tourner. Il suppose au moins une pièce avec un volume
 * (par exemple la plaque du premier parcours).
 */
import type { AppState } from '../app/state';
import type { TutorialStep } from './types';

const instances = (s: AppState) => s.doc.assembly?.instances.length ?? 0;
const joints = (s: AppState) => s.doc.assembly?.joints ?? [];
const hasSolid = (s: AppState) => s.doc.parts.some((p) => (s.display[p.id]?.result.analysis?.solidCount ?? 0) > 0);

export const ASSEMBLY_TUTORIAL: TutorialStep[] = [
  {
    id: 'intro',
    title: 'Assembler et faire bouger',
    body: [
      'Un **assemblage** réunit des pièces et dit comment elles bougent les unes par rapport aux autres, comme une charnière ou un tiroir.',
      'Il faut au moins **une pièce avec un volume**. Si le projet est vide, fais d’abord le parcours « La plaque percée ».',
    ],
    check: hasSolid,
  },
  {
    id: 'tab',
    title: '1. Ouvrir l’onglet Assemblage',
    body: ['Clique sur l’onglet **Assemblage**, en haut. Les pièces restent les mêmes : ici, on les place.'],
    target: 'tab-assembly',
    check: (s) => s.workspace === 'assembly',
  },
  {
    id: 'insert',
    title: '2. Insérer deux pièces',
    body: [
      'Clique sur **Insérer** puis choisis une pièce. Recommence pour en avoir **deux** (la même pièce peut être insérée deux fois).',
      'La première pièce insérée est **fixe** : c’est la référence. Les suivantes se placent par rapport à elle.',
    ],
    target: 'as-insert',
    check: (s) => instances(s) >= 2,
  },
  {
    id: 'joint',
    title: '3. Relier les deux pièces',
    body: [
      'Clique sur **Liaison**. Clique d’abord un **repère** sur la pièce qui va bouger (le centre d’une face, d’un trou, le milieu d’une arête), puis un repère sur la pièce fixe.',
      'Les deux repères se superposent : la pièce vient se coller à l’autre.',
    ],
    target: 'as-joint',
    check: (s) => joints(s).length >= 1,
  },
  {
    id: 'pivot',
    title: '4. Choisir une liaison pivot',
    body: [
      'Dans le panneau de droite, choisis le type **Pivot** : la pièce peut tourner autour de l’axe du repère, comme une roue ou une porte.',
      '**Glissière** la ferait glisser (comme un tiroir), **Pivot glissant** permet les deux.',
    ],
    check: (s) => joints(s).some((j) => j.kind === 'revolute' || j.kind === 'cylindrical'),
  },
  {
    id: 'move',
    title: '5. Faire tourner la pièce',
    body: [
      'Fais glisser le **curseur d’angle** dans le panneau de droite, ou attrape la pièce avec la souris : elle ne fait que le mouvement permis par la liaison.',
    ],
    target: 'joint-angle',
    check: (s) => joints(s).some((j) => Math.abs(j.angle) > 1e-6),
  },
  {
    id: 'end',
    title: '6. Exporter l’assemblage',
    body: [
      'Le bouton **STEP** exporte l’assemblage pour FreeCAD, chaque pièce à sa place. **3MF** l’envoie vers un logiciel d’impression 3D.',
      'Bravo : tu sais assembler des pièces et vérifier qu’elles bougent comme prévu !',
    ],
  },
];
