# Contexte du projet — CAO pédagogique dans le navigateur

## 1. Mission de l’agent

Concevoir et développer un mini logiciel de CAO 3D paramétrique, libre, accessible dans un navigateur, destiné à apprendre les bases réelles de la conception mécanique. Ce document constitue le cadrage produit et technique à respecter tout au long du projet.

Livrer une application fonctionnelle, pas seulement une maquette d’interface ou un visualiseur. Avancer par incréments utilisables et documenter les décisions techniques. Ne pas annoncer une fonction comme terminée sans vérifier son fonctionnement géométrique et sa persistance.

## 2. Utilisateurs et intention pédagogique

Le projet s’adresse à des enseignants (conception, prototypage, technologie) qui souhaitent faire découvrir la CAO à des enfants de 9 à 10 ans. Les logiciels professionnels présentent trop de complexité initiale ; les logiciels pour enfants ne transmettent pas suffisamment les méthodes et possibilités d’une vraie CAO.

L’application doit ressembler à un logiciel de CAO sérieux tout en étant rassurante. Elle doit apprendre à choisir un plan, dessiner une esquisse, saisir des dimensions, créer un volume, retirer de la matière et modifier une étape antérieure. Elle doit permettre de concevoir une ou deux pièces simples et réutiliser le résultat dans FreeCAD.

L’utilisateur doit pouvoir découvrir par essais, prévisualiser, annuler et recommencer. Éviter le style infantilisant, les écrans saturés et les fonctions visibles mais inopérantes. Interface et aide en français.

## 3. Choix confirmés par le commanditaire

- Projet développé dans VS Code, avec sources réparties en modules faciles à modifier.
- Application web avec une page principale HTML ; aucun impératif de tout réunir dans un seul fichier HTML.
- Modélisation principalement par esquisses cotées puis extrusions et enlèvements de matière.
- Compatibilité prioritaire avec FreeCAD par import et export STEP.
- Historique de construction visible et réellement éditable.
- Technologies ouvertes et libres ; calcul local dans le navigateur.
- Utilisation hors ligne et possibilité d’hébergement en ligne.

Les choix techniques ci-dessous sont des orientations proposées, à valider par un prototype. L’hébergement en ligne n’implique pas un service de calcul distant ni une synchronisation des documents.

## 4. Périmètre initial

### Première version utilisable

- Nouveau projet, ouvrir, enregistrer sous, sauvegarde automatique locale et récupération.
- Une ou deux pièces indépendantes dans un même document ; pas de solveur d’assemblage.
- Plans XY, XZ, YZ, origine, axes et unités en millimètres.
- Esquisses : segment, rectangle et cercle ; sélection, déplacement, suppression et modification des dimensions.
- Accrochage à l’origine, à la grille et aux points existants, avec indications visuelles.
- Cotation utile : longueur, largeur, rayon ou diamètre et position par rapport à l’origine.
- Contraintes élémentaires : coïncidence, horizontalité et verticalité. Introduire un sous-ensemble fiable avant d’étendre le solveur.
- Extrusion additive d’un profil fermé et extrusion soustractive, avec profondeur définie ou traversante.
- Perçage simple obtenu par une esquisse circulaire et un enlèvement de matière.
- Sélection de pièces, faces et arêtes ; nom, visibilité et couleur des pièces.
- Navigation 3D, vues standard, cadrage, projection orthographique et mesure simple.
- Historique des fonctions, édition des paramètres, recalcul des opérations suivantes, annuler et rétablir.
- Sauvegarde native avec historique, export et import STEP de solides.

### Extension après validation du socle

Chanfrein, congé, révolution, symétrie et répétition simple. Ajout éventuel d’arcs et de contraintes d’esquisse supplémentaires. Export STL pour impression 3D ; export GLB à envisager pour partager ou visualiser le modèle. Le partage vers Sketchfab est secondaire et ne remplace pas la compatibilité CAO.

Ne pas inclure dans la première version : assemblages contraints, tôlerie, surfaces complexes, mise en plan complète, simulation physique, collaboration temps réel, comptes utilisateur ou bibliothèque exhaustive de pièces.

## 5. Expérience utilisateur

### Organisation de l’écran

