# VibeCAD — CAO 3D paramétrique pour apprendre

VibeCAD est un petit logiciel de **CAO 3D paramétrique** qui fonctionne entièrement dans le
navigateur. Il est conçu pour apprendre les bases réelles de la conception mécanique — choisir un
plan, dessiner une esquisse cotée, créer un volume, retirer de la matière, modifier une étape
antérieure — avec une interface sérieuse mais rassurante, en français.

Le résultat se reprend dans **FreeCAD** grâce à l'export **STEP** (solides exacts, en
millimètres, avec le nom et la couleur de chaque pièce).

> Les fichiers de projet gardent l'extension `.vibecad` (nom de développement de l'application) :
> les projets déjà enregistrés s'ouvrent sans conversion ([décision 0007](docs/decisions/0007-nom-application.md)).

![Plaque percée de 80 × 30 × 5 mm après modification de la largeur](docs/images/plaque-percee.png)

![Assemblage : goupille en glissière dans le trou de la plaque, avec ses curseurs](docs/images/assemblage.png)

![Parcours guidé : chaque étape se valide toute seule](docs/images/parcours-java.png)

## Ce que l'on peut faire

- **Projets** : nouveau, ouvrir, enregistrer (dans le navigateur), enregistrer sous (fichier
  `.vibecad`), sauvegarde automatique et récupération après fermeture inattendue.
- **Pièces** : une ou plusieurs pièces indépendantes dans un document ; nom, visibilité, couleur.
- **Esquisses** sur les plans XY, XZ, YZ ou sur une face plane : segment, rectangle (par deux
  coins ou par le centre, qui reste au milieu quand on cote), cercle, **arc de cercle** (centre,
  départ, arrivée ; les contours mêlant segments et arcs donnent de vrais volumes), **polygone
  régulier** (centre et sommet, 3 à 32 côtés, inscrit dans un cercle de construction qu'on cote),
  **oblong** (rainure : deux centres et une largeur) ;
  sélection, déplacement, suppression ; accrochage à l'origine, aux points et à la grille avec
  repères visuels et textuels. Outil **Couper** (T) : retirer le morceau d'un trait jusqu'aux
  croisements voisins (le morceau est montré en rouge au survol), pour réunir deux formes en un
  seul contour ; les nouvelles extrémités restent posées sur le trait qui coupe. Outil
  **Décalage** (niveau Expert) : recopier un contour fermé à une distance choisie à la souris
  (arrondie au demi-millimètre) ou tapée, à l'extérieur ou à l'intérieur ; le contour recopié reste
  parallèle à l'original, à distance cotée (un cadre, une paroi d'épaisseur régulière).
  **Ellipse** et **spline** (niveau Expert) : ellipse par son centre, le bout du grand axe et sa
  largeur ; spline lisse passant par des points cliqués, ouverte ou fermée, modelée en faisant
  glisser ses points ; extrudables, et une spline peut servir de chemin de balayage.
- **Cotes** : longueur, diamètre, rayon, distances horizontale / verticale / alignée, distance
  d'un point à un segment ou entre segments parallèles, **angle** entre deux segments. Les deux
  éléments se cliquent l'un après l'autre. Saisie au clavier (virgule décimale acceptée), petites
  flèches ▲▼ ou molette de la souris (Maj : ×10, Alt : ×0,1) dans tous les champs de valeur.
