# Simulation

Onglet « Simulation » (niveau Intermédiaire) : montrer comment une pièce se déforme et où elle
risque de casser, sous une charge simple. Le résultat est **indicatif** et pédagogique : une pièce
imprimée dépend aussi du remplissage et du sens des couches.

## Utilisation

1. Choisir la **pièce étudiée** (panneau de gauche) et son **matériau** (panneau de droite).
2. **Faces fixées** : cliquer les faces où la pièce est tenue (vissée, collée, posée). Un second
   clic retire une face ; Échap termine.
3. **Charge** : cliquer les faces où l'on appuie, puis indiquer une **masse posée** (kg, son poids
   tire vers le bas, −Z) ou une **force** (N) et son sens : « appuie sur la face » (vers
   l'intérieur de la pièce) ou un axe du repère. Une face est fixée ou chargée, pas les deux.
4. **Calculer** : la pièce apparaît déformée (exagérée, pour que la déformation se voie) et colorée
   du bleu (peu sollicitée) au rouge (très sollicitée), en contrainte ou en déplacement. Le
   **verdict** compare la contrainte maximale à la résistance du matériau :
   « La pièce tient » (marge ≥ 2), « C'est juste » (1 à 2), « Risque de casser » (< 1).
   **Animer** fait aller et venir la pièce entre sa forme de départ et la déformée (aller-retour
   de 1,6 s), pour voir dans quel sens elle plie ; l'animation est coupée si le système demande
   moins d'animations (réglage d'accessibilité).

Quand le plus grand déplacement dépasse 5 % de la taille de la pièce, un avertissement rappelle
que le calcul suppose de petites déformations : la forme réelle sera différente (c'est le cas
courant d'une pièce souple en TPU, qui plie beaucoup sans casser).

La précision (Rapide, Normale, Fine) règle le nombre de cubes : environ 3 000, 8 000 ou 20 000.
Les réglages sont enregistrés dans le projet (champ `simulation` du format natif, annulables) ;
le résultat ne l'est pas : il se recalcule. Si les réglages ou la pièce changent, le résultat est
signalé comme périmé.

| Matériau | E (MPa) | ν | Résistance retenue (MPa) |
| --- | --- | --- | --- |
| PLA imprimé | 3 000 | 0,36 | 30 |
| PETG imprimé | 2 000 | 0,38 | 30 |
| ABS imprimé | 1 900 | 0,35 | 25 |
| TPU imprimé (souple) | 30 | 0,45 | 20 |
| Contreplaqué | 6 000 | 0,3 | 25 |
| Acrylique (PMMA) | 3 000 | 0,37 | 35 |
| Aluminium | 69 000 | 0,33 | 150 |
| Acier | 200 000 | 0,3 | 250 |

Les résistances des plastiques imprimés sont prudentes (couches, remplissage). L'acrylique est
cassant (il casse sans plier) et les bords découpés au laser ont des micro-fissures : sa
résistance retenue est bien inférieure aux 60 à 70 MPa des fiches techniques.

## Méthode

- **Cubes (voxels)** : la pièce est découpée en cubes réguliers d'arête `h` (`src/sim/voxelize.ts`) ;
  un cube est plein si son centre est dans la pièce (rayons parallèles à x et parité des
  traversées du maillage fermé). Robuste sur toute forme, y compris un STL importé. La taille `h`
  vise le nombre de cubes de la précision choisie, et la plus petite dimension de la pièce (souvent
  son épaisseur) compte un nombre entier de cubes : sinon la grille l'épaissirait d'un demi-cube et
  la pièce paraîtrait trop raide (`gridFor`, `src/sim/study.ts`).
- **Éléments finis** (`src/sim/fea.ts`) : élasticité linéaire, petits déplacements ; chaque cube
  est un hexaèdre à 8 nœuds avec **modes incompatibles** (Wilson-Taylor) condensés, sans lesquels
  ces cubes seraient environ 30 % trop raides en flexion. Tous les cubes étant identiques, la
  raideur élémentaire (24 × 24) est calculée une fois.
- **Résolution** sans matrice globale : gradient conjugué préconditionné par la diagonale ;
  contraintes de von Mises au centre de chaque cube.
- **Conditions aux limites** : nœuds de surface (touchant un cube vide) à moins de 0,75 `h` d'une
  face cliquée — bloqués (encastrement) ou chargés (force totale répartie également).
- **Affichage** : le maillage de la pièce est subdivisé (arêtes ≤ 1,5 `h`, découpe conforme, sans
  fente) ; chaque sommet reçoit le déplacement interpolé dans le cube plein le plus proche et la
  contrainte moyenne des cubes voisins. L'exagération porte le plus grand déplacement à environ
  8 % de la taille de la pièce.
- Le calcul tourne dans un **worker dédié** (`src/workers/sim.worker.ts`) : l'interface et le
  worker géométrique restent disponibles ; « Annuler » arrête le worker.

## Validation

`tests/unit/fea.test.ts` — poutre 100 × 10 × 10 mm (E = 3 500 MPa, ν = 0,35), encastrée à une
extrémité :

| Cas | Théorie | Calcul (cubes de 2,5 / 1,25 / 0,625 mm) |
| --- | --- | --- |
| Traction 1 000 N : allongement F·L / (E·S) | 0,286 mm | à moins de 3 % |
| Flexion 10 N : flèche F·L³ / (3·E·I) | 1,143 mm | 99,5 % / 99,7 % / 99,8 % |
| Contrainte à l'encastrement M·c / I | 6 MPa | 4,4 / 5,1 / 5,9 MPa (au centre des cubes) |

`tests/unit/sim-study.test.ts` — même poutre par l'étude complète (3 000 cubes, report sur le
maillage) : flèche à ± 15 % de la théorie. `tests/e2e/simulation.spec.ts` — dans l'application,
poutre en PLA chargée de 1 kg sur le dessus : 0,497 mm affichés pour 0,49 mm attendus
(W·L³ / (8·E·I)) ; verdict « La pièce tient », puis « Risque de casser » à 100 kg.

Durée (machine de référence) : 640 cubes 0,1 s ; 5 000 cubes 1,9 s ; 41 000 cubes 29 s. Si c'est
trop lent sur un ordinateur d'école, une méthode multigrille réduira fortement le nombre
d'itérations.

## Suite prévue

- assemblages collés (pièces liées par des liaisons fixes) ;
- animation des mécanismes ;
- multigrille si le calcul est trop lent.