- Au centre : vue 3D principale, grille discrète et repère d’orientation.
- À gauche : pièces et historique de construction, avec noms lisibles et icônes simples.
- En haut : commandes courantes et outils pertinents pour le mode actif.
- À droite : panneau temporaire des paramètres de l’opération en cours.
- En bas : aide contextuelle courte et indication de l’état du document.

Les réglages avancés sont repliés. Les outils d’esquisse apparaissent en mode esquisse ; les opérations de volume apparaissent lorsque la sélection le permet. Une commande indisponible explique ce qu’il faut sélectionner. Des boutons « Valider » et « Annuler » restent visibles pendant une opération.

### Interaction

- Prévisualiser avant de valider ; distinguer clairement l’aperçu de la géométrie enregistrée.
- Montrer la sélection et les accrochages sans dépendre uniquement de la couleur.
- Saisir une cote au clavier ou modifier la valeur existante ; accepter la virgule décimale en français.
- Afficher les unités, empêcher les valeurs non valides et conserver la dernière saisie lors d’une erreur.
- Prévoir un comportement cohérent avec souris et pavé tactile ; afficher les commandes de navigation dans une aide accessible.
- Échap annule l’outil actif ; Ctrl/Cmd+Z et rétablissement fonctionnent ; Suppr respecte le contexte.
- Éviter les boîtes de dialogue répétitives et les messages techniques incompréhensibles.
- Prévoir navigation clavier, focus visible, contraste suffisant et boutons faciles à viser.

Exemple de message : « Le contour n’est pas fermé. Reliez les deux points indiqués pour créer le volume. »

### Accompagnement pédagogique

Un premier parcours facultatif guide la réalisation d’une plaque percée. Utiliser le vocabulaire réel avec une explication courte : « Extrusion : donner une épaisseur au dessin ». Les étapes doivent rester disponibles hors ligne. L’aide accompagne l’action sans empêcher l’exploration libre.

## 6. Géométrie et précision

Utiliser un véritable noyau de solides B-Rep. Le maillage sert à l’affichage et aux exports de maillages ; il ne doit pas être la source de vérité des solides ni de l’historique paramétrique.

Évaluer Open CASCADE compilé en WebAssembly, notamment OpenCascade.js, pour la construction, les opérations booléennes, la tessellation et l’échange STEP. Commencer par un prototype qui crée un solide, retire un cylindre, exporte en STEP puis réimporte le résultat. Vérifier les fonctions réellement exposées par la version retenue, les licences et les performances avant de figer la dépendance.

Définir des tolérances géométriques explicites en millimètres, distinctes du pas de grille et de la précision d’affichage. Ne pas utiliser une simple impression visuelle pour prouver la validité d’une opération. Vérifier fermeture des profils, validité des solides et dimensions des résultats.

Les opérations sur les faces générées demandent une stratégie de références persistantes : ne pas enregistrer uniquement un indice de triangle ou un numéro de face transitoire. Favoriser les plans d’origine et les références sémantiques. Si une référence devient ambiguë après recalcul, demander une réparation explicite plutôt que sélectionner silencieusement une autre face.

## 7. Historique et modèle de document

Distinguer deux mécanismes :

1. L’historique paramétrique décrit comment la pièce est construite et reste enregistré dans le projet.
2. Annuler/rétablir revient sur les actions de l’utilisateur pendant l’édition.

Chaque pièce possède un identifiant stable et une liste de fonctions : esquisse, extrusion, poche, puis éventuellement finitions. Chaque fonction possède un identifiant, un type, un nom, des paramètres typés, ses dépendances et un état de validité. Les unités et la version du schéma font partie du document.

Modifier une cote ou une profondeur recalcule les fonctions dépendantes dans l’ordre. Une erreur doit identifier l’étape en cause et les étapes bloquées, conserver les paramètres et permettre une correction. La dernière géométrie valide peut rester visible, avec une indication claire qu’elle n’est plus à jour.

Ne pas sérialiser directement les objets du moteur WebAssembly. Stocker le modèle métier portable et reconstruire la géométrie à partir de celui-ci. Les caches sont facultatifs et ne font pas autorité. Les solides importés nécessitent cependant un contenu géométrique persistant, embarqué dans le projet : ne jamais dépendre du chemin du fichier d’origine.

