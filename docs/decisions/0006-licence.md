# 0006 — Licence du code : MIT (provisoire)

## Décision

Le code de VibeCAD est publié sous licence **MIT**. Les composants embarqués gardent leur
licence : OCCT (LGPL 2.1 + exception), three.js (MIT), Preact (MIT).

## Raisons

- Licence libre, courte, compatible avec un usage éducatif et avec la LGPL du noyau chargé
  dynamiquement (fichier WASM séparé et remplaçable).
- Permet à d'autres établissements de reprendre le projet sans formalité.

## Alternative

Une licence à réciprocité (GPL 3 ou LGPL 2.1+, comme FreeCAD) garantirait que les versions
modifiées restent libres. Le choix final appartient au commanditaire : il suffit de remplacer
`LICENSE` et le champ `license` de `package.json` tant qu'il n'y a pas d'autres contributeurs.
