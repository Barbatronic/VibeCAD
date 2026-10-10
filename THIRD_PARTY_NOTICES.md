# Composants tiers et obligations de licence

L'application construite (`dist/`) embarque les composants suivants. La licence MIT du code
de VibeCAD **ne remplace pas** leurs licences : toute redistribution (copie du dossier `dist/`,
hébergement public, clé USB pour un atelier…) doit respecter les obligations ci-dessous.

| Composant | Version | Licence | Où il se trouve dans le build |
| --- | --- | --- | --- |
| Open CASCADE Technology (OCCT), compilé en WebAssembly | build `replicad-opencascadejs` 1.1.0 | LGPL 2.1 + exception Open CASCADE | `dist/assets/replicad_single-*.wasm` et code de liaison dans `dist/assets/geometry.worker-*.js` |
| replicad-opencascadejs (configuration de build OCCT → WASM) | 1.1.0 | LGPL 2.1 (`LGPL-2.1-only`) | idem |
| three.js | 0.186.1 | MIT | `dist/assets/index-*.js` |
| Preact | 10.29.8 | MIT | `dist/assets/index-*.js` |

Les textes de licence sont dans le dossier [`licenses/`](licenses/) :
[`LGPL-2.1.txt`](licenses/LGPL-2.1.txt), [`three.js-MIT.txt`](licenses/three.js-MIT.txt),
[`preact-MIT.txt`](licenses/preact-MIT.txt).

## Noyau géométrique Open CASCADE (LGPL 2.1)

### Provenance du fichier WASM

- Paquet npm : `replicad-opencascadejs@1.1.0` (publié le 2026-09-04), fichier
  `dist/replicad_single.wasm` (22 980 267 octets), empreinte du dépôt source
  `gitHead e4b05f67dc4e2393a876ce8c5064a9c93db05bf1`.
- Projet source de la configuration de build : <https://github.com/sgenoud/replicad>
  (dossier `packages/replicad-opencascadejs`), auteur Steve Genoud.
- Chaîne de compilation déclarée par le paquet : image Docker
  `ghcr.io/taucad/opencascade.js:canary-ebd263f1-single-threaded` (opencascade.js, outil de
  compilation d'OCCT vers WebAssembly : <https://github.com/donalffons/opencascade.js>, branche
  maintenue par TauCAD).
- Sources d'Open CASCADE Technology : <https://dev.opencascade.org> et
  <https://github.com/Open-Cascade-SAS/OCCT>. La version exacte d'OCCT est celle intégrée à
  l'image `canary-ebd263f1` ; pour la vérifier, consulter cette image ou reconstruire le paquet
  avec `npm run build` dans `packages/replicad-opencascadejs`.

### Obligations à respecter lors d'une redistribution

1. **Fournir la licence** : joindre `licenses/LGPL-2.1.txt` et ce fichier (ils sont copiés à la
   racine du dépôt ; les conserver à côté du dossier `dist/` redistribué).
2. **Donner accès aux sources** de la bibliothèque (OCCT et la configuration de build) : les
   liens ci-dessus. Pour une distribution publique, la LGPL demande que ces sources restent
   accessibles ; le plus sûr est d'en conserver une copie (archive des sources OCCT et du dépôt
   replicad à la version indiquée) à côté de l'application hébergée.
3. **Permettre le remplacement de la bibliothèque** : c'est assuré par l'architecture. Le noyau
   est un fichier WebAssembly séparé, chargé à l'exécution par le worker
   (`src/geometry/occt/loader.ts`) ; on peut le remplacer par une version recompilée ayant la
   même interface sans modifier le reste de l'application.
4. **Mentionner l'exception Open CASCADE** : OCCT est distribué sous LGPL 2.1 complétée par une
   exception (« Open CASCADE exception ») portant sur l'utilisation des fichiers d'en-tête. Son
   texte officiel est fourni avec les sources d'OCCT (fichier `OCCT_LGPL_EXCEPTION.txt`) et sur
   <https://dev.opencascade.org/resources/licensing>.

Ces points ne constituent pas un avis juridique ; ils décrivent la pratique habituelle pour une
bibliothèque LGPL chargée dynamiquement.

## Polices, icônes et ressources

Aucune police, icône ou ressource n'est chargée depuis Internet. L'interface utilise les polices
du système ; les icônes sont dessinées dans le code (`src/ui/icons.tsx`, licence MIT de VibeCAD).
