# Architecture

Ce document décrit l'organisation du code, le flux des données et les mécanismes clés :
recalcul de l'historique, références persistantes, calcul en arrière-plan, tolérances,
annuler/rétablir, persistance et mode hors ligne.

## Principes

1. **Le modèle métier est la source de vérité.** Le document (pièces, fonctions, esquisses,
   contraintes, paramètres, ressources importées) est un objet JSON immuable. Les solides B-Rep
   et les maillages sont toujours **reconstruits** à partir de lui ; aucun objet du noyau n'est
   sérialisé. Les caches ne font jamais autorité.
2. **Vrai noyau B-Rep.** Open CASCADE (OCCT) compilé en WebAssembly construit les solides, les
   opérations booléennes, la tessellation et les échanges STEP. Le maillage sert uniquement à
   l'affichage et à l'export STL.
3. **Couches indépendantes.** Le domaine ne dépend ni du DOM, ni de Three.js, ni du noyau
   concret ; les fonctions géométriques ne connaissent que l'interface du noyau. Ces règles sont
   vérifiées automatiquement (`npm run lint:arch`).
4. **Interface toujours réactive.** Les calculs lourds s'exécutent dans un Web Worker ; les
   résultats obsolètes sont ignorés.

## Couches et dépendances

```text
                ui (Preact)          viewport (Three.js)
                     │                     │
                     └──────── app ────────┘        ← contrôleur, état, raccourcis
                               │
     ┌──────────────┬──────────┼───────────┬───────────────┐
 persistence      io        commands    geometry/client   tutorials
 (IndexedDB)  (.vibecad,   (annuler/     (protocole du
              STEP, STL)   rétablir)       worker)
                     │                      ┆ messages
                  features ◄────────── workers (worker de calcul)
         (définition, évaluation,           │
            panneau par fonction)      geometry/occt (adaptateur OCCT)
                     │                      │
                  sketch                geometry/kernel (interface)
                     │
                  domain ── math
```

