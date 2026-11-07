# Navigateurs testés et limites

## Tests automatisés

Les parcours de `tests/e2e/` (plaque percée de bout en bout, modification de la largeur,
annuler / rétablir, erreur récupérable, enregistrement et rechargement, export puis import STEP
persistant, deux pièces, mode hors ligne) passent sur :

| Navigateur | Version | Commande |
| --- | --- | --- |
| Chromium (Playwright) | build 1243 (Playwright 1.63) | `npm run test:e2e` |
| Firefox (Playwright) | 155.0 | `npm run test:e2e:firefox` |

Firefox 156 est le navigateur installé sur la machine de développement ; Edge (Chromium) et
Safari récents disposent des mêmes technologies mais ne sont pas testés automatiquement pour le
moment. Les fonctions absentes de Safari (réenregistrer dans le même fichier, compression du 3MF)
ont une solution de repli ; un essai sur un vrai Mac ou iPad reste conseillé avant un usage en
classe.

## Tablette tactile

Visée : **Chrome sur Android**. Le parcours `tests/e2e/tablet.spec.ts` (Chromium, écran tactile
émulé de 1180 × 820) dessine au doigt, zoome et déplace la vue d'esquisse à deux doigts, glisse un
point, extrude, puis ouvre une esquisse sur une face par un double toucher. Il n'a pas encore été
confirmé sur une vraie tablette, ni sur iPad (Safari).

| Geste | Vue 3D | Esquisse |
| --- | --- | --- |
| Toucher | sélectionner une face, une arête | clic de l'outil (poser un point, un coin…) |
| Double toucher | esquisse sur la face touchée | comme un double-clic |
| Un doigt qui glisse | tourner autour du modèle | glisser un élément, ou tracer un cadre de sélection |
| Deux doigts pincés / écartés | zoom | zoom |
| Deux doigts qui glissent | déplacer la vue | déplacer la vue |

Dans l'esquisse, un appui n'agit qu'une fois sûr qu'il ne s'agit pas d'un geste à deux doigts : un
toucher compte au lever du doigt, un glisser dès que le doigt bouge. Un zoom ne pose donc jamais de
point par erreur. Sans souris, les repères d'accrochage (« Origine », « Axe X »…) n'apparaissent
qu'une fois le doigt posé, et la touche Alt (sans accrochage) n'a pas d'équivalent.

## Technologies requises

- **WebGL 2** (affichage 3D). Sans accélération matérielle, le rendu logiciel fonctionne mais
  plus lentement.
- **WebAssembly avec exceptions** (noyau OCCT) : Firefox ≥ 100, Chrome/Edge ≥ 95,
  Safari ≥ 15.2.
- **Workers ES** (modules dans un worker) : Firefox ≥ 114, Chrome/Edge ≥ 80, Safari ≥ 15.
- **IndexedDB** (projets, sauvegarde automatique) : en navigation privée, certains navigateurs
  l'effacent à la fermeture : utiliser « Enregistrer sous… ».
- **Service worker** (hors ligne) : uniquement en HTTPS ou sur `localhost`.

## Limites connues

- **`file://` non pris en charge** : ouvrir `index.html` par un double-clic ne fonctionne pas
  (workers et WASM interdits par les navigateurs). Utiliser `npm run dev`, `npm run preview` ou un
  hébergement HTTPS.
- **File System Access API** (réenregistrer dans le même fichier) : Chrome et Edge seulement ;
  ailleurs, « Enregistrer sous… » télécharge le fichier.
- **Pavé tactile** : deux doigts = zoom (comme la molette), pincer = zoom, Maj + glisser ou clic
  droit = déplacer la vue. Sur certains Mac, le défilement à deux doigts est rapide : le
  ralentir dans les réglages du système si besoin.
- **Une seule barre en haut** : le logo ouvre le menu Fichier (avec le nom du projet, modifiable,
  en tête du menu), puis les ateliers en icônes (Pièces, Assemblage, Fabrication, Simulation ; nom
  en infobulle), puis les outils de l'atelier, qui se compactent quand la place manque.
- **Écrans larges** (> 980 px) : la vue 3D occupe toute la fenêtre ; la barre flotte en haut à
  gauche (le menu et les ateliers restent en place d'un atelier à l'autre) et les panneaux de gauche et de droite flottent par-dessus la vue (coins arrondis, fond translucide et flouté : le modèle reste
  visible derrière). La languette sur leur bord les replie contre le côté de l'écran, ou les rouvre ; les
  réglages de droite se rouvrent d'eux-mêmes au début d'une opération. Le cadrage, le cube de
  navigation et les boutons de vue se placent dans la zone libre, sous la barre et entre les
  panneaux. Le flou
  (`backdrop-filter`) est géré par tous les navigateurs visés ; sans lui, le fond reste
  simplement translucide.
- **Écrans étroits** (< 980 px) : le panneau des pièces se replie (bouton au début de la barre) ; en
  dessous de 720 px, le panneau des paramètres s'affiche en bas. La vue d'esquisse se cadre
  dans la zone libre entre les panneaux : l'origine reste visible, même sur une tablette.
