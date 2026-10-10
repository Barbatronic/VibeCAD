# Vérifier les exports STEP dans FreeCAD

## Ce qui a été vérifié

Avec **FreeCAD 1.1.4** (AppImage officielle, mode console `freecadcmd`), les fichiers STEP
produits par VibeCAD s'importent ainsi :

| Fichier | Objet FreeCAD | Solides | Valide | Volume (mm³) | Boîte englobante (mm) |
| --- | --- | --- | --- | --- | --- |
| Plaque percée 60 × 30 × 5, Ø 6 | « Plaque percée » (Part::Feature) | 1 | oui | 8 858,6283 | 0,0,0 → 60,30,5 |
| Même plaque, largeur passée à 80 mm | « Plaque percée » | 1 | oui | 11 858,6283 | 0,0,0 → 80,30,5 |
| Export depuis l'interface (parcours) | « Pièce 1 » | 1 | oui | 8 858,6283 | 0,0,0 → 60,30,5 |
| Seconde pièce exportée seule | « Cale » | 1 | oui | 2 250 | 70,0,0 → 85,15,10 |
| Pièce créée hors ligne | « Pièce 1 » | 1 | oui | 6 400 | 0,0,0 → 40,20,8 |

Le volume attendu tient compte du perçage : 60 × 30 × 5 − π × 3² × 5 = 8 858,6283 mm³.
Les noms accentués (« Plaque percée ») sont conservés.

## Refaire la vérification

1. Télécharger l'AppImage de FreeCAD (≥ 1.0) : <https://github.com/FreeCAD/FreeCAD/releases>,
   puis la rendre exécutable (`chmod +x FreeCAD_*.AppImage`).
2. Lancer le test automatique, qui exporte les plaques puis les ouvre dans FreeCAD sans
   interface graphique :
   ```bash
   FREECAD_APPIMAGE=~/Téléchargements/FreeCAD_1.1.4-Linux-x86_64-py311.AppImage npm run verify:freecad
   ```
   (avec une installation classique de FreeCAD : `FREECAD_CMD=freecadcmd npm run verify:freecad`).
3. Les fichiers vérifiés restent dans `tests/output/` (`plaque-percee-60.step`,
   `plaque-percee-80.step`) pour une ouverture manuelle.

Vérifier un fichier quelconque :

```bash
QT_QPA_PLATFORM=offscreen ./FreeCAD.AppImage freecadcmd scripts/freecad/check_step.py chemin/fichier.step
```

## Dans FreeCAD (interface graphique)

**Fichier → Importer…** puis choisir le fichier `.step`. Chaque pièce devient un objet « Part »
nommé et coloré. On peut le mesurer, le modifier par de nouvelles opérations (par exemple dans
l'atelier Part Design, avec une « Base Feature »), ou l'exporter vers d'autres formats.
L'historique de VibeCAD (esquisses, cotes) n'est pas transmis : il reste dans le fichier
`.vibecad`.
