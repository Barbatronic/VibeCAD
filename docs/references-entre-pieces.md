# Références entre pièces d'un même projet

Dans l'onglet Pièces, toutes les pièces partagent le même repère : une pièce peut s'appuyer sur
une autre, comme la conception « dans le contexte » de Fusion 360 ou les liens de FreeCAD.

## Utilisation

- **Esquisse posée sur la face d'une autre pièce** : choisir la pièce dans le panneau de gauche (elle
  devient active), cliquer **Esquisse**, puis une face plane de n'importe quelle pièce. L'esquisse
  appartient à la pièce active ; sa face d'appui est celle de l'autre pièce. L'historique indique
  « sur une face d'une autre pièce ». (Un double-clic sur une face, lui, crée l'esquisse dans la
  pièce de cette face.)
- **Projeter les arêtes d'une autre pièce** : dans une esquisse, l'outil **Projeter** propose aussi
  les arêtes des autres pièces visibles ; une arête reprise reste liée à sa pièce.
- **Ça suit** : si l'autre pièce change (cote, étape ajoutée), l'esquisse et ce qui en découle sont
  recalculés.
- **Pas de boucle** : une pièce ne peut pas s'appuyer sur une pièce qui s'appuie déjà sur elle
  (directement ou par d'autres) ; la face n'est alors pas proposée, et un fichier qui contiendrait
  une telle boucle affiche une erreur expliquée sur l'étape concernée.

## Fonctionnement

- Format natif : `support.partId` (face d'appui d'une autre pièce) et `reference.partId` (arête
  reprise d'une autre pièce), facultatifs. On s'appuie toujours sur la **forme finale** de l'autre
  pièce.
- Calcul (`src/features/engine.ts`) : les pièces sont calculées dans l'ordre de leurs dépendances
  (tri topologique ; ordre du projet sinon). La clé de cache d'une étape qui référence une autre
  pièce inclut la clé de la forme finale de celle-ci : toute modification de l'autre pièce
  recalcule l'étape et la suite. Les pièces prises dans une boucle sont calculées en dernier, leurs
  références en erreur (`PART_CYCLE`).
- L'export FreeCAD place les esquisses d'après leur repère calculé : une esquisse posée sur une
  autre pièce est reprise à sa place.

## Validation

`tests/geometry/cross-part.test.ts` (esquisse sur le dessus d'une autre pièce et suivi d'un
changement de hauteur, ordre de calcul quand la pièce de référence vient après, arête reprise
recalée, boucle refusée, format relu à l'identique et conforme au schéma),
`tests/e2e/cross-part.spec.ts` (dans l'application : face d'une autre pièce choisie, arête d'une
autre pièce projetée, extrusion posée sur l'autre pièce).
