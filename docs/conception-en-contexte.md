# Conception en contexte d'assemblage

Modifier une pièce **à sa place dans l'assemblage**, entourée des pièces voisines, et s'appuyer
sur elles : par exemple poser l'esquisse des trous de fixation d'une platine sur la face du
moteur qu'elle porte. Complète les [références entre pièces](references-entre-pieces.md), qui
travaillent dans le repère commun de l'onglet Pièces, sans les positions de l'assemblage.

## Utilisation

- **Entrer** : onglet Assemblage, sur une pièce insérée, bouton « Modifier dans l'assemblage »
  (panneau de droite) ou icône crayon de la liste des pièces insérées. On passe dans l'onglet
  Pièces, sur cette pièce ; un bandeau le rappelle.
- **Vue** : la pièce modifiée à l'origine, comme d'habitude, et les autres pièces de l'assemblage
  autour d'elle, atténuées, à leur place relative. Les pièces du projet qui ne sont pas dans
  l'assemblage sont masquées.
- **S'appuyer sur une voisine** : outil Esquisse puis clic sur une face plane d'une voisine, ou
  double-clic sur cette face. L'esquisse appartient à la pièce modifiée ; elle est posée sur la
  face de la voisine telle qu'elle est placée dans l'assemblage, et suit cette voisine quand elle
  change (cote, étape).
- **Sortir** : « Revenir à l'assemblage » dans le bandeau (ou l'onglet Assemblage) ; choisir une
  autre pièce dans la liste quitte aussi le contexte.

## Position de référence

Les positions viennent de la **position de référence** de l'assemblage : toutes les liaisons à
zéro (angle et décalage), pas la position du moment. Animer le mécanisme ou régler une liaison ne
déplace donc pas une esquisse posée sur une voisine.

## Fonctionnement

- Format natif : la face d'appui (`support`) d'une esquisse posée sur une voisine porte, en plus
  de `partId`, un champ facultatif `context` : `instanceId` (insertion de la pièce modifiée),
  `otherInstanceId` (clé de la voisine dans l'assemblage déplié, « in-4/in-2 » pour une pièce de
  bloc), `matrix` (matrice 4 × 4 en colonnes qui place la voisine dans le repère de la pièce
  modifiée) et `frozen` (lien figé). Même champ possible sur une arête reprise (`reference`).
- Calcul (`src/features/engine.ts`) : la forme finale de la voisine est déplacée par `matrix`
  (étiquettes de faces gardées) avant d'y chercher la face ou l'arête ; la copie déplacée est
  libérée après l'étape. La matrice fait partie de la clé de cache de l'étape.
- Application (`src/app/assembly-context.ts`) : assemblage en position de référence
  (`referenceAssembly`), pièces voisines placées dans le repère de la pièce modifiée
  (`contextLeaves`) ; la vue les affiche sous la clé `ctx:<clé>`.

## Validation

`tests/geometry/cross-part.test.ts` (face et arête d'une voisine placées par la matrice, format
relu à l'identique et conforme au schéma, matrice incomplète refusée),
`tests/e2e/assembly-context.spec.ts` (dans l'application : entrée depuis l'assemblage, vue avec
la voisine placée, esquisse posée sur la plaque voisine, extrusion à la bonne hauteur, retour).

## Reste à faire

- Projeter les arêtes d'une voisine dans une esquisse (outil Projeter) en contexte.
- Recalculer `matrix` quand l'assemblage change (liaison ajoutée ou modifiée, pièce déplacée),
  sauf pour un lien figé ; signaler une insertion disparue.
- Afficher dans l'historique qu'une esquisse s'appuie sur une voisine « dans l'assemblage », et
  proposer de figer ou de libérer le lien.
