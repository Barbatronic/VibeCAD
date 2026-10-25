# Bibliothèques de composants

Roulements, moteurs pas à pas, poulies, accouplements… : des composants prêts à l'emploi, rangés
dans des **bibliothèques** (des dépôts GitHub) et insérés depuis VibeCAD en un clic, dans une pièce
ou dans un assemblage.

## Utilisation

- **Ouvrir la fenêtre « Composants »** : bouton à côté du « + » de la section Pièces, menu Fichier
  (logo) → Composants, ou, dans l'atelier Assemblage, Insérer ▾ → Composant d'une bibliothèque.
- À gauche, les **collections** de chaque bibliothèque (Roulements, Moteurs…) ; en haut, une
  **recherche** (nom, description, mots-clés, sans tenir compte des accents) ; au centre, les
  vignettes avec l'encombrement, la matière et la masse.
- **Un clic insère le composant** :
  - atelier Pièces : il devient une nouvelle pièce du projet, avec son **historique complet**
    (esquisses cotées, extrusions, chanfreins…) et sa matière : il se modifie comme une pièce
    dessinée dans VibeCAD ;
  - atelier Assemblage : la pièce est ajoutée au projet, puis insérée dans l'assemblage.
  - Un second exemplaire est numéroté (« Roulement 608-2RS (2) »).
  - Un composant livré seulement en STEP passe par la fenêtre d'import (solide exact, sans
    historique).
- **Préférences → Bibliothèques de composants** : la liste, ajouter l'adresse d'un dépôt
  (`https://github.com/compte/dépôt`, ou `…/tree/branche/dossier`, ou un dossier web contenant
  `index.json`), retirer. La liste est retenue sur l'appareil. Par défaut :
  [Barbatronic/VibeCAD-Components](https://github.com/Barbatronic/VibeCAD-Components).

## Organisation d'une bibliothèque

```
library.json              nom, description, licence de la bibliothèque
index.json                catalogue complet (généré), le seul fichier lu à l'ouverture
bearings/                 un dossier = une collection
  collection.json         nom et description de la collection (facultatif)
  608-2rs.vibecad         composant paramétrique (projet VibeCAD)
  608-2rs.step            le même en STEP (solide exact, pour FreeCAD et autres)
  608-2rs.png             vignette 512 × 512, fond transparent
  608-2rs.json            fiche : nom, description, mots-clés, cotes, matière, masse, encombrement
```

Un composant est l'ensemble des fichiers de même nom ; il faut au moins un `.vibecad` ou un
`.step`. `index.json` (`"format": "vibecad-library"`, `"version": 1`) reprend `library.json` et
liste les collections et leurs composants, avec les chemins de leurs fichiers ; il est construit
par `tools/build-index.mjs` du dépôt VibeCAD-Components, qui met aussi à jour le tableau du
README. Les fichiers d'un dépôt GitHub sont lus sur `raw.githubusercontent.com` (branche par
défaut) : aucun serveur à installer.

## Bibliothèque Barbatronic

Les composants Barbatronic sont construits par VibeCAD lui-même, comme le ferait un utilisateur
(définitions dans `tests/library/components.ts`) :

```bash
npm run library:build   # dans le dépôt VibeCAD, à côté du dépôt VibeCAD-Components
```

1. `tests/library/build.test.ts` calcule chaque composant (un solide, aucune erreur ; aussi lancé
   par `npm test`) puis écrit `.vibecad`, `.step` et `.json`. Les identifiants internes et les
   dates sont fixés : un fichier ne change que si le modèle change.
2. `tests/e2e/library-previews.spec.ts` ouvre chaque `.vibecad` dans VibeCAD et photographie la
   vue 3D (vue isométrique, sans grille ni esquisses, fond transparent).
3. `tools/build-index.mjs` reconstruit `index.json` et le README.

## Limites (première version)

- Pas de cache hors ligne des bibliothèques : sans réseau, la fenêtre l'indique et propose de
  réessayer.
- La provenance d'un composant (bibliothèque, version) n'est pas encore enregistrée dans le
  projet ; un composant inséré est une pièce comme une autre.
- Pas encore de composants paramétrés au choix (une taille à choisir à l'insertion) : chaque taille
  est un composant.