## 8. Fichiers et interopérabilité

### Format natif

Définir un format ouvert, documenté et versionné, fondé sur JSON ou sur une archive contenant un manifeste JSON et les ressources géométriques des imports. Le format doit conserver pièces, esquisses, contraintes, paramètres, dépendances, unités et noms. Prévoir validation de schéma et migrations explicites. L’extension du fichier reste à choisir ; ne pas la confondre avec STEP ou FCStd.

Une sauvegarde puis réouverture doit permettre de modifier la première esquisse et recalculer la pièce. Conserver les ressources importées à l’intérieur du fichier pour une portabilité complète.

### STEP et FreeCAD

- Exporter de véritables solides, avec unités et noms lorsque le moteur le permet.
- Permettre l’export d’une pièce sélectionnée ou des deux pièces.
- Importer un STEP comme une ou plusieurs fonctions « Solide importé ».
- Ne pas promettre de retrouver les esquisses et opérations de construction d’un STEP générique.
- Ne pas présenter l’export STEP comme un export de l’arbre Part Design de FreeCAD.
- L’utilisateur peut reprendre les solides dans FreeCAD et ajouter de nouvelles opérations ; l’historique complet de notre application reste dans son format natif.
- La lecture et l’écriture directes de FCStd sont hors périmètre initial. Une passerelle FreeCAD serait un projet séparé.

### Maillages

L’export STL est secondaire et doit préciser les unités attendues, car le format ne les impose pas. Un futur export GLB vise la visualisation. Importer un maillage ne restitue ni un solide CAO exact ni l’historique : ne pas promettre cette conversion automatiquement.

## 9. Architecture modulaire proposée

Développer un projet TypeScript avec Vite et un moteur d’affichage Three.js, sous réserve de validation des dépendances actuelles. Choisir une couche UI légère selon les besoins, sans imposer un framework inutile. Verrouiller les versions et conserver le fichier de verrouillage.

Organisation suggérée :

```text
index.html
src/
  app/                 # démarrage, modes et composition
  domain/              # documents, pièces, fonctions, unités et dépendances
  commands/            # actions, transactions, annuler/rétablir
  sketch/              # outils 2D, cotations, accrochages et contraintes
  geometry/            # interfaces du noyau et adaptateur Open CASCADE
  workers/             # initialisation WASM et calcul géométrique
  viewport/            # caméra, affichage, sélection et surbrillance
  features/            # modules esquisse, extrusion, poche, finitions
  io/                  # formats natifs, STEP et maillages
  persistence/         # sauvegarde locale, autosave et migrations
  ui/                  # panneaux et composants d’interface
  tutorials/           # parcours et contenus pédagogiques
  styles/              # tokens visuels et styles
public/
  assets/              # ressources locales et fichiers WASM nécessaires
tests/                 # vérifications métier, géométriques et parcours
docs/                  # architecture, formats et décisions
```

Le domaine ne dépend ni du DOM ni de Three.js ni du noyau concret. La vue consomme une représentation d’affichage ; les calculs géométriques passent par une interface documentée. Chaque nouvelle fonction fournit ses paramètres, leur validation, son évaluation et son panneau UI, sans modifier un fichier central massif.

Exécuter les calculs lourds dans un Web Worker lorsque compatible avec le moteur. Prévoir identifiants de requêtes, gestion des résultats obsolètes, progression et libération des ressources WASM. Éviter les recalculs complets à chaque mouvement de souris ; distinguer aperçu et validation.

## 10. Hors ligne, hébergement et confidentialité

Le calcul de CAO, l’import et l’export fonctionnent localement. Aucun compte ni serveur de calcul n’est requis. Ne charger aucune dépendance, police ou ressource depuis un CDN à l’exécution.

Prévoir une PWA installable avec service worker pour l’application, les aides et les fichiers WASM. Le mode hors ligne est disponible après installation ou mise en cache complète ; afficher clairement quand cette préparation est terminée. Le développement local utilise un serveur localhost et la production HTTPS. Ne pas promettre un fonctionnement complet par double-clic sur index.html via file://.