| Dossier | Rôle | Ne dépend pas de |
| --- | --- | --- |
| `math/` | vecteurs, repères de plans, algèbre linéaire | tout le reste |
| `domain/` | modèle du document, opérations pures, unités, tolérances, statuts | DOM, Three.js, noyau, features |
| `sketch/` | contenu d'esquisse, solveur, profils fermés, accrochages, session d'édition | DOM, Three.js, noyau |
| `features/` | une fonction par dossier : `definition.ts` (domaine), `evaluate.ts` (via l'interface du noyau), `panel.tsx` (interface) ; moteur de recalcul `engine.ts` | adaptateur OCCT, viewport, app |
| `geometry/` | `kernel.ts` (interface documentée du noyau), `protocol.ts` (messages du worker), `client.ts` (côté interface) ; `occt/` (seul code qui connaît Open CASCADE) | ui, viewport |
| `sim/` | simulation : découpe en cubes, éléments finis, étude d'une pièce, matériaux, lancement dans le worker | tout le reste (fonctions pures sur des tableaux) |
| `workers/` | worker de calcul (`geometry.worker.ts`), service géométrique, worker de simulation (`sim.worker.ts`), modèle du service worker | ui, viewport |
| `io/` | format natif, ressources embarquées, STL | noyau concret, ui |
| `persistence/` | IndexedDB, sauvegarde automatique, fichiers (téléchargement, File System Access) | noyau, ui |
| `viewport/` | rendu Three.js : caméra, grille, pièces, esquisses, sélection | app, ui, noyau |
| `app/` | contrôleur (actions de l'utilisateur), état global, raccourcis, hors ligne | noyau concret |
| `ui/` | composants Preact | noyau concret |

## Flux d'une modification

```text
 clic / clavier ──► contrôleur (app/controller.ts)
                      │ 1. nouveau document immuable + entrée « annuler »
                      │ 2. sauvegarde automatique programmée (IndexedDB)
                      ▼
               GeometryClient.evaluate(document)          (fil principal)
                      │ postMessage — « le dernier gagne »
                      ▼
               Worker : GeometryService.evaluate          (thread de calcul)
                      │ RecomputeEngine : pièce par pièce, fonction par fonction
                      │   esquisse → solveur + profils (TS)
                      │   extrusion / poche → OcctKernel (prisme, booléen, analyse)
                      │ maillage du dernier solide valide (mis en cache)
                      ▼
               résultat : statuts, esquisses résolues, maillages, volumes
                      │
                      ▼
               état « display » → vue 3D, historique, bandeaux d'erreur
```

### Client du worker et résultats obsolètes

`geometry/client.ts` gère deux files indépendantes : les recalculs **validés** (prioritaires)
et les **aperçus** (paramètres en cours de saisie). Dans chaque file, une demande non encore
envoyée est remplacée par la suivante (« le dernier gagne ») et résolue avec `null`. Le
contrôleur ignore aussi tout résultat dont la révision du document n'est plus la courante.
Les maillages déjà reçus ne sont pas renvoyés : le client transmet les clés connues.

Les ressources importées (fichiers STEP embarqués, parfois volumineux) sont transmises une seule
fois au worker, identifiées par leur empreinte SHA-256.

## Recalcul de l'historique (`features/engine.ts`)

Chaque pièce est évaluée dans l'ordre de son historique. Chaque étape reçoit une **clé** :
`hash(clé précédente + type + paramètres + empreinte des ressources)`. Une étape dont la clé
existe déjà est reprise du cache ; modifier une cote de la première esquisse change donc la clé
de toutes les étapes suivantes, qui sont recalculées, tandis que modifier la dernière poche ne
recalcule qu'elle. Les étapes inutilisées depuis 4 recalculs sont libérées (mémoire WASM).

### Erreurs et étapes bloquées

| Situation | Statut de l'étape | Effet sur la suite |
| --- | --- | --- |
| Contour ouvert, ramifié, qui se croise | `error` sur l'extrusion / poche (avec les points à relier) | étapes suivantes `blocked` |
| Esquisse sans support (face disparue) | `error` sur l'esquisse (`SUPPORT_LOST`) | consommatrices `blocked` |
| Poche qui ne retire rien | `warning` | aucune |
| Volume séparé du reste | `warning` | aucune |
| Échec du noyau | `error` + détail technique replié | étapes suivantes `blocked` |

Les paramètres ne sont jamais modifiés par une erreur. L'interface affiche alors la **dernière
géométrie valide** en grisé, avec un bandeau qui nomme l'étape à corriger, et propose une action
de réparation (modifier l'esquisse, choisir un nouveau support, annuler la dernière action).

## Références persistantes (faces)

Une esquisse posée sur une face ne mémorise jamais un numéro de face ou de triangle. Elle
mémorise une **référence sémantique** :

| Référence | Signification |
| --- | --- |
| `{ featureId, role: 'end' }` | face d'arrivée de l'extrusion `featureId` (ex. le dessus de la plaque) |
| `{ featureId, role: 'start' }` | face de départ |
| `{ featureId, role: 'side', entityId: 'l3' }` | face latérale engendrée par le segment `l3` de l'esquisse |
| `{ featureId, role: 'imported', index: 4 }` | 5ᵉ face d'un solide importé (ordre de lecture du fichier embarqué, immuable) |
| `{ featureId, role: 'blend', index: 0 }` | 1ʳᵉ face arrondie ou biseautée créée par le congé / chanfrein `featureId` |

L'adaptateur OCCT **étiquette** chaque face qu'il crée (`BRepPrimAPI_MakePrism.FirstShape`,
`LastShape`, `Generated(arête)`), puis propage les étiquettes à travers chaque opération
booléenne grâce à l'historique d'OCCT (`Modified`, `IsDeleted`), y compris après la fusion des
faces coplanaires (`SimplifyResult`). Une face fusionnée porte plusieurs étiquettes ; la plus
ancienne dans l'historique sert de référence.

À la reconstruction, la référence est résolue en cherchant les faces qui portent l'étiquette :

- aucune face → `SUPPORT_LOST` : l'utilisateur choisit explicitement un nouveau support (le
  dessin et les cotes sont conservés) ;
- face non plane → `SUPPORT_NOT_PLANAR` ;
- plusieurs faces non coplanaires → `SUPPORT_AMBIGUOUS` (jamais de choix silencieux).

Le **repère** de l'esquisse sur la face est canonique : origine = projection de l'origine du
modèle sur le plan, axes alignés sur les vues standard (dessus, face, droite…). Les cotes « depuis
l'origine » gardent donc leur sens sur une face, et le repère ne dépend pas de la topologie.

### Arêtes (congés et chanfreins)

Une arête est mémorisée par la **paire de références de ses deux faces voisines**
(`EdgeRef = { faces: [FaceRef, FaceRef] }`). À la reconstruction, l'adaptateur cherche les arêtes
partagées par une face portant la première étiquette et une face portant la seconde ; aucune →
`EDGE_LOST` (choix explicite de nouvelles arêtes), jamais de repli silencieux. Les faces créées
par `BRepFilletAPI_MakeFillet` / `MakeChamfer` (`Generated(arête)`) reçoivent l'étiquette
`{ featureId, role: 'blend', index }`, et les étiquettes existantes sont propagées par `Modified`.
Côté affichage, le maillage transmet pour chaque arête la liste de ses faces voisines : un clic
sur une arête donne directement la paire d'étiquettes, sans recalcul.

Exemple : l'arête supérieure avant de la plaque est
`{ end de l'extrusion } ∩ { side de l'extrusion engendrée par le segment du bas }`. Si la largeur
passe de 60 à 80 mm, les deux faces existent toujours et le congé suit.

### Géométrie projetée dans une esquisse

L'outil Projeter reprend une arête de la pièce (segment, ou cercle d'axe perpendiculaire au plan)
sous forme d'élément `reference` de l'esquisse, désigné par sa paire de faces comme pour les
congés. Les arêtes proposées sont calculées à partir du maillage affiché (`app/projection.ts`),
limitées aux faces créées avant l'esquisse (pas de dépendance circulaire). À l'évaluation,
`features/sketch/evaluate.ts` relit l'arête exacte (`GeometryKernel.edgeCurves`) dans l'état de
la pièce juste avant l'esquisse, la projette, puis résout l'esquisse : ce qui est coté ou
contraint par rapport à elle suit la pièce.

## Chat assistant

`app/advice.ts` choisit, à partir de l'état réel (statuts des étapes, session d'esquisse, frise),
au plus un conseil : niveau (conseil, avertissement, erreur), phrase courte et action proposée
(ouvrir l'étape en cause, choisir un nouveau support, commencer une esquisse…). L'action n'est
exécutée que sur clic. Le dessin du chat (`ui/mascot-art.ts`) est fait de formes simples
partagées par l'interface (`ui/Mascot.tsx`) et par le générateur d'icônes
(`scripts/generate-icons.mjs`). Masquer / réduire le chat est une préférence de l'appareil
(IndexedDB, réglage `mascot`).

## Frise de l'historique (barre de retour)

`app/rollback.ts` mémorise, par pièce, la dernière étape active. Le contrôleur n'envoie au calcul
que les étapes actives (`rolledBackDocument`) ; le cache du moteur rend le déplacement de la
barre presque instantané. Une nouvelle étape s'insère juste après la barre, qui se place ensuite
après elle. Cet état n'est pas enregistré dans le fichier et n'entre pas dans Annuler / Rétablir.

## Esquisses et solveur

Le solveur (`sketch/solver.ts`) traite comme inconnues les coordonnées des points et les rayons.
Chaque contrainte fournit ses équations et leurs dérivées exactes. La méthode est un Newton à
pas de **norme minimale pondérée** : les variables peu contraintes bougent le moins possible, et
un poids élevé retient une variable (point glissé à la souris, coin d'ancrage d'une cote
modifiée). Le système est découpé en **composantes indépendantes** (un contour non relié aux
autres est résolu à part), ce qui garde le calcul rapide pour les grandes esquisses.

Après résolution, une réduction de Gauss-Jordan donne le **nombre de degrés de liberté** et les
éléments encore libres (affichés en bleu ; en vert quand tout est contraint). Avant d'ajouter une
contrainte, le solveur la classe : indépendante, **redondante** (refusée avec explication) ou
**en conflit** (refusée, la saisie est conservée).

La session d'édition (`sketch/session.ts`) est une machine à états pure, testée sans navigateur :
outils, accrochages, saisie au clavier, cotes, glisser, annuler/rétablir propres à l'esquisse.

## Tolérances (`domain/tolerances.ts`)

Les tolérances géométriques sont explicites et distinctes du pas de grille (aide au dessin) et de
la précision d'affichage :

| Constante | Valeur | Usage |
| --- | --- | --- |
| `TOLERANCES.linear` | 1 µm (1e-6 mm) | deux points plus proches sont confondus dans un profil |
| `TOLERANCES.solver` | 1e-9 mm | résidu maximal d'une contrainte satisfaite |
| `TOLERANCES.minLength` | 0,01 mm | plus petite cote ou profondeur acceptée |
| `TOLERANCES.maxLength` | 10 000 mm | garde-fou contre les fautes de frappe |
| `DISPLAY_DECIMALS` | 2 | arrondi des libellés de cotes |
| `INPUT_DECIMALS` | 3 | arrondi des valeurs saisies (au µm) |
| `DISPLAY_MESH` | flèche relative 0,15 % | maillage d'affichage seulement |

La validité d'une opération ne repose jamais sur l'aspect visuel : chaque résultat est vérifié
par `BRepCheck_Analyzer` (solide valide), le volume et le nombre de solides, et les tests
contrôlent les dimensions (boîtes englobantes, volumes, axes des perçages).

## Annuler / rétablir et historique paramétrique

Ce sont deux mécanismes distincts :

1. **L'historique paramétrique** (liste des fonctions de chaque pièce) fait partie du document et
   est enregistré dans le fichier.
2. **Annuler / rétablir** (`commands/history.ts`) conserve des instantanés immuables du document
   (partage structurel, aucune copie profonde). Restaurer un instantané rétablit paramètres,
   historique et, après recalcul (souvent servi par le cache), géométrie.

Pendant l'édition d'une esquisse, une pile annuler/rétablir propre à la session permet de revenir
sur chaque tracé ; « Terminer l'esquisse » enregistre une seule action dans la pile globale.
Pendant le réglage d'une extrusion ou d'une poche, rien n'est enregistré avant « Valider ».

## Persistance et hors ligne

- **IndexedDB** (`persistence/db.ts`) : projets enregistrés, sauvegarde automatique (environ une
  seconde après chaque modification), réglages. Au démarrage, une sauvegarde automatique plus
  récente que le dernier enregistrement est proposée en récupération.
- **Fichiers** : « Enregistrer sous… » télécharge un fichier `.vibecad` (ou l'écrit dans un
  fichier choisi avec la File System Access API si le navigateur la propose). Les exports STEP
  et STL sont téléchargés directement.
- **Service worker** (`workers/service-worker.template.js`, généré au build avec la liste exacte
  des fichiers) : met en cache l'application, l'aide, les licences et le noyau WASM. La barre
  d'état indique la progression puis « Hors ligne : prêt ». Une politique CSP interdit tout
  chargement externe en production, sauf la lecture des bibliothèques de composants hébergées sur
  GitHub (`raw.githubusercontent.com` : catalogue, fichiers, vignettes).

## Ce que fait chaque fichier clé

| Fichier | Contenu |
| --- | --- |
| `src/domain/model.ts` | types du document (pièces, fonctions, esquisses, contraintes, ressources) |
| `src/domain/document.ts` | opérations pures : ajouter, renommer, supprimer en cascade… |
| `src/features/registry.ts` | registre des définitions de fonctions |
| `src/features/evaluators.ts` | registre des évaluateurs (worker) |
| `src/ui/feature-panels.ts` | registre des panneaux de paramètres |
| `src/features/engine.ts` | moteur de recalcul et cache |
| `src/geometry/kernel.ts` | interface documentée du noyau |
| `src/geometry/occt/occt-kernel.ts` | implémentation Open CASCADE (étiquetage, booléens, STEP, maillage) |
| `src/io/native-format.ts` | sérialisation, validation, migrations du format `.vibecad` |
| `src/app/controller.ts` | actions de l'utilisateur et transactions |
