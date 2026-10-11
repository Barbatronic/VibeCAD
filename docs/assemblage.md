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
| une sphère (boule) | centre de la sphère | axe Z de la pièce ; la liaison créée est une **rotule** |
| un coin d'une face plane : survoler la face, **maintenir Maj** (la face est verrouillée, hachurée), viser le coin puis cliquer | le sommet | normale de la face |

Pendant la création d'une liaison, le repère qui servira d'accroche est montré sous la souris avec
une étiquette (pièce qui bouge, puis pièce de référence) ; l'élément déjà choisi reste en
surbrillance.

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
| Rotule | rotation dans tous les sens autour du point d'accroche | angle (autour de l'axe), inclinaison et direction de l'inclinaison (curseurs, inclinaison maximale facultative) |

Chaque type a son icône et une explication avec un exemple de la vie courante (roue, tiroir,
lampe de bureau…), affichée sous les boutons et au survol.

**Collisions** (barre d'outils de l'assemblage) : activé, chaque paire de pièces placées est
vérifiée (partie commune calculée par le moteur) après chaque changement. Les pièces qui se
rentrent dedans sont listées avec le volume en commun, et ce volume s'affiche en rouge dans la vue,
à travers les pièces. Un simple contact (pièces posées l'une sur l'autre, goupille ajustée dans son
trou) n'est pas une collision.

**Outil Main** (barre d'outils de l'assemblage) : activé, on attrape une pièce tenue par une
liaison et elle suit la souris en ne faisant que le mouvement permis (tourner, glisser ; Maj pour
glisser un pivot glissant ; une rotule penche comme un levier, le point attrapé suivant la souris
autour de la rotule). Désactivé, glisser fait seulement tourner la vue. Un geste = une action
d'Annuler.

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

- Placement en arbre : chaque pièce est placée par la première liaison qui la tient, à partir de
  sa pièce de référence, depuis la pièce fixe (calcul direct de matrices).
- **Boucles fermées** (quadrilatère articulé, parallélogramme, bielle-manivelle) : une liaison de
  plus vers une pièce déjà tenue — ou vers la pièce fixe — referme une boucle. Elle devient une
  contrainte de fermeture (pivot : même point et même axe ; rotule : même point ; glissière,
  pivot glissant, fixe : selon ce qu'ils imposent). Un solveur de Levenberg-Marquardt ajuste les
  réglages libres (angles, décalages, inclinaisons) des liaisons de l'arbre, au plus près de leurs
  valeurs enregistrées ; la liaison que l'on manipule (curseur, outil Main) garde sa valeur et les
  autres suivent. Les réglages recalculés sont reportés dans le projet, pour que le mouvement reste
  continu. Une boucle impossible (pièces trop courtes ou bloquées) est signalée sur sa liaison
  (`LOOP_UNSOLVED`) et les pièces restent à leurs réglages enregistrés. Lors de la création d'une
  liaison, si la première pièce choisie est déjà tenue et pas la seconde, les rôles sont échangés.
- Les repères sont calculés à partir du maillage des pièces (centre de face, cercle, arête), déjà
  présent dans l'interface ; l'export 3MF de l'assemblage applique les mêmes placements aux
  solides exacts dans le worker. L'export STEP garde l'**arborescence** : un assemblage au nom du
  projet, une définition par pièce (nom, couleur) et une instance placée par pièce insérée (une
  pièce insérée plusieurs fois n'est écrite qu'une fois) ; FreeCAD et les autres logiciels de CAO
  retrouvent l'assemblage et ses pièces.
- Format natif : champ facultatif `assembly` du document (`instances`, `joints`) ; les anciens
  projets s'ouvrent sans changement.

## Hors périmètre (pour l'instant)

Engrenages, ressorts, efforts et vitesses (cinématique automatique), limites de course prises en
compte par le solveur de boucles. Les boucles impossibles sont signalées clairement au lieu d'être
calculées à moitié.