- **Paramètres et équations** (niveau Intermédiaire) : tous les champs de valeur et les cotes
  acceptent un calcul (`60/2`, `(largeur - 2*marge)/2`, `pi`). Les **paramètres du projet**
  (panneau de gauche, sous les pièces) sont des nombres nommés, qui peuvent dépendre les uns des
  autres (`largeur = ep*12`) : changer un paramètre met à jour toutes les étapes et les cotes qui
  l'utilisent. Renommer un paramètre suit dans toutes les équations ; un paramètre utilisé ne peut
  pas être supprimé (la liste de ce qui l'utilise est affichée).
- **Contraintes** : coïncidence, horizontal, vertical, parallèle, perpendiculaire, égalité,
  colinéaire, tangence, point sur une courbe, milieu, concentrique ; par clics successifs ou sur
  la sélection. Affichage du nombre de degrés de liberté (vert = entièrement contraint).
- **Points** (outil Point) : un point seul, placé par des cotes depuis l'origine ; il sert de
  centre à un perçage et d'accroche pour une liaison d'assemblage.
- **Construction et projection** : traits de construction (pointillés, ignorés pour le volume) ;
  arêtes de la pièce **projetées** dans l'esquisse (bord, trou…) comme repères fixes qui suivent
  la pièce quand elle change.
- **Volumes** : extrusion et poche (profondeur cotée ou traversante, sens normal / opposé /
  symétrique, ou **deux côtés** avec une longueur différente de chaque côté) avec **aperçu** avant
  validation. Un perçage simple est une poche circulaire traversante.
  Au niveau Expert, une extrusion peut aller **jusqu'à une face** plane cliquée (même inclinée).
- **Perçage normalisé** (bouton « Poche ▾ », niveau Intermédiaire) : un trou à chaque **point**
  (outil Point de l'esquisse) et au centre de chaque cercle d'une esquisse (sa taille ne compte
  pas), pour une vis M2 à M12 ou d'un **diamètre libre** : **passage** (sans jeu, jeu serré,
  normal ou large d'ISO 273, ou jeu choisi, utile en impression 3D), **lamé** pour cacher une tête
  de vis CHC, **fraisé** à 90° pour une vis FHC qui affleure, ou **fileté** (perçage avant
  taraudage ISO, ou trou où la vis forme son filet dans le plastique imprimé : 0,9 × d) ;
  traversant ou à une profondeur donnée. Les dimensions de la tête sont proposées par la norme et
  modifiables.
- **Révolution** : faire tourner un profil autour d'un axe de l'esquisse (axe X, Y ou un segment,
  souvent de construction), tour complet ou partiel, avec aperçu ; elle ajoute de la matière ou la
  **creuse** (gorge, perçage conique), et au niveau Expert peut garder la partie commune.
- **Lissage** (niveau Expert) : un volume qui passe d'un contour fermé à un autre, dessinés sur
  des plans différents (d'un carré à un rond…), surface lisse ou raccords droits, ajouté ou creusé.
- **Balayage** (niveau Expert) : un contour fermé qui suit un chemin dessiné dans une autre esquisse
  (segments et arcs bout à bout, ou un cercle) : tube coudé, anse, rainure ; ajouté ou creusé.
- **Formes toutes faites** : boîte, cylindre, boule et anneau, placées par leurs coordonnées,
  ajoutées à la pièce ou creusées dedans (comme un trou), sans passer par une esquisse ; au niveau
  Expert, « Garder » ne conserve que la matière commune (intersection).
- **Générateurs** (bouton « Forme ▾ », niveau Intermédiaire) : **roue dentée** droite à
  développante de cercle (module, nombre de dents, angle de pression, alésage), **crémaillère**,
  **poulie crantée** pour courroie GT2 (pas 2, 3, 5 mm) ou T (T2.5, T5, T10) avec joues. Le panneau
  donne les diamètres et l'entraxe ; deux roues de même module engrènent (vérifié par le calcul :
  à l'entraxe théorique, elles ne se rentrent pas dedans). Profils de poulie approchés : impression
  d'essai recommandée.
- **Répétition** d'une extrusion, d'une poche (un trou…) ou d'une révolution : en ligne, en
  grille (deux directions) ou en cercle, le long d'un axe X / Y / Z ou d'une arête cliquée (bord
  droit, ou bord d'un trou pour tourner autour de son axe), avec aperçu.
- **Plans de construction** (menu « Répétition ▾ », niveau Intermédiaire) : un plan décalé d'un plan
  d'origine, d'une face ou d'un autre plan, éventuellement incliné autour d'un axe X, Y, Z ou d'une
  arête cliquée (comme une porte sur ses gonds). Il est montré dans la vue 3D et sert de support
  d'esquisse là où il n'y a pas de face, de miroir pour une symétrie, de plan de découpe ou de
  plan neutre d'une dépouille. **Axes de construction** (même menu) : une droite parallèle à X, Y
  ou Z passant par un point, ou reprise d'une arête (l'axe d'un trou), autour de laquelle faire
  une répétition en cercle ou incliner un plan.
- **Symétrie** : ajouter le reflet de toute la pièce, ou d'une seule étape (un trou, un plot…),
  par rapport au plan XY, XZ, YZ, à une face plane cliquée ou à un plan de construction.
- **Déplacer** (niveau Intermédiaire) : décaler toute la pièce et/ou la faire pivoter autour d'un
  axe X, Y ou Z passant par un point choisi, ou en ajouter une copie déplacée ; les faces gardent
  leurs références (un congé ou une esquisse posés ensuite restent valables).
- **Découpe** (niveau Expert) : couper la pièce en deux par le plan XY, XZ, YZ (à la position
  choisie) ou par une face plane cliquée (décalée), et garder un côté ou les deux morceaux écartés
  (par exemple pour imprimer une pièce trop grande en deux fois).
- **Coque** : vider la pièce en gardant une paroi d'épaisseur choisie (vers l'intérieur ou
  l'extérieur), en cliquant les faces à laisser ouvertes (un pot, une boîte) ; sans face ouverte, la
  pièce est creuse et fermée.
- **Épaissir** (niveau Expert) : grossir ou amincir toute la pièce d'une même épaisseur (coins
  arrondis ou vifs), par exemple 0,2 mm de moins pour laisser du jeu entre deux pièces imprimées.
- **Dépouille** (niveau Expert) : incliner de quelques degrés les côtés cliqués (plans ou
  cylindriques) autour d'un plan neutre (XY, XZ, YZ ou une face plane), comme une pièce qui doit
  sortir d'un moule.
- **Congés et chanfreins** sur des arêtes choisies à la souris, avec aperçu ; les arêtes sont
  mémorisées par leurs deux faces voisines et survivent aux modifications des cotes.
- **Historique de construction** visible et modifiable : double-clic sur une étape pour la
  modifier, recalcul des étapes suivantes, erreurs expliquées et réparables. **Frise de
  l'historique** en bas de la vue : faire glisser le repère pour revenir en arrière (rejouer la
  construction pas à pas) ; une nouvelle étape s'insère à cet endroit.
- **Annuler / rétablir** (Ctrl+Z / Ctrl+Y), y compris pendant l'édition d'une esquisse.
- **Assemblage** (onglet à part) : insérer les pièces du projet (la première est fixe), les relier
  par des **liaisons** posées sur des repères (centre d'une face, bord d'un trou, arête) : fixe,
  pivot, glissière, pivot glissant. Curseurs par mouvement, limites, et glisser à la souris (la
  pièce ne suit que le mouvement permis). **Boucles fermées** (quadrilatère articulé,
  bielle-manivelle) : une liaison de plus referme la boucle, et quand on tourne une pièce les
  autres suivent. **Engrenages et crémaillères** entre liaisons : deux pivots couplés selon le
  nombre de dents (sens opposé, ou même sens pour une courroie), ou un pivot qui fait avancer une
  glissière ; la roue menée suit quand on tourne ou anime la menante, et inversement.
  **Vue éclatée** (bouton « Éclater ») : les pièces s'écartent le long de l'axe de leur liaison,
  avec un curseur d'écartement, sans rien changer au projet. Export STEP / 3MF de l'assemblage. Recherche des **collisions** (volume en
  commun en rouge). **Visserie** normalisée (vis CHC, BHC, FHC, H, écrous, rondelles, de M2 à
  M12, sans filetage) posée d'un clic dans les trous : la taille vient du trou (passage ISO 273
  ou taraudage), les longueurs sont celles de la norme, et elle apparaît dans la nomenclature.
  Voir [docs/assemblage.md](docs/assemblage.md).
- **Fabrication** (onglet à part) : préparer le plateau d'impression 3D (face posée, exemplaires,
  échelle, taille du plateau, plusieurs plateaux si besoin, estimation de matière) et l'exporter
  en 3MF ; préparer la découpe laser par matériau (épaisseurs différentes dans un même projet,
  préréglages contreplaqué et acrylique 3 et 5 mm en 300 × 200 mm ; contour d'une face, trait de
  coupe compensé, placement sur plaques) en SVG et DXF ;
  documents : mise en plan cotée (3 vues, PDF / SVG), gabarit papier 1:1 (PDF), nomenclature (CSV).
  Voir [docs/fabrication.md](docs/fabrication.md).
