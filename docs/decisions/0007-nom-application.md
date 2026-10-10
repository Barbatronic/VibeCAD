# 0007 — Nom de l'application : VibeCAD

## Décision (confirmée par le commanditaire le 10 octobre 2026)

L'application s'appelle **VibeCAD** (cette orthographe, ces majuscules). Ce nom remplace le nom
provisoire « VibeCAD » utilisé pendant le développement (c'est aussi le nom du dossier du projet).

Le nom est défini une seule fois (`APP_NAME` dans `src/meta.ts`) et repris par l'interface, l'aide,
le champ `generator` des fichiers enregistrés et des exports 3MF, ainsi que par le manifeste PWA
(`public/manifest.webmanifest`) et `index.html`.

## Identifiants techniques conservés

Pour que les projets et sauvegardes existants restent lisibles sans migration, les identifiants
techniques gardent l'ancien préfixe :

| Identifiant | Valeur conservée |
| --- | --- |
| format natif (champ `format`) et extension | `vibecad`, `.vibecad` |
| type MIME | `application/vnd.vibecad+json` |
| base IndexedDB (projets, sauvegardes automatiques) | `vibecad` |
| caches du mode hors ligne | préfixe `vibecad-` |
| schéma JSON | `docs/vibecad.schema.json` |

Les changer demanderait une migration explicite (lecture de l'ancienne base, conversion des
fichiers) : ce n'est pas justifié tant que ces noms restent invisibles pour l'utilisateur, à
l'exception de l'extension des fichiers.
