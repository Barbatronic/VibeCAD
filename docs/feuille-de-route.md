# Feuille de route

Chantiers décidés mais pas encore commencés, dans l'ordre où ils ont été retenus. Chaque entrée
résume le besoin, la proposition et les points à trancher au démarrage.

## 1. Conception en contexte d'assemblage

**Besoin.** Dessiner ou modifier une pièce à sa place dans l'assemblage, en s'appuyant sur les
pièces voisines (les trous de fixation d'une platine repris sur ceux du moteur, par exemple).
Aujourd'hui, une esquisse peut s'appuyer sur une autre pièce seulement dans le repère commun de
l'atelier Pièces ([références entre pièces](references-entre-pieces.md)) ; les positions de
l'assemblage (liaisons) n'y sont pas prises en compte.

**Proposition.**

1. « Modifier dans l'assemblage » sur une pièce insérée : on reste dans la vue de l'assemblage,
   les autres pièces deviennent transparentes ; esquisses et opérations se font sur la pièce, à
   sa place.
2. Références à travers l'assemblage : esquisse sur la face d'une pièce voisine, projection de ses
   arêtes, en tenant compte de la position des deux pièces dans l'assemblage. Si la position
   change, la référence suit.
3. Garde-fous : boucles de dépendance signalées (une pièce qui dépend d'une pièce qui dépend
   d'elle), possibilité de figer une référence (couper le lien).

**Avancement.** Livré : entrée « Modifier dans l'assemblage », vue de la pièce entourée de ses
voisines, esquisse posée sur la face d'une voisine à sa place (position de référence : liaisons à
zéro), format et calcul. Reste : projection d'arêtes en contexte, mise à jour des positions quand
l'assemblage change, lien figé et indication dans l'historique. Détails :
[conception en contexte](conception-en-contexte.md).

## 2. Couple nécessaire sur une liaison (simulation de mécanisme)

**Besoin.** L'atelier Simulation donne la déformation d'une pièce sous une charge. Dans un
mécanisme, la question fréquente est autre : quel couple faut-il sur un pivot (ou quelle force
sur une glissière) pour faire bouger le système, et quel moteur choisir ?

**Proposition.** Une étude « Mécanisme » dans l'atelier Simulation (ou Assemblage) :

- choisir la **liaison motrice** (pivot : couple en N·m ; glissière : force en N) et sa plage de
  mouvement ;
- charges prises en compte : **poids** des pièces (masse et centre de gravité, déjà calculés à
  partir de la matière de chaque pièce, voir Propriétés), **charges extérieures** posées sur des
  faces (masse, force), **frottement** forfaitaire par liaison, et en option l'**accélération**
  voulue (inertie des pièces) ;
- calcul quasi statique par les **travaux virtuels** : pour un petit mouvement de la liaison
  motrice, le solveur d'assemblage donne le déplacement de chaque pièce ; le couple est le travail
  des charges divisé par l'angle (engrenages et crémaillères compris, via les couplages) ;
- résultat : **courbe du couple en fonction de la position** sur toute la plage, couple maximal et
  position du maximum, sens (le mécanisme retient-il ou faut-il le freiner ?), avec un coefficient
  de sécurité ; comparaison avec des moteurs courants (NEMA 17 et 23, servomoteurs de modélisme,
  ceux des bibliothèques de composants).

**À trancher.** Inertie : moments d'inertie des pièces (calculables par le noyau) ou
approximation par masses ponctuelles au centre de gravité pour la première version ; frottement :
valeur par défaut et réglage par liaison.
