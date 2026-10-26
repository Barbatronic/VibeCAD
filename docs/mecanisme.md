# Couple sur une liaison (étude « Mécanisme »)

L'étude de déformation de l'atelier Simulation répond à « la pièce tient-elle ? ». L'étude
**Mécanisme** répond à une autre question : quel **couple** (pivot) ou quelle **force**
(glissière) faut-il sur la liaison motrice pour faire bouger l'assemblage, et quel moteur choisir ?

## Utilisation

1. Atelier **Simulation**, panneau de gauche : **Mécanisme : couple sur une liaison** (proposé dès
   que l'assemblage a une liaison pivot, glissière ou pivot glissant).
2. Panneau de droite :
   - **Liaison motrice** : celle que le moteur entraîne ;
   - **De … à …** : la plage parcourue (par défaut les limites de la liaison, sinon un tour pour
     un pivot, ±50 mm pour une glissière) ;
   - **Frottement** (N·m ou N), constant, toujours contre le mouvement ;
   - **Accélération** voulue (rad/s² ou m/s²), 0 pour un mouvement lent ;
   - **Sécurité** : coefficient multiplicateur (2 par défaut).
3. **Calculer** : la courbe du couple sur toute la plage, le couple à fournir, la position du pic
   et son sens (le moteur soulève, ou retient le poids), la masse en mouvement, puis la liste des
   moteurs courants (micro-servos, MG996R, moteurs pas à pas NEMA 17 et 23) avec « suffit » ou
   « trop faible ». **Survoler la courbe** montre l'assemblage à cette position.

Les réglages sont enregistrés dans le projet ; un changement du projet ou des réglages signale le
résultat comme périmé.

## Méthode

- **Poids** : chaque pièce compte pour sa masse (volume × masse volumique de sa matière, voir
  Propriétés) placée en son centre de gravité. Pour chaque position q de la liaison motrice, le
  solveur d'assemblage place les pièces (boucles fermées, engrenages et crémaillères compris) ;
  le couple vaut la dérivée de l'énergie potentielle, dU/dq, calculée par différence centrée
  (±0,25° ou ±0,1 mm). Positif : il faut pousser dans le sens des valeurs croissantes.
- **Accélération** : + J(q) × α, avec l'inertie équivalente J = Σ m |dp/dq|² (masses ramenées à
  leur centre de gravité), ajoutée dans le sens du pic.
- **À fournir** = (pic + frottement) × sécurité. Un réducteur (engrenages, poulies) divise le
  couple demandé au moteur par son rapport.

Code : `src/app/mechanism.ts` (calcul, moteurs courants), `src/ui/MechanismUi.tsx` (panneau et
courbe). Format natif : champ facultatif `simulation.mechanism` (`jointId`, `from`, `to`,
`friction`, `acceleration`, `safety`).

## Limites

- Calcul quasi statique : pas de terme de vitesse (forces centrifuges), pas de chocs.
- Pièces pleines ; la visserie n'est pas comptée ; l'inertie propre de chaque pièce autour de son
  centre de gravité est négligée (pièces longues en rotation rapide : prendre de la marge).
- Pas encore de charges extérieures (masse portée, ressort) ni de frottement calculé par liaison.

## Validation

`tests/geometry/mechanism.test.ts` : bras de 50 mm en pivot sur un axe horizontal, centre de
gravité à 20 mm de l'axe ; pic = m g r, nul un quart de tour plus loin, opposé à l'opposé ;
accélération (+ m r² α), frottement et sécurité. `tests/e2e/mechanism.spec.ts` : dans
l'application, étude choisie, couple à fournir conforme, moteurs comparés, bras montré à la
position survolée, résultat périmé après un réglage.
