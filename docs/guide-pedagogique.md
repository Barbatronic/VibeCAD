# Guide pédagogique

## Intention

VibeCAD enseigne la **démarche réelle** de la CAO paramétrique, celle de FreeCAD, Onshape ou
SolidWorks, avec un vocabulaire exact expliqué en une phrase :

1. choisir un **plan** (ou une face) ;
2. dessiner une **esquisse** et la **coter** (dimensions exactes) ;
3. donner une épaisseur : **extrusion** ;
4. retirer de la matière : **poche** (un perçage est une poche ronde traversante) ;
5. **modifier une étape antérieure** et voir la pièce se recalculer ;
6. **échanger** la pièce (STEP pour FreeCAD, STL pour l'imprimante 3D).

## Niveaux de l'interface

Pour que l'écran reste simple, VibeCAD a trois niveaux (en bas à droite, « Niveau », ou dans
l'Aide). Chaque niveau montre plus d'outils ; ceux d'un niveau supérieur sont masqués, pas
grisés.

| Niveau | Outils |
| --- | --- |
| **Débutant** (par défaut) | Esquisse : segment, rectangle, cercle, cote, coïncidence, horizontal, vertical. Extrusion, poche, formes toutes faites (boîte, cylindre, boule), mesure. Impression 3D. Parcours « plaque percée ». |
| **Intermédiaire** | En plus : l'anneau, arc, rectangle centré, polygone, oblong, couper, projeter, construction, autres contraintes ; révolution, congé, chanfrein, coque, répétition, symétrie ; vue en coupe, centre de gravité ; onglet Assemblage ; découpe laser et documents ; parcours assemblage et fabrication. |
| **Expert** | En plus : lissage, balayage, « Garder » (intersection), découpe en deux, dépouille, extrusion jusqu'à une face, décalage de contour, ellipse et spline (esquisse), épaissir, import de fichiers STEP et STL (menu Fichier). |

Le niveau est retenu sur l'ordinateur ; il se change aussi dans les **Préférences** (roue dentée
en haut à droite), avec les bulles d'explication, le chat, le thème et l'aimantation à la grille. Pour une classe, donner un lien qui l'impose, par
exemple `…/VibeCAD/?niveau=debutant` ou `?niveau=intermediaire`. Un projet fait à un niveau
supérieur s'ouvre toujours : ses étapes restent visibles et modifiables dans l'historique.

## Bulles d'explication de Java

Au survol prolongé d'un outil (environ une demi-seconde), Java, le chat, affiche une bulle qui
explique l'outil avec le vrai vocabulaire et, s'il est indisponible, pourquoi. On peut les couper
dans l'Aide (« Bulles d'explication de Java ») : on retrouve alors les info-bulles simples du
navigateur. Le réglage est retenu sur l'ordinateur ; si le chat est masqué, les bulles restent,
sans lui.

## Le parcours guidé « plaque percée »

Bouton **Parcours** en haut à droite (ou Aide → Lancer le parcours guidé). Douze étapes courtes ;
chacune se valide toute seule en observant le modèle réel (« Bravo, c'est fait ! »), et on peut
passer une étape, revenir en arrière ou quitter à tout moment. Le bouton à utiliser est mis en
évidence par un contour orange animé. **Java**, le chat de VibeCAD (noir sur le dessus, blanc en dessous), présente chaque étape et saute de
joie quand elle est réussie.

En dehors du parcours, le chat n'apparaît que lorsqu'il a quelque chose d'utile à dire : une
étape en erreur (avec un bouton pour l'ouvrir ou la réparer), une esquisse au contour ouvert, une
pièce vide. Il tutoie l'enfant, emploie le vrai vocabulaire de CAO et ne modifie jamais la pièce
lui-même. On peut le réduire d'un clic ou le masquer (Aide → « Afficher le chat »).

| Étape | Ce que l'enfant fait | Ce qu'il apprend |
| --- | --- | --- |
| 1 | Esquisse → plan XY | un dessin se pose sur un plan |
| 2 | Rectangle depuis l'origine, tape 60, Tab, 30, Entrée | origine, cotes, saisie au clavier |
| 3 | Terminer l'esquisse | le dessin vert est entièrement contraint |
| 4 | Extrusion de 5 mm, Valider | aperçu puis validation |
| 5 | Double-clic sur le dessus de la plaque | dessiner sur une face |
| 6 | Cercle, tape 6 | diamètre |
| 7 | Cotes horizontale et verticale de 15 mm depuis l'origine | positionner par des cotes |
| 8 | Terminer l'esquisse | |
| 9 | Poche traversante, Valider | retirer de la matière |
| 10 | Double-clic sur « Esquisse 1 », cote 60 → 80 | modifier l'historique, recalcul |
| 11 | Enregistrer, exporter en STEP | garder et partager son travail |

## Conseils pour l'accompagnement

- Laisser l'enfant **explorer** : tout s'annule (Ctrl+Z, ou le bouton Annuler en haut), les
  erreurs sont expliquées et réparables, rien n'est perdu (sauvegarde automatique).
- Faire verbaliser le vocabulaire : « je fais une **esquisse** sur le **plan XY** », « je
  **cote** le rectangle », « j'**extrude** de 5 mm ».
- Montrer l'intérêt du paramétrique avec l'étape 10 : changer une cote plutôt que redessiner.
- Prolonger : mesurer la plaque (bouton Mesurer), imprimer la pièce (export STL), l'ouvrir dans
  FreeCAD (export STEP) pour faire le lien avec un logiciel professionnel.

## Faire tester le parcours par une enfant

Les tests automatiques vérifient que tout fonctionne, pas que c'est compréhensible. Pour une
séance d'observation (20 à 30 minutes) :

1. Préparer un ordinateur avec souris, l'application ouverte, un projet vide.
2. Donner une seule consigne : « Fabrique une plaque avec un trou, en suivant le parcours ».
3. Observer sans aider pendant les premières minutes ; noter :
   - les moments d'hésitation (où regarde-t-elle ? que cherche-t-elle ?) ;
   - les mots incompris dans les messages ;
   - les erreurs de manipulation (clic à côté de l'origine, glisser au lieu de cliquer…) ;
   - les moments de satisfaction (aperçu, pièce terminée).
4. Ensuite seulement, répondre aux questions et demander : « Qu'est-ce qui était facile ?
   difficile ? Qu'aimerais-tu fabriquer ensuite ? »
5. Reporter les observations : chaque message de l'interface est dans `src/` (recherche du texte
   exact), modifiable facilement.

## Points d'attention connus

- Le clic doit tomber près de l'origine pour s'y accrocher : le repère « Origine » s'affiche
  quand c'est le cas.
- Le double-clic sur une cote ouvre sa modification ; un simple clic la sélectionne.
- Échap annule l'outil en cours, puis revient à la sélection ; il ne ferme pas l'esquisse (pour
  éviter de perdre un dessin par erreur).
