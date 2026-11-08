# Matières, procédés et gravure : conception

Document de travail (novembre 2026) : la refonte des matières et de l'atelier Fabrication, avant
son développement. Il fixe les décisions prises avec l'utilisateur et découpe le travail en lots.

## Constat

Une même information est aujourd'hui éclatée en quatre endroits qui ne se parlent pas :

| Où | Quoi | Sert à |
| --- | --- | --- |
| `Part.color` | couleur de la pièce | affichage, export STEP |
| `Part.material` (`domain/part-material.ts`) | PLA, PETG, contreplaqué… | masse, simulation (`sim/materials.ts`) |
| `fabrication.laser.materials` | plaques : nom, épaisseur, format, trait de coupe | découpe laser |
| `fabrication.print.filaments` + `Part.paint` (non commité) | 4 couleurs, filament par face | impression multicouleur |

La plupart des logiciels de CAO donnent une matière unique à une pièce, comme si elle était
toujours usinée. En pratique, ce qui compte est **la façon dont la pièce sera fabriquée** : le
procédé et la matière définissent ensemble les réglages, dont l'apparence.

## Décisions

1. **Une matière se choisit dans un catalogue réutilisable** d'un projet à l'autre.
2. **L'atelier Fabrication décide comment chaque pièce est fabriquée**, avant toute préparation
   (plateaux, plaques). L'atelier Pièces n'est pas chargé de ces réglages.
3. **Une seule nouveauté dans l'atelier Pièces : l'opération Gravure.** Elle désigne une zone à
   graver au laser, ou à imprimer dans une autre couleur.
4. **Le rendu « matières réelles » est visible dans tous les ateliers**, pour voir l'objet assemblé
   tel qu'il sera fabriqué.
5. **La peinture multicolore attend la refonte** : elle n'est pas publiée dans sa forme actuelle
   (numéros de filament de 1 à 4), mais sert de base au lot 3.

## Modèle

### Fiche matière

Une fiche décrit une matière telle qu'on l'achète :

| Champ | Exemple | Rôle |
| --- | --- | --- |
| `id`, `name` | « PLA blanc », « PMMA rouge 3 mm » | affichage, choix |
| `base` | `pla`, `acrylic`… (identifiants actuels) | masse volumique, simulation |
| `process` | `print` (impression 3D), `laser`, plus tard `machining`, `bought` | réglages et préparation |
| `color`, `appearance` | `#d8423a`, opacité, aspect mat ou brillant | rendu |
| `sheet` (laser) | épaisseur, format de plaque, trait de coupe | découpe |
| `brand`, `note` (facultatifs) | marque, référence | rappel |

Les bases (masse volumique, raideur, résistance) réunissent `PART_MATERIALS` et `SIM_MATERIALS`,
qui ont déjà les mêmes identifiants.

### Catalogue

- **Fiches de départ** livrées avec VibeCAD : les bases actuelles en quelques couleurs courantes,
  et les plaques laser habituelles.
- **Catalogue personnel**, retenu sur l'appareil (IndexedDB, comme les préférences) : ses propres
  fiches (« mon PLA blanc Bambu »). Export et import d'un fichier JSON pour le passer à un autre
  appareil.
- Plus tard : des **bibliothèques de matières** sur GitHub, sur le modèle des bibliothèques de
  composants.

### Projet

- `doc.materials` : **une copie** des fiches utilisées. Le projet reste complet sans le catalogue
  de l'appareil, comme les tampons qui portent leur contour. Une fiche modifiée dans le catalogue
  ne change pas les projets d'elle-même : un bouton propose la mise à jour.
- `Part.color` reste la **couleur de conception**, pratique pour distinguer les pièces en dessinant.

### Pièce

- `Part.make` : la fiche matière de la pièce (identifiant dans `doc.materials`). Elle remplace
  `Part.material` (masse, simulation) et le choix de plaque des pièces laser.
- Impression 3D : faces peintes avec **d'autres fiches du même procédé** (`{ ref, material }`), et
  non plus un numéro de filament. Les références de faces sont celles de la peinture actuelle
  (étape + rôle), qui survivent aux modifications.

### Opération Gravure (atelier Pièces)

Une étape de l'historique, sur le modèle de la poche :

