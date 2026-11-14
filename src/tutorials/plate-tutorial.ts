/**
 * Parcours guidé « la plaque percée » : 60 × 30 × 5 mm, trou Ø 6 mm placé par des cotes.
 * Chaque étape se valide en observant l'état réel du modèle (pas de clic imposé) : l'utilisateur
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
    title: 'Plaque percée',
    body: [
      'Objectif : une **plaque de 60 × 30 mm**, épaisse de **5 mm**, avec un **trou de 6 mm** de diamètre.',
      'Démarche : une **esquisse** à plat, une **extrusion** pour lui donner une épaisseur, puis une **poche** pour retirer de la matière.',
      'Chaque étape se valide d’elle-même. « Suivant » pour commencer.',
    ],
  },
  {
    id: 'sketch-xy',
    title: '1. Choisir un plan',
    body: [
      'Cliquez sur le bouton **Esquisse** en haut, puis choisissez le **plan XY (dessus)**.',
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
      'Avec l’outil **Rectangle**, cliquez sur l’**origine** (le petit cercle au croisement des axes rouge et vert).',
      'Tapez ensuite **60**, appuyez sur **Tab**, tapez **30**, puis **Entrée**. Les nombres sont des **cotes** : les dimensions exactes du dessin, en millimètres.',
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
    body: ['Le dessin est vert : il est **entièrement contraint** (sa forme ne peut plus bouger). Cliquez sur **Terminer l’esquisse**, à droite.'],
    check: (s) => s.mode.kind !== 'sketch' && sketches(s).some((f) => isPlateRectangle(f.params)),
  },
  {
    id: 'extrude',
    title: '4. Donner une épaisseur',
    body: [
      '**Extrusion** : donner une épaisseur au dessin. Cliquez sur **Extrusion**, tapez **5** dans « Longueur » : l’aperçu vert montre le volume.',
      'Cliquez sur **Valider** pour l’ajouter à l’historique.',
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
      '**Double-cliquez sur la face du dessus** de la plaque : une nouvelle esquisse s’ouvre directement sur cette face.',
      '(Autre façon : cliquez la face, puis le bouton **Esquisse**.)',
    ],
    check: (s) =>
      (s.mode.kind === 'sketch' && s.mode.session.sketch.support.kind === 'face') || sketches(s).some((f) => f.params.support.kind === 'face'),
  },
  {
    id: 'circle',
    title: '6. Dessiner le trou',
    body: [
      'Choisissez l’outil **Cercle**, cliquez près du coin de la plaque (vers x = 15, y = 15), puis tapez **6** (le diamètre) et **Entrée**.',
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
      'Choisissez l’outil **Cote**. Cliquez le **centre du cercle**, puis l’**origine** : choisissez « **Horizontale** », tapez **15**, Entrée.',
      'Recommencez pour la cote « **Verticale** » : **15**. Quand tout est vert, le trou est bien placé.',
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
    body: ['Cliquez sur **Terminer l’esquisse**.'],
    check: (s) => s.mode.kind !== 'sketch' && sketches(s).some((f) => f.params.support.kind === 'face' && hasHoleCircle(f.params)),
  },
  {
    id: 'pocket',
    title: '9. Percer avec une poche',
    body: [
      '**Poche** : retirer de la matière en suivant le dessin. Cliquez sur **Poche** : la profondeur « **Traversante** » perce toute la plaque. L’aperçu rouge montre la matière retirée.',
      'Cliquez sur **Valider**.',
    ],
    target: 'tool-pocket',
    check: (s) => {
      const v = volume(s);
      return v !== null && (near(v, 9000 - HOLE, 0.01) || near(v, 12000 - HOLE, 0.01));
    },
  },
  {
    id: 'modify',
    title: '10. Modifier une cote : 80 mm de large',
    body: [
      'Toute **étape** reste modifiable et le modèle se recalcule. Dans l’historique à gauche, **double-cliquez sur « Esquisse 1 »**.',
      'Double-cliquez la cote **60 mm**, tapez **80**, Entrée, puis **Terminer l’esquisse** : la plaque s’allonge et le trou reste à 15 mm de l’origine.',
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
      'Cliquez sur **Fichier → Enregistrer** (ou Ctrl+S). Pour garder une copie sur l’ordinateur : **Enregistrer sous…**.',
      'Pour ouvrir la pièce dans **FreeCAD** : **Fichier → Exporter…**, format **STEP**. La pièce est terminée.',
    ],
    check: (s) => s.project.savedRevision === s.revision && s.project.savedAt !== null,
  },
];
