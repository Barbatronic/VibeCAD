/**
 * Parcours guidé « la plaque percée » : 60 × 30 × 5 mm, trou Ø 6 mm placé par des cotes.
 * Chaque étape se valide en observant l'état réel du modèle (pas de clic imposé) : l'enfant
 * peut explorer librement, passer une étape ou revenir en arrière.
 */
import type { AppState } from '../app/state';
import type { Part, SketchFeature, SketchParams } from '../domain/model';
import { extractProfiles } from '../sketch/profiles';
import type { TutorialStep } from './types';

export type { TutorialStep };

const near = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;

function activePart(s: AppState): Part | undefined {
  return s.doc.parts.find((p) => p.id === s.activePartId);
}

function sketches(s: AppState): SketchFeature[] {
  return activePart(s)?.features.filter((f): f is SketchFeature => f.type === 'sketch') ?? [];
}

function sessionSketch(s: AppState): SketchParams | null {
  return s.mode.kind === 'sketch' ? s.mode.session.sketch : null;
}

function isPlateRectangle(sk: SketchParams): boolean {
  const profile = extractProfiles(sk);
  if (!profile.ok || profile.regions.length !== 1) return false;
  const xs = sk.entities.flatMap((e) => (e.type === 'point' ? [e.x] : []));
  const ys = sk.entities.flatMap((e) => (e.type === 'point' ? [e.y] : []));
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return (near(w, 60) && near(h, 30)) || (near(w, 80) && near(h, 30));
}

function hasHoleCircle(sk: SketchParams): boolean {
  return sk.entities.some((e) => e.type === 'circle' && near(e.radius, 3));
}

function volume(s: AppState): number | null {
  const part = activePart(s);
  const a = part ? s.display[part.id]?.result.analysis : null;
  return a && a.solidCount > 0 ? a.volume : null;
}

const HOLE = Math.PI * 9 * 5;

