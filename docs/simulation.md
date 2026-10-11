# Simulation (conception)

Onglet « Simulation » (en cours) : montrer où une pièce se déforme et où elle risque de casser,
sous des efforts simples. Résultat **indicatif**, pédagogique.

## Méthode

- **Cubes (voxels)** : la pièce est découpée en cubes réguliers d'arête `h` (`src/sim/voxelize.ts`) ;
  un cube est plein si son centre est dans la pièce (rayons parallèles à x et parité des
  traversées du maillage fermé). Robuste sur toute forme, y compris un STL importé.
- **Éléments finis** (`src/sim/fea.ts`) : élasticité linéaire, petits déplacements ; chaque cube
  est un hexaèdre à 8 nœuds avec **modes incompatibles** (Wilson-Taylor) condensés, sans lesquels
  ces cubes seraient environ 30 % trop raides en flexion. Tous les cubes étant identiques, la
  raideur élémentaire (24 × 24) est calculée une fois.
- **Résolution** sans matrice globale : gradient conjugué préconditionné par la diagonale ;
  contraintes de von Mises au centre de chaque cube.
- **Conditions aux limites** : nœuds à moins d'une tolérance d'une face cliquée
  (`nodesNearTriangles`) — bloqués (encastrement) ou chargés (force répartie).

## Validation (`tests/unit/fea.test.ts`)

Poutre 100 × 10 × 10 mm en PLA (E = 3 500 MPa, ν = 0,35), encastrée à une extrémité :

| Cas | Théorie | Calcul (cubes de 2,5 / 1,25 / 0,625 mm) |
| --- | --- | --- |
| Traction 1 000 N : allongement F·L / (E·S) | 0,286 mm | à moins de 3 % |
| Flexion 10 N : flèche F·L³ / (3·E·I) | 1,143 mm | 99,5 % / 99,7 % / 99,8 % |
| Contrainte à l'encastrement M·c / I | 6 MPa | 4,4 / 5,1 / 5,9 MPa (au centre des cubes) |

Durée (machine de référence) : 640 cubes 0,1 s ; 5 000 cubes 1,9 s ; 41 000 cubes 29 s. Le calcul
tournera dans le worker ; si c'est trop lent sur un ordinateur d'école, une méthode multigrille
réduira fortement le nombre d'itérations.