- **Simulation** (onglet à part, niveau Intermédiaire) : choisir le matériau, cliquer les faces
  fixées et celles où appuie une charge (masse en kg ou force en N), puis calculer : la pièce
  apparaît déformée (exagérée) et colorée du bleu au rouge selon l'effort, avec un verdict
  (« La pièce tient », « C'est juste », « Risque de casser »). Résultat indicatif, calculé par
  éléments finis dans un worker. Voir [docs/simulation.md](docs/simulation.md).
- **Volume, masse et centre de gravité** de la pièce sous l'historique (masse estimée en PLA
  plein) ; le centre de gravité peut être montré dans la vue (symbole des plans).
- **Vue en coupe** (bouton « Coupe » de la vue) : la pièce est coupée par un plan XY, XZ ou YZ
  réglable au curseur, la face de coupe hachurée en rouge ; affichage seulement, la pièce n'est pas
  modifiée.
- **Vue 3D** : rotation, déplacement, zoom vers le curseur, vues standard, cadrage, projection
  orthographique, repère d'orientation, sélection de faces et d'arêtes, **mesure**. **Modes
  d'affichage** (bouton « Affichage ») : ombré avec ou sans arêtes, arêtes cachées en pointillés
  (comme un dessin technique), transparent, fil de fer, noir et blanc, et épaisseur des arêtes
  (0,5 à 4 px) ; les choix sont retenus sur l'appareil.
