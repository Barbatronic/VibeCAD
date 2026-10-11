# 0007 — Nom de l'application : VibeCAD

## Décision (confirmée par le commanditaire le 11 octobre 2026)

L'application s'appelle **VibeCAD** (cette orthographe, ces majuscules), comme le dossier du
projet.

Le nom est défini une seule fois (`APP_NAME` dans `src/meta.ts`) et repris par l'interface, l'aide,
le champ `generator` des fichiers enregistrés et des exports 3MF, ainsi que par le manifeste PWA
(`public/manifest.webmanifest`) et `index.html`.

## Identifiants techniques

Les identifiants techniques portent le même nom, en minuscules :

| Identifiant | Valeur |
| --- | --- |
| format natif (champ `format`) et extension | `vibecad`, `.vibecad` |
| type MIME | `application/vnd.vibecad+json` |
| base IndexedDB (projets, sauvegardes automatiques) | `vibecad` |
| caches du mode hors ligne | préfixe `vibecad-` |
| schéma JSON | `docs/vibecad.schema.json` |
| paquet npm | `vibecad` |
