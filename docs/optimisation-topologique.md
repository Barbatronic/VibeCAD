# Optimisation topologique selon le procédé de fabrication (conception)

Statut : **proposition**, à valider avant tout développement (demande du 12 octobre 2026).

## L'idée

On part d'une pièce qui « marche » (elle tient la charge dans l'onglet Simulation) et on demande
au logiciel : **où la matière est-elle vraiment utile ?** Il enlève progressivement la matière qui
ne porte presque rien, jusqu'à la masse visée, en respectant ce que la machine sait fabriquer.
Le résultat ressemble souvent à un os ou à une branche d'arbre : c'est spectaculaire et très
parlant pour des élèves, à condition de le présenter comme une **suggestion** à redessiner, pas
comme une pièce finie.

## Ce qui existe déjà et qu'on réutilise

- Les **études de simulation** : faces fixées, faces chargées, matériau (onglet Simulation). Ce
  sont exactement les données d'entrée d'une optimisation.
- Le **calcul par cubes** (voxels) et son solveur **multigrille** (`src/sim`) : une optimisation
  demande 30 à 80 calculs successifs ; le multigrille les rend possibles dans le navigateur (une
  pièce de 8 000 cubes se calcule en environ une seconde).
- La **face posée sur le plateau** (onglet Fabrication) : elle donne la direction d'impression.
- L'**import STL** (maillage → solide) pour transformer le résultat en étape de la pièce.

## Méthode proposée : densités (SIMP), adaptée aux cubes

1. Chaque cube reçoit une densité entre 0 (vide) et 1 (plein) ; sa raideur vaut densité³ × E
   (méthode SIMP, la plus éprouvée). Au départ, toute la pièce est à la densité visée.
2. À chaque tour : calcul de la déformation, puis chaque cube gagne ou perd de la densité selon
   l'énergie qu'il porte (mise à jour « critères d'optimalité »), en gardant la masse visée.
3. **Filtre de taille** : chaque densité est moyennée sur une boule de rayon r. Ce rayon impose
   l'**épaisseur minimale** des barres et parois, il vient directement du procédé (ci-dessous).
4. **Projection** en fin de calcul : les densités sont poussées vers 0 ou 1 pour obtenir une
   forme nette, puis la surface est extraite (« marching cubes ») et lissée.
5. **Zones gardées** : une fine couche autour des faces fixées et chargées reste pleine (on ne
   retire pas la matière là où l'on visse ou appuie). L'élève peut aussi désigner des faces à
   garder (portée d'un roulement, face d'appui…).

Coût estimé : 40 tours × 1 calcul ≈ 40 s à 1 min 30 pour 8 000 cubes sur un ordinateur récent, avec
une barre de progression et l'aperçu de la forme qui se dessine au fil des tours (c'est aussi le
plus pédagogique à regarder). Le calcul repart de la déformation du tour précédent, ce qui divise
le nombre d'itérations du solveur.

## Contraintes de fabrication

| Procédé | Contrainte | Traduction dans le calcul |
| --- | --- | --- |
| **Impression 3D (FDM)** | épaisseur minimale (≈ 2 largeurs de buse, 0,8 à 1,2 mm) | rayon du filtre de taille |
| | **porte-à-faux** limités (≈ 45°) : rien ne doit « flotter » au-dessus du vide | filtre « fabrication additive » couche par couche (Langelaar, 2016) : un cube ne peut être plein que s'il est porté par les cubes de la couche du dessous. Il s'écrit naturellement sur nos cubes alignés avec la direction d'impression |
| | direction d'impression | face posée sur le plateau (Fabrication), ou choisie dans l'étude |
| | pas de cavité fermée nécessaire | (non contraint en FDM ; à contraindre pour la résine) |
| **Découpe laser** | pièce plate d'épaisseur constante | contrainte d'**extrusion** : densité identique dans toute l'épaisseur (calcul en 2D dans le plan de la plaque) |
| | largeur minimale (≈ 2 × épaisseur pour le bois) | rayon du filtre |
| **Fraisage (plus tard)** | pas de contre-dépouille, rayon d'outil | filtre d'accessibilité dans une direction ; rayon minimal des creux |

## Ce que voit l'élève

1. Onglet Simulation, une étude prête (faces fixées, charge, matériau, verdict « la pièce tient »).
2. Bouton **« Alléger la pièce »** : choix du procédé (impression 3D / découpe laser), de la masse
   visée (curseur, par exemple 40 % de la masse actuelle) et de la direction d'impression.
3. La forme se creuse sous ses yeux, tour après tour ; la masse et la contrainte maximale
   s'affichent.
4. À la fin : comparaison **avant / après** (masse, flèche, verdict recalculé sur la forme obtenue).
5. Trois suites possibles :
   - **la garder comme gabarit** transparent pour redessiner une pièce propre par-dessus avec les
     outils habituels (démarche recommandée en classe : on comprend pourquoi la forme est ainsi) ;
   - **l'ajouter à la pièce** comme étape « Solide optimisé » (maillage transformé en solide, non
     paramétrique, comme un STL importé), niveau Expert ;
   - l'**exporter** (3MF, STL) pour l'imprimer telle quelle.

## Étapes de réalisation proposées

1. **Carte d'utilité de la matière** (petit pas, utile tout de suite) : dans le résultat d'une
   simulation, un affichage « énergie de déformation » qui montre la matière qui ne sert presque à
   rien. Un seul calcul, aucune nouvelle géométrie.
2. **Optimisation SIMP** sur la pièce elle-même (on ne fait qu'enlever de la matière), avec filtre
   de taille, zones gardées, aperçu progressif dans le worker de simulation.
3. **Contraintes de procédé** : impression 3D (porte-à-faux et direction), découpe laser
   (extrusion).
4. **Sortie** : surface lissée, gabarit transparent, étape « Solide optimisé », export.
5. **Validation** : nouvelle simulation automatique sur la forme obtenue ; tests de référence
   (poutre console, plaque trouée) comparés aux résultats publiés de la méthode (« 88 lignes »
   de Sigmund).

Niveau proposé : Expert (étapes 2 à 4) ; la carte d'utilité (étape 1) dès le niveau Intermédiaire.

## Limites à annoncer

- Résultat **indicatif** comme la simulation : une seule charge, matériau homogène (le remplissage
  et les couches d'une impression ne sont pas modélisés), petites déformations.
- La forme suit la grille de cubes : la précision est celle du calcul (environ 1 à 2 mm).
- Transformer un maillage organique en solide peut échouer sur une forme très découpée : on garde
  toujours le gabarit et l'export STL / 3MF.
- Pas d'optimisation de forme sur plusieurs cas de charge ni de flambage dans un premier temps.