export const PLATE_TUTORIAL: TutorialStep[] = [
  {
    id: 'intro',
    title: 'Dessinons une plaque percée',
    body: [
      'Nous allons fabriquer une **plaque de 60 × 30 mm**, épaisse de **5 mm**, avec un **trou de 6 mm** de diamètre.',
      'Comme les vrais logiciels de CAO : on dessine d’abord à plat (une **esquisse**), on lui donne une épaisseur (**extrusion**), puis on retire de la matière (**poche**).',
      'Tu peux explorer librement à tout moment. Clique sur « Suivant » pour commencer.',
    ],
  },
  {
    id: 'sketch-xy',
    title: '1. Choisir un plan',
    body: [
      'Clique sur le bouton **Esquisse** en haut, puis choisis le **plan XY (dessus)** : c’est comme dessiner sur une table, vu d’en haut.',
    ],
    target: 'tool-sketch',
    check: (s) =>
      (s.mode.kind === 'sketch' && s.mode.session.sketch.support.kind === 'plane' && s.mode.session.sketch.support.plane === 'XY') ||
      sketches(s).some((f) => f.params.support.kind === 'plane'),
  },
  {
    id: 'rectangle',
    title: '2. Dessiner le rectangle avec ses cotes',
    body: [
      'Avec l’outil **Rectangle**, clique sur l’**origine** (le petit cercle au croisement des axes rouge et vert).',
      'Tape ensuite **60**, appuie sur **Tab**, tape **30**, puis **Entrée**. Les nombres sont des **cotes** : les dimensions exactes du dessin, en millimètres.',
    ],
    target: 'sk-rectangle',
    check: (s) => {
      const sk = sessionSketch(s);
      return (sk !== null && isPlateRectangle(sk)) || sketches(s).some((f) => isPlateRectangle(f.params));
    },
  },
  {
    id: 'finish-sketch',
    title: '3. Terminer l’esquisse',
    body: ['Le dessin est vert : il est **entièrement contraint** (sa forme ne peut plus bouger). Clique sur **Terminer l’esquisse**, à droite.'],
    check: (s) => s.mode.kind !== 'sketch' && sketches(s).some((f) => isPlateRectangle(f.params)),
  },
  {
    id: 'extrude',
    title: '4. Donner une épaisseur',
    body: [
      '**Extrusion** : donner une épaisseur au dessin. Clique sur **Extrusion**, tape **5** dans « Longueur » : l’aperçu vert montre le volume.',
      'Clique sur **Valider** pour l’ajouter à l’historique.',
    ],
    target: 'tool-extrude',
    check: (s) => {
      const v = volume(s);
      return v !== null && (near(v, 9000, 0.01) || near(v, 12000, 0.01) || near(v, 9000 - HOLE, 0.01) || near(v, 12000 - HOLE, 0.01));
    },
  },
  {
    id: 'sketch-top',
    title: '5. Dessiner sur le dessus de la plaque',
    body: [
      '**Double-clique sur la face du dessus** de la plaque : une nouvelle esquisse s’ouvre directement sur cette face.',
      '(Autre façon : clique la face, puis le bouton **Esquisse**.)',
    ],
    check: (s) =>
      (s.mode.kind === 'sketch' && s.mode.session.sketch.support.kind === 'face') || sketches(s).some((f) => f.params.support.kind === 'face'),
  },
  {
    id: 'circle',
    title: '6. Dessiner le trou',
    body: [
      'Choisis l’outil **Cercle**, clique près du coin de la plaque (vers x = 15, y = 15), puis tape **6** (le diamètre) et **Entrée**.',
    ],
    target: 'sk-circle',
    check: (s) => {
      const sk = sessionSketch(s);
      return (sk !== null && hasHoleCircle(sk)) || sketches(s).some((f) => f.params.support.kind === 'face' && hasHoleCircle(f.params));
    },
  },
  {
    id: 'position',
    title: '7. Placer le trou avec des cotes',
    body: [
      'Choisis l’outil **Cote**. Clique le **centre du cercle**, puis l’**origine** : choisis « **Horizontale** », tape **15**, Entrée.',
      'Recommence pour la cote « **Verticale** » : **15**. Quand tout est vert, le trou est bien placé.',
    ],
    target: 'sk-dimension',
    check: (s) => {
      if (s.mode.kind === 'sketch') return hasHoleCircle(s.mode.session.sketch) && s.mode.session.dof === 0;
      const part = activePart(s);
      const result = part ? s.display[part.id]?.result : undefined;
      return sketches(s).some((f) => f.params.support.kind === 'face' && hasHoleCircle(f.params) && result?.sketches.find((r) => r.featureId === f.id)?.dof === 0);
    },
  },
  {
    id: 'finish-2',
    title: '8. Terminer l’esquisse du trou',
    body: ['Clique sur **Terminer l’esquisse**.'],
    check: (s) => s.mode.kind !== 'sketch' && sketches(s).some((f) => f.params.support.kind === 'face' && hasHoleCircle(f.params)),
  },
  {
    id: 'pocket',
    title: '9. Percer avec une poche',
    body: [
      '**Poche** : retirer de la matière en suivant le dessin. Clique sur **Poche** : la profondeur « **Traversante** » perce toute la plaque. L’aperçu rouge montre la matière retirée.',
      'Clique sur **Valider**.',
    ],
    target: 'tool-pocket',
    check: (s) => {
      const v = volume(s);
      return v !== null && (near(v, 9000 - HOLE, 0.01) || near(v, 12000 - HOLE, 0.01));
    },
  },
  {
    id: 'modify',
    title: '10. Changer d’avis : 80 mm de large',
    body: [
      'Le grand intérêt de la CAO : on peut **modifier une étape** et tout se recalcule. Dans l’historique à gauche, **double-clique sur « Esquisse 1 »**.',
      'Double-clique la cote **60 mm**, tape **80**, Entrée, puis **Terminer l’esquisse** : la plaque s’allonge et le trou reste à 15 mm de l’origine.',
    ],
    check: (s) => {
      const v = volume(s);
      return v !== null && near(v, 12000 - HOLE, 0.01);
    },
  },
  {
    id: 'save',
    title: '11. Enregistrer et partager',
    body: [
      'Clique sur **Fichier → Enregistrer** (ou Ctrl+S). Pour garder une copie sur l’ordinateur : **Enregistrer sous…**.',
      'Pour ouvrir la pièce dans **FreeCAD** : **Fichier → Exporter…**, format **STEP**. Bravo, tu as réalisé ta première pièce en CAO !',
    ],
    check: (s) => s.project.savedRevision === s.revision && s.project.savedAt !== null,
  },
];