- une **esquisse** (texte, tampon, dessin vectorisé, contour) posée sur une face ;
- une **profondeur** : 0 pour un simple marquage de surface, sinon un creux réel ;
- les faces créées portent le rôle `engrave`, ce qui permet de les reconnaître partout ensuite.

Son effet dépend du procédé de la pièce :

| Procédé | Effet |
| --- | --- |
| Découpe laser | les contours gravés partent sur le **calque de gravure** (bleu) du SVG ou DXF, la découpe sur le calque rouge |
| Impression 3D | la zone prend une **autre fiche matière** (couleur), choisie dans l'opération ; avec profondeur, la couleur remplit le creux |

## Affichage

Un réglage du menu Affichage, **« Couleurs : conception / matières »**, valable dans les ateliers
Pièces, Assemblage, Fabrication (et Simulation pour la géométrie). En mode matières : couleur et
aspect de la fiche (acrylique un peu transparent), faces peintes et gravures visibles. Le choix est
retenu sur l'appareil, comme le mode d'affichage actuel.

## Atelier Fabrication repensé

Sous-onglets, dans l'ordre du travail :

1. **Matières** (nouveau, premier) : la liste des pièces avec leur fiche matière ; le catalogue
   (choisir, créer, importer) ; pour une pièce imprimée, le pinceau multicolore. C'est ici qu'on
   décide comment chaque pièce est fabriquée.
2. **Impression 3D** : plateaux, comme aujourd'hui, plus l'**association des fiches aux emplacements
   de l'AMS**. Les numéros 1 à 4 n'apparaissent qu'ici. Avertissement si un plateau demande plus de
   matières que d'emplacements. N'y figurent que les pièces imprimées.
3. **Découpe laser** : une plaque par fiche, gravures comprises. N'y figurent que les pièces
   découpées.
4. **Documents** : mise en plan, gabarits, nomenclature, qui gagne la matière de chaque pièce.

## Exports

- **3MF** : filament de chaque triangle d'après l'association AMS (déjà au point : `paint_color` et
  `slic3rpe:mmu_segmentation`, relus par OrcaSlicer).
- **SVG / DXF** : découpe et gravure sur leurs calques, d'après l'opération Gravure.
- **STEP** : la couleur affichée selon le réglage, et le nom de la matière dans la nomenclature.

## Format

Le schéma 1 permet d'**ajouter** des champs facultatifs (voir format-natif.md, « Stabilité du
format ») : la refonte reste donc dans le schéma 1, sans migration.

- `document.materials` : les fiches du projet ; `part.make` : la fiche de la pièce.
- `part.material` **reste écrit** et vaut la base de la fiche : une version plus ancienne de
  VibeCAD ouvre le projet avec la bonne masse et le bon matériau de simulation (elle signale
  seulement des informations ignorées).
- Les plaques laser (`fabrication.laser.materials`) rejoindront les fiches au lot 2, de la même
  façon : en ajoutant, sans retirer ce que les versions précédentes lisent.

## Lots

| Lot | Contenu | Critère d'acceptation |
| --- | --- | --- |
| 1 (fait) | Fiches, catalogue (départ + appareil, import / export), `doc.materials`, `Part.make`, sous-onglet Matières, Propriétés qui renvoient à Fabrication, réglage d'affichage dans tous les ateliers | un projet existant s'ouvre avec les mêmes masses ; une pièce passée en acrylique transparent se voit translucide dans tous les ateliers |
| 2 | Impression 3D et découpe laser filtrées par procédé, association AMS | un plateau ne montre que les pièces imprimées ; le 3MF suit l'association |
| 3 | Pinceau multicolore sur les fiches (reprise de la peinture actuelle) | relu par OrcaSlicer avec le bon nombre de filaments |
| 4 | Opération Gravure, effet laser | le SVG d'une plaque gravée a un calque gravure |
| 5 | Gravure en impression 3D (couleur, creux) | la zone gravée sort dans sa couleur dans le 3MF |
| 6 | Aspects plus fins, usinage, bibliothèques de matières GitHub | à préciser |

## Questions tranchées

- Une pièce peut avoir **un procédé différent selon les projets** : oui, la fiche se choisit par
  projet.
- Pièces **achetées** (vis, roulements des bibliothèques) : oui, une fiche de procédé « achetée »,
  sans préparation, pour le rendu et la nomenclature.
