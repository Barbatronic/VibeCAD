# 0005 — Références persistantes de faces et d'arêtes

## Décision

Une esquisse sur une face enregistre une **référence sémantique** (`featureId` + rôle `start`,
`end`, `side` + élément d'esquisse, ou `imported` + rang), jamais un numéro de face ou de
triangle. L'adaptateur OCCT étiquette les faces à leur création et propage les étiquettes à
travers les booléens par l'historique d'OCCT. Le repère de l'esquisse est canonique (projection
de l'origine, axes des vues standard).

## Comportement en cas de perte

Face disparue, non plane ou ambiguë → erreur explicite sur l'esquisse et réparation par choix
d'un nouveau support ; aucun choix silencieux d'une autre face.

## Limites

- Les arêtes (congés, chanfreins) sont référencées par la paire d'étiquettes de leurs deux faces
  voisines (ajout de la version 0.1, sans changement de schéma : `EdgeRef` et le rôle `blend`
  font partie du schéma 1). Deux arêtes disjointes entre les deux mêmes faces sont traitées
  ensemble ; c'est le cas rare d'une face coupée en deux par une rainure.
- La référence `side` est liée à l'identifiant de l'élément d'esquisse : supprimer puis redessiner
  le segment crée un nouvel identifiant et provoque, à juste titre, une demande de réparation.
