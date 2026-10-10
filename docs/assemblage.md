# Assemblage (conception)

Objectif : assembler très simplement les pièces d'un projet, et les faire bouger, dans un onglet
à part. Pas de solveur de mécanismes général : une **arborescence de liaisons** à partir d'une
pièce fixe, chaque liaison ayant au plus deux mouvements simples.

## Ce que voit l'utilisateur

- Deux onglets en haut : **Pièces** (la modélisation actuelle) et **Assemblage**.
- Dans Assemblage, la barre d'outils propose : **Insérer une pièce**, **Liaison**, **Exporter**.
- Panneau de gauche : les pièces insérées (la première est **fixe**, marquée d'une punaise) et les
  liaisons. Panneau de droite : les réglages de la liaison choisie.

## Repères (LCS)

Un repère est posé d'un clic sur une pièce insérée ; il est mémorisé de façon persistante, comme
les esquisses sur face et les congés (jamais par un numéro de face) :

| Clic sur… | Origine du repère | Axe Z |
| --- | --- | --- |
| une face plane | centre de la face | normale sortante |
| un cercle ou un arc (bord d'un trou, d'un cylindre) | centre du cercle | axe du cercle |
| une arête droite | milieu de l'arête | direction de l'arête |

Les axes X et Y sont choisis de façon canonique (comme les repères d'esquisse) pour rester stables
quand la pièce change. Si la face ou l'arête disparaît, la liaison est signalée et l'utilisateur
choisit un nouveau repère ; la pièce garde sa dernière position.

## Liaisons

Une liaison relie le repère d'une pièce **mobile** au repère d'une pièce **de référence** (déjà
placée) : les deux repères sont superposés, axes Z opposés (les faces se touchent), puis :

| Type | Mouvement libre | Réglages |
| --- | --- | --- |
| Fixe | aucun | angle, décalage (fixes) |
| Pivot | rotation autour de l'axe | angle (curseur, limites min / max facultatives) |
| Glissière | translation le long de l'axe | décalage (curseur, limites) |
| Pivot glissant | les deux | angle et décalage |

« Retourner » inverse le sens de l'axe de la pièce mobile. Les valeurs (angle, décalage) sont
enregistrées dans le projet et entrent dans Annuler / Rétablir.

Création en trois gestes : outil **Liaison** → clic sur la pièce qui bouge (repère) → clic sur
la pièce de référence (repère) → choix du type dans le panneau (Pivot par défaut si les deux
repères sont des cercles, Fixe sinon).

## Faire bouger

- **Curseurs** : pour la liaison sélectionnée, un curseur par mouvement libre (angle en degrés,
  décalage en mm), avec le champ numérique ▲▼ habituel pour une valeur exacte.
- **À la souris** : on attrape la pièce mobile et on la fait glisser ; elle ne suit que le
  mouvement permis par sa liaison (rotation autour de l'axe, ou translation le long de l'axe),
  dans les limites. On ne peut donc pas « casser » l'assemblage.

## Calcul et données

- Le placement est un calcul simple de matrices (pas de solveur itératif) : chaque pièce est
  placée par sa liaison à partir de la pièce de référence, depuis la pièce fixe.
- Les repères sont calculés à partir du maillage des pièces (centre de face, cercle, arête), déjà
  présent dans l'interface ; l'export STEP / 3MF de l'assemblage applique les mêmes placements aux
  solides exacts dans le worker.
- Format natif : champ facultatif `assembly` du document (`instances`, `joints`) ; les anciens
  projets s'ouvrent sans changement.

## Hors périmètre (pour l'instant)

Boucles de liaisons (une pièce tenue par deux liaisons), collisions, engrenages, cinématique
automatique, liaisons sphériques. Ces cas sont signalés clairement au lieu d'être calculés à moitié.
