# Sous-assemblages (conception)

Statut : **réalisé** le 17 octobre 2026 (bloc rigide, blocs du projet, niveau Expert), selon les choix ci-dessous. La variante souple et l’import depuis un autre fichier restent à faire ; l’export STEP hiérarchique est fait.

## Le besoin

Un mécanisme se construit souvent par blocs : une roue montée sur son axe avec ses deux
roulements, une pince, un bras articulé. On veut :

1. **assembler un bloc une fois**, puis l'**insérer plusieurs fois** (quatre roues identiques) ;
2. le manipuler comme **une seule pièce** dans l'assemblage principal (le poser, le relier par une
   liaison, l'écarter dans la vue éclatée) ;
3. retrouver cette **hiérarchie** dans la nomenclature et dans l'export STEP (FreeCAD affiche
   l'arbre « Robot > Roue avant gauche > Axe »).

## Ce qui existe déjà

- Un projet contient des pièces et **un** assemblage (`assembly` : pièces insérées, liaisons,
  visserie, engrenages). Le solveur place les pièces en arbre depuis la pièce fixe et referme les
  boucles.
- L'export STEP écrit déjà une arborescence (un niveau : l'assemblage et ses pièces).
- Tout ce qui lit l'assemblage (vue, collisions, exports STEP / 3MF / GLB, nomenclature des mises
  en plan, étude de simulation de l'assemblage, visserie) parcourt une liste **plate** de pièces
  insérées.

## Proposition

### Données (format natif, champs facultatifs : schéma 1 inchangé)

- `subassemblies` (document) : liste de sous-assemblages, chacun avec `id`, `name` et le même
  contenu qu'un assemblage (`instances`, `joints`, `fasteners`, `couplings`).
- Une pièce insérée peut désigner un sous-assemblage au lieu d'une pièce :
  `{ "id": "in-4", "subassemblyId": "sa-1", "name": "Roue avant gauche", "position": … }`.
- Une liaison vers un sous-assemblage inséré désigne **la pièce du bloc** où elle s'accroche :
  `{ "instanceId": "in-4", "member": "in-2", "lcs": … }` (le repère est pris sur cette pièce,
  placée dans le bloc).
- Un sous-assemblage peut en contenir d'autres (profondeur limitée, boucle interdite).

### Comportement

- **Bloc rigide** dans l'assemblage principal : ses liaisons internes gardent leurs réglages
  (comme le « sous-assemblage rigide » des logiciels de CAO). C'est simple, prévisible et cela
  suffit à la plupart des montages. La variante **souple** (une roue qui tourne encore dans son
  bloc une fois insérée) demande de fusionner les liaisons du bloc dans le solveur principal ; elle
  est possible ensuite, mais plus coûteuse (voir plus bas).
- **Création** : dans l'onglet Assemblage, un sélecteur « Assemblage : Principal ▾ » permet de
  créer un sous-assemblage, de passer de l'un à l'autre et de le modifier avec les mêmes outils
  (Insérer, Liaison, Visserie, Engrenages). « Insérer ▾ » propose ensuite les sous-assemblages en
  plus des pièces.
- **Partout ailleurs**, une seule fonction « déplie » l'assemblage en une liste plate de pièces
  placées (clé, pièce, matrice, chemin de noms) : la vue, les collisions, les exports 3MF et GLB,
  la simulation et la visserie la lisent sans autre changement. La nomenclature regroupe par bloc
  et l'export STEP écrit un niveau d'arborescence par sous-assemblage.

### Ce qu'on ne fait pas au début

- Liaisons internes encore mobiles dans un bloc inséré (variante souple).
- Sous-assemblage importé d'un autre fichier `.vibecad` : cela rejoint l'idée, en attente, de
  bibliothèque de composants.

## Travail et risques

| Étape | Contenu | Estimation |
| --- | --- | --- |
| 1 | Modèle, lecture du format, schéma, dépliage, solveur (bloc rigide, liaison vers une pièce du bloc) | 1 séance |
| 2 | Vue, collisions, exports 3MF / GLB, simulation et visserie à travers le dépliage | 1 séance |
| 3 | Interface : sélecteur d'assemblage, création, insertion, renommage, suppression protégée | 1 séance |
| 4 | Nomenclature et STEP hiérarchiques, vue éclatée par bloc, tests e2e, documentation | 1 séance |
| (5) | Variante souple : liaisons du bloc dans le solveur principal | 1 à 2 séances |

Le risque principal est l'**oubli d'un consommateur** de l'assemblage (un export ou un calcul qui
ignorerait le contenu des blocs). Le dépliage unique, ajouté en premier avec un test qui compare
chaque consommateur sur un même projet, le limite. Les autres risques sont la suppression d'une
pièce ou d'un bloc encore utilisés (refusée avec la liste des usages, comme pour les paramètres)
et les boucles entre blocs (refusées à la création et signalées à la lecture).

## Questions à trancher

1. Bloc **rigide** d'abord (recommandé), ou souple tout de suite ?
2. Sous-assemblages **dans le projet** seulement (recommandé), ou aussi importés d'un autre
   fichier (bibliothèque) ?
3. Niveau : **Expert** (recommandé, c'est une notion avancée), ou Intermédiaire ?
