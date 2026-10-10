# 0004 — Solveur de contraintes d'esquisse

## Contexte

Le cahier des charges demande coïncidence, horizontalité, verticalité et des cotes utiles
(longueur, diamètre, rayon, position depuis l'origine), avec un sous-ensemble fiable avant
d'étendre le solveur. La « solution exacte de contraintes » était un point ouvert.

## Options

- **PlaneGCS** (solveur de FreeCAD compilé en WASM) : très complet, mais un second module WASM,
  une API plus large que le besoin et une intégration plus lourde à tester.
- **Solveur maison en TypeScript** (retenu) : code court, entièrement testé, exécutable aussi
  bien dans l'interface (glisser, saisie) que dans le worker.

## Méthode

Newton à pas de norme minimale pondérée (`Δ = W⁻¹Jᵀ(JW⁻¹Jᵀ + μI)⁻¹(−r)`), recherche linéaire,
amortissement adaptatif, « polissage » jusqu'à la précision machine pour des cotes exactes ;
décomposition en composantes indépendantes ; degrés de liberté par réduction de Gauss-Jordan ;
classement des nouvelles contraintes (indépendante, redondante, conflictuelle).

## Conséquences

Extensions prévues sans changer l'architecture : point sur segment, parallélisme,
perpendicularité, égalité, tangence, arcs. Si le besoin dépasse ce cadre, PlaneGCS pourra être
branché derrière la même fonction `solveSketch`.