- **Échanges** : export STEP (une ou plusieurs pièces), import STEP et **STL** (niveau Expert)
  comme « Solide importé » (contenu conservé dans le projet ; les petits défauts de précision d'un
  STEP sont réparés à la lecture, et un STEP surfacique fait de coques fermées est reconstitué en
  volume ; un STL est cousu en volume, ses faces
  planes sont reconstituées, 30 000 triangles au plus, maillage fermé exigé), export **3MF**
  (impression 3D : unité, noms et couleurs des pièces), STL (en mm) et **GLB** (glTF 2.0, pour
  montrer le modèle dans une page web, une présentation ou une visionneuse : pièces colorées,
  assemblage à sa place avec sa visserie).
- **Bulles d'explication** au survol de chaque outil (désactivables dans l'Aide).
- **Niveaux** Débutant, Intermédiaire, Expert : chaque niveau montre plus d'outils (choix en bas à
  droite ou par l'adresse `?niveau=expert`) ; voir [docs/guide-pedagogique.md](docs/guide-pedagogique.md).
- **Préférences** (roue dentée en haut à droite, ou menu Fichier) : niveau, bulles d'explication,
  environnement des jeunes (le chat), thème automatique / clair / sombre, aimantation à la grille
  des esquisses ; retenues sur
  l'appareil, jamais dans le projet, avec un retour aux réglages par défaut.
- **Parcours guidés**, au choix : « la plaque percée » (première pièce), « assembler et faire
  bouger » (insérer, relier par un pivot, faire tourner) et « préparer la fabrication »
  (impression 3D, découpe laser, documents). Chaque étape se valide toute seule en observant le
  modèle ; aide intégrée (navigation, vocabulaire, raccourcis).
- **Java, le chat de VibeCAD** (mascotte noir et blanc, **désactivée par défaut** ; à activer dans
  Préférences › Environnement des jeunes) : il présente les étapes du parcours, félicite quand une
  étape est réussie et, quand une étape a un souci, l'explique en une phrase avec un bouton pour
  le corriger. Discret (réductible, masquable), sans réseau, il ne modifie jamais la pièce tout
  seul. Ce n'est pas le logo de l'application : le logo (onglet du navigateur, application
  installée, en-tête) est un cube provisoire, dans `public/icons` (`npm run icons` refait les PNG).
- **Hors ligne** : application installable (PWA) ; après la première visite, tout fonctionne
  sans réseau. Aucun compte, aucun serveur de calcul, aucune transmission de vos modèles.

## Démarrer

### Prérequis

- **Node.js 22** ou plus récent (testé avec 22.22.1) et **npm** (testé avec 9.2 et 10.9).
- Un navigateur récent avec WebGL 2 et WebAssembly : Firefox, Chrome, Edge, Safari récents
  (voir [docs/navigateurs.md](docs/navigateurs.md)).
- Recommandé : **Visual Studio Code** (les extensions conseillées sont proposées à l'ouverture).

### Installation et lancement

```bash
npm install        # installe les dépendances (versions exactes verrouillées)
npm run dev        # serveur de développement : http://localhost:5173
```

Dans VS Code : ouvrir le dossier, puis **Terminal → Exécuter la tâche… → « Développement »**,
ou appuyer sur **F5** pour lancer le serveur et ouvrir le navigateur en mode débogage.

> L'application doit être servie par un serveur web (localhost en développement, HTTPS en
> production). Un double-clic sur `index.html` (`file://`) ne fonctionne pas : les navigateurs
> y interdisent les workers et le WebAssembly.

### Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement avec rechargement à chaud |
| `npm run build` | Vérification des types puis compilation de production dans `dist/` |
| `npm run preview` | Sert le build de production (http://localhost:4173), service worker compris |
| `npm run check` | Types + règles d'architecture + tests unitaires et géométriques |
| `npm test` | Tests unitaires et géométriques (Vitest, noyau WASM réel sous Node) |
| `npm run test:e2e` | Parcours navigateur (Playwright, Chromium) |
| `npm run test:e2e:firefox` | Mêmes parcours sous Firefox |
| `npm run bench` | Mesures de durée et de mémoire (résultats dans `tests/output/`) |
| `npm run verify:freecad` | Ouverture des STEP exportés dans FreeCAD (voir [docs/verification-freecad.md](docs/verification-freecad.md)) |
| `npm run lint:arch` | Vérifie les couches et l'absence de dépendances circulaires |

Avant la première exécution des tests navigateur : `npx playwright install chromium firefox`.

## Organisation du code

```text
index.html               page principale
src/
  main.tsx               composition : état, worker de calcul, stockage, interface
  meta.ts                nom et version de l'application
  app/                   contrôleur, état, raccourcis, disponibilité des commandes, hors ligne
  domain/                document, pièces, fonctions, unités, tolérances, statuts (sans DOM ni noyau)
  commands/              annuler / rétablir
  sketch/                modèle d'esquisse, solveur de contraintes, profils, accrochages, éditeur
  geometry/              interface du noyau, protocole du worker, client ; occt/ = adaptateur Open CASCADE
  workers/               worker de calcul, service géométrique, service worker (hors ligne)
  features/              une fonction = un dossier : définition, évaluation, panneau (sketch, extrude, pocket, imported)
  io/                    format natif .vibecad, ressources STEP embarquées, STL
  persistence/           IndexedDB (projets, sauvegarde automatique), fichiers
  viewport/              vue 3D Three.js : caméra, grille, pièces, esquisses, sélection
  ui/                    composants Preact : barres, panneaux, dialogues, aide, parcours
  tutorials/             parcours guidés (plaque percée, assemblage, fabrication)
  styles/                jetons visuels (thèmes clair et sombre) et styles
public/                  manifeste PWA et icônes
tests/                   unit/ (domaine, solveur…), geometry/ (noyau réel), e2e/ (navigateur), perf/
docs/                    architecture, format, décisions, performances, navigateurs, pédagogie
scripts/                 plugins de build, vérification d'architecture, script FreeCAD
```

Pour aller plus loin :

- [Architecture](docs/architecture.md) — couches, flux de données, worker, recalcul, références
  persistantes, tolérances.
- [Format natif `.vibecad`](docs/format-natif.md) et son [schéma JSON](docs/vibecad.schema.json).
- [Ajouter un outil, une fonction ou un format](docs/ajouter-une-fonction.md).
- [Décisions techniques](docs/decisions/) — choix du noyau, de la pile, du format, du solveur…
- [Performances et mémoire](docs/performance.md) — mesures sur la machine de référence.
- [Guide pédagogique](docs/guide-pedagogique.md) — parcours guidé et test avec un enfant.

## Héberger en ligne

`npm run build` produit un site statique dans `dist/`, à déposer sur n'importe quel hébergement
HTTPS (GitHub Pages, serveur de l'établissement…). Les chemins sont relatifs : un sous-dossier
convient. Les documents restent dans le navigateur de chaque utilisateur ; rien n'est envoyé au
serveur. Le fichier WebAssembly (23 Mo, 7 Mo compressé) est servi avec l'application ; activer
la compression gzip ou brotli côté serveur réduit le premier chargement.

## Publier sur GitHub Pages

Le dépôt contient un workflow à lancement manuel ; marche à suivre pas à pas : [docs/publication-github.md](docs/publication-github.md).

## Licences

Le code de VibeCAD est sous **licence MIT** ([LICENSE](LICENSE)). L'application construite
embarque le noyau **Open CASCADE Technology (LGPL 2.1)**, three.js (MIT) et Preact (MIT) :
obligations et provenance du fichier WASM dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Le choix de la licence MIT est provisoire et peut être revu
([décision 0006](docs/decisions/0006-licence.md)).

## Limites connues (version 0.1)

- Congés et chanfreins : rayon / distance constants ; une arête est désignée par ses deux faces
  voisines, donc deux arêtes séparées entre les mêmes faces sont traitées ensemble.
- Projection : segments et cercles parallèles au plan de l'esquisse (pas encore d'ellipses ni de
  courbes quelconques). Une arête projetée qui disparaît garde sa dernière position (signalé).
- La position de la frise de l'historique n'est pas enregistrée dans le fichier : un projet
  rouvert montre toutes les étapes.
- Assemblage : pas de contact entre pièces ni d'engrenages ; la visserie n'est pas encore
  incluse dans les exports STEP et 3MF.
- L'export STEP contient les formes finales, pas l'historique : ce n'est pas un arbre Part
  Design de FreeCAD. L'historique complet reste dans le fichier `.vibecad`.
- Un STEP importé n'apporte pas les esquisses ni les étapes de construction d'origine.
- Le STL ne contient pas d'unité : le fichier est en millimètres (préférer le 3MF).