Stocker les projets et sauvegardes automatiques dans IndexedDB. Maintenir un téléchargement explicite des fichiers : le stockage du navigateur peut être effacé ou saturé. La File System Access API peut être une amélioration progressive, avec un chemin de repli par téléchargement et sélecteur de fichier.

Un hébergement statique permet l’usage en ligne ; les documents restent locaux par défaut. Synchronisation cloud et collaboration sont hors périmètre. Aucune télémétrie ou transmission de modèles sans demande explicite.

## 11. Développement, licences et maintenance

Fournir des instructions VS Code et commandes npm pour installation, développement, compilation, vérifications et aperçu du build. Documenter les prérequis exacts retenus et les limites des navigateurs testés.

Choisir une licence libre pour le projet et respecter celles des dépendances, notamment les obligations de redistribution du noyau géométrique. Ne pas supposer qu’une licence permissive de l’interface supprime les obligations des composants embarqués. Inclure les notices requises et documenter la provenance du build WASM.

Documenter comment ajouter un outil, une fonction paramétrique ou un format d’export. Éviter les fichiers monolithiques, les dépendances circulaires et les paramètres globaux implicites.

## 12. Plan de réalisation

1. **Prototype technique** : noyau WASM, solide percé, tessellation, STEP exporté et vérifié dans FreeCAD, import STEP et fonctionnement local.
2. **Tranche verticale** : dessiner un rectangle, le coter, l’extruder, enregistrer, rouvrir et modifier sa largeur avec recalcul.
3. **Socle pédagogique** : cercle, poche traversante, navigation, sélection, historique lisible et parcours guidé.
4. **Robustesse** : deux pièces, import persistant, annuler/rétablir, erreurs récupérables, autosave et mode hors ligne vérifié.
5. **Finitions** : mesure, chanfrein et congé si fiables, puis extensions selon les retours d’usage.

Valider d’abord le noyau et l’interopérabilité avant de développer tous les panneaux. Si une bibliothèque ne permet pas une fonction requise, exposer la limitation et proposer une alternative technique ; ne pas remplacer une opération CAO par un effet visuel.

## 13. Critères d’acceptation

- Un débutant réalise une plaque de 60 × 30 × 5 mm, percée d’un trou de diamètre 6 mm placé par des cotes, avec le parcours guidé.
- Modifier la largeur initiale à 80 mm met à jour la pièce et conserve le trou selon les références choisies.
- Annuler puis rétablir une modification restaure dimensions, historique et géométrie de façon cohérente.
- Une sauvegarde native réouverte conserve les paramètres et permet une nouvelle modification.
- Un STEP exporté s’ouvre dans FreeCAD avec les dimensions et un solide valide ; les vérifications de volume tiennent compte du perçage.
- Un STEP importé reste présent après sauvegarde et réouverture du projet, sans accès au fichier source.
- Deux pièces peuvent être nommées, masquées et exportées distinctement.
- Une erreur de profil ouvert ou de référence perdue est compréhensible et récupérable sans perdre le document.
- Après préparation du mode hors ligne, un rechargement sans réseau permet de créer, modifier, sauvegarder et exporter une pièce.
- L’interface reste interactive pendant les calculs ; la durée et la mémoire sont mesurées sur une machine de référence documentée.

Automatiser les tests de sérialisation, recalcul, dimensions, annuler/rétablir et échanges géométriques. Ajouter quelques parcours navigateur représentatifs. Vérifier visuellement l’interface et faire tester le parcours par une enfant ; les tests techniques ne suffisent pas à démontrer l’accessibilité pédagogique.

## 14. Références de départ et décisions encore ouvertes

Références techniques à vérifier au moment du développement :

- OpenCascade.js : https://github.com/donalffons/opencascade.js
- Documentation OpenCascade.js : https://ocjs.org/docs/about
- Import CAO FreeCAD : https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Part_Import.md
- Export CAO FreeCAD : https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Part_Export.md

Restent à décider : nom de l’application, licence du projet, extension native, framework UI, solution exacte de contraintes d’esquisse, versions des dépendances et navigateurs cibles. Ces décisions ne doivent pas bloquer le prototype géométrique. Ne demander au commanditaire que les choix qui modifient réellement le périmètre ou l’expérience attendue.
