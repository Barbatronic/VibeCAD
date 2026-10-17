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
| une pastille bleue : un **point seul** d'une esquisse de la pièce (outil Point), montré pendant la création d'une liaison | le point | normale de l'esquisse |

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
- **Animer le mécanisme** (panneau de la liaison) : la liaison choisie tourne (90 °/s) ou glisse
  (15 mm/s) toute seule, et les pièces qui en dépendent suivent, y compris dans une boucle fermée.
  Sans limites, un pivot fait des tours complets ; entre des limites, une glissière sans limites
  (± 20 mm) ou quand la boucle ne peut pas aller plus loin (position extrême d'un balancier), le
  mouvement repart dans l'autre sens. « Arrêter » remet les pièces exactement à leur place de
  départ, sans rien ajouter à l'historique ; une modification pendant l'animation l'arrête à la
  position atteinte.

## Vue éclatée

Le bouton « Éclater » écarte les pièces pour montrer comment elles s'emboîtent ; un curseur règle
l'écartement, « Rassembler » revient à l'assemblage. C'est un affichage : le projet, les liaisons et
l'historique ne changent pas. Chaque pièce tenue par une liaison s'écarte de sa pièce de référence
le long de l'axe de la liaison (la normale du repère de référence : une goupille sort de son trou,
une plaque posée se soulève), de l'écartement multiplié par sa propre taille, en plus du décalage
de sa pièce de référence (les chaînes s'étagent). Les pièces sans liaison s'écartent du centre de
l'assemblage ; la pièce fixe ne bouge pas ; la visserie suit sa pièce. Pendant la vue éclatée,
l'outil Main, les repères de liaison et les collisions sont masqués.

## Engrenages et crémaillères

« Coupler deux liaisons » (sous la liste des liaisons) relie deux liaisons : la **menante** (un
pivot) entraîne la **menée**.

- **Engrenage** (deux pivots) : la menée tourne de `z1 / z2` fois l'angle de la menante, en sens
  opposé ; « Même sens » pour une courroie ou une couronne à denture intérieure. Les nombres de
  dents sont ceux des roues (le générateur de roue dentée les donne) ; seul leur rapport compte.
- **Crémaillère** (pivot menant, glissière menée) : un tour de la roue fait avancer la glissière
  de π × diamètre primitif (module × nombre de dents).
- À la création, et quand on change le rapport ou les liaisons, le **calage** est recalculé pour
  que rien ne saute ; le champ « Calage » tourne (ou fait glisser) la pièce menée seule, pour que
  les dents tombent entre elles.
- Tourner, glisser à la souris ou animer la menante fait suivre la menée ; manipuler la menée
  fait tourner la menante en sens inverse du rapport. Les couplages fonctionnent aussi dans une
  boucle fermée : les liaisons menées ne sont pas des inconnues du solveur, elles sont recalculées
  à partir de leur menante à chaque essai. Une liaison menée par deux couplages, ou un couplage
  dont une liaison n'a pas le bon type, est signalé et ignoré.
- Les dents ne se touchent pas dans le calcul (pas de contact) : le rapport fait tout. La
  recherche de collisions permet de vérifier l'entraxe et le calage.

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
- Format natif : champ facultatif `assembly` du document (`instances`, `joints`, `fasteners` et
  `couplings` facultatifs) ; les anciens
  projets s'ouvrent sans changement.

## Visserie

Bouton **Visserie** de la barre d'outils : choisir l'élément, puis cliquer le bord d'un trou rond
(ou l'intérieur du trou) d'une pièce insérée. Un clic pose un élément ; Échap ou « Terminé »
arrête la pose. Le filetage n'est pas dessiné.

| Élément | Norme | Tailles |
| --- | --- | --- |
| Vis CHC (tête cylindrique, six pans creux) | ISO 4762 | M2 à M12 |
| Vis BHC (tête bombée, six pans creux) | ISO 7380-1 | M3 à M12 |
| Vis FHC (tête fraisée à 90°, six pans creux) | ISO 10642 | M3 à M12 |
| Vis H (tête hexagonale) | ISO 4017 | M3 à M12 |
| Écrou H | ISO 4032 | M2 à M12 |
| Rondelle plate | ISO 7089 | M2 à M12 |

- **Pas de vis de mauvaise taille** : la taille est déduite du diamètre du trou — trou de passage
  (du diamètre nominal, courant en impression 3D, jusqu'à la série large ISO 273) ou perçage avant
  taraudage (± 0,15 mm). Un trou qui ne correspond à aucune vis est refusé avec un exemple de bons
  diamètres. Ensuite, seules les tailles qui conviennent au trou et existent dans la norme sont
  proposées. Une vis FHC accepte aussi le bord d'une fraisure (diamètre de sa tête) : sa tête y
  affleure.
- **Longueur** : seules les longueurs normalisées de la taille sont proposées ; à la pose, la plus
  courte qui traverse le trou et dépasse d'un diamètre (de quoi prendre un écrou ou se visser dans
  la pièce suivante).
- **Placement** : l'élément est accroché au bord du trou (référence persistante, comme les
  liaisons) et suit la pièce quand elle bouge. La tête est du côté du bord cliqué, la tige entre
  dans le trou ; « Retourner » le met de l'autre côté. Sur un même bord, les rondelles se placent
  contre la pièce, puis l'écrou ou la tête de vis, quel que soit l'ordre de pose. Cliquer un élément
  déjà posé en ajoute un sur le même trou (une rondelle sous une vis, par exemple). Pour un écrou,
  cliquer le bord de sortie du trou.
- **Liste** : un groupe « Visserie » replié, sous les liaisons ; les éléments identiques y sont
  regroupés (« Vis CHC ISO 4762 M3 × 12 × 4 »). Choisir une ligne sélectionne le groupe : type,
  taille et longueur se changent pour tous ses éléments.
- **Nomenclature** (Fabrication › Documents, CSV) : une ligne par désignation, après les pièces.
- Si la pièce est modifiée et que le trou disparaît ou change de diamètre, l'élément est signalé
  (« Souci ») au lieu d'être déplacé au hasard.
- Format natif : champ facultatif `assembly.fasteners` (`kind`, `size`, `length`, `at` = pièce
  insérée et arête du trou, `flip`) ; une taille ou une longueur hors norme rend le fichier invalide.
- La visserie n'est pas encore incluse dans les exports STEP et 3MF ni dans la recherche de
  collisions.

## Sous-assemblages (niveau Expert)

Un sous-assemblage est un **bloc** assemblé une fois (une roue sur son axe avec ses roulements, une
pince…) puis inséré une ou plusieurs fois dans l'assemblage principal ou dans un autre bloc.

- En haut du panneau Assemblage, « Assemblage : Principal ▾ » choisit ce que l'on modifie ; « + »
  crée un sous-assemblage vide et l'ouvre. Dans un sous-assemblage, tous les outils de l'onglet
  servent (Insérer, Liaison, Visserie, engrenages, vue éclatée…) ; un bandeau rappelle lequel est
  ouvert, permet de le renommer, de le supprimer (refusé tant qu'il est inséré quelque part) et de
  revenir à l'assemblage principal. Quitter l'onglet Assemblage revient aussi au principal.
- « Insérer ▾ » propose les sous-assemblages après les pièces. Un bloc ne peut pas s'insérer en
  lui-même, ni dans un bloc qu'il contient.
- Inséré, un bloc est **rigide** : ses liaisons internes gardent leurs réglages. Coché
  « **Bloc souple** » (panneau du bloc inséré), ses liaisons qui bougent ont ici leurs propres
  curseurs : chaque insertion a ses réglages (quatre roues à des angles différents), le
  sous-assemblage n'est pas modifié, et ses engrenages internes suivent. Une boucle fermée qui
  passerait à la fois par le bloc et par l'assemblage parent n'est pas résolue. On le relie par
  une liaison posée sur une de ses pièces (le repère est pris sur cette pièce, placée dans le
  bloc) ; un clic sur une de ses pièces sélectionne le bloc entier, l'outil Main l'attrape d'un
  seul tenant et la vue éclatée l'écarte d'un bloc.
- Partout ailleurs, l'assemblage est **déplié** en pièces placées (`flattenAssembly`) : vue,
  collisions (« Bloc › Pièce »), exports STEP, 3MF et GLB, étude de simulation de l'assemblage.
  La nomenclature compte les pièces et la visserie des blocs autant de fois que le bloc est
  inséré. L'export STEP garde l'**arborescence** : chaque sous-assemblage utilisé y est défini une
  fois (ses pièces placées dans son repère, ses blocs imbriqués), puis inséré à chacune de ses
  places ; FreeCAD montre « Robot > Bras gauche > Barre 2 ».
- Techniquement, ouvrir un sous-assemblage échange son contenu avec l'assemblage principal dans
  le document (`domain/subassemblies.ts`) ; le fichier est toujours enregistré refermé.

## Hors périmètre (pour l'instant)

Contact entre les dents (le couplage impose le rapport), ressorts, efforts et vitesses (cinématique automatique), limites de course prises en
compte par le solveur de boucles. Les boucles impossibles sont signalées clairement au lieu d'être
calculées à moitié.
