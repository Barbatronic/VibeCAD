# Export vers FreeCAD

La fenêtre « Exporter » propose deux formats pour FreeCAD (version 1.0 et suivantes).

## « FreeCAD » : un script qui reconstruit le projet, historique compris

VibeCAD écrit un script Python (`.py`). Dans FreeCAD : **Macro → Macros…**, choisir le dossier du
fichier, le sélectionner puis **Exécuter**. Le script crée un document, reconstruit le projet avec
les vrais outils de FreeCAD, puis l'enregistre en `.FCStd` à côté du script. On peut ensuite
changer une cote dans FreeCAD et recalculer, comme dans VibeCAD.

| VibeCAD | FreeCAD |
| --- | --- |
| Pièce | Corps Part Design (`PartDesign::Body`) |
| Esquisse | Esquisse Sketcher, placée comme dans VibeCAD : segments, cercles, arcs, ellipses, splines, points ; traits de construction ; arêtes projetées (construction, bloquées) |
| Contraintes et cotes | Coïncidence, horizontal, vertical, parallèle, perpendiculaire, égalité, colinéaire (parallèle + point sur), tangence, point sur, milieu (symétrie), longueur, distance, distances horizontale et verticale, diamètre, rayon, angle, distance point-droite |
| Extrusion | Protrusion (`Pad`) : longueur, sens inversé, symétrique, deux côtés |
| Poche | Cavité (`Pocket`) : profondeur ou à travers tout, sens inversé, symétrique |
| Révolution (ajout / creux) | Révolution / Rainure (`Revolution` / `Groove`) autour de l'axe X ou Y de l'esquisse ou d'un de ses segments |
| Congé, chanfrein | Congé, chanfrein (`Fillet`, `Chamfer`) ; les arêtes sont retrouvées par leur position |
| Perçage | Perçage (`Hole`) : diamètre, à travers tout ou profondeur, lamage ou fraisure à 90° |
| Répétition en ligne / en cercle | Répétition linéaire / circulaire, le long d'un axe, d'une arête ou d'un axe de construction |
| Symétrie | Symétrie (`Mirrored`) d'une étape, ou de toute la pièce, par un plan d'origine, une face ou un plan de construction |
| Forme toute faite | Primitive additive ou soustractive (boîte, cylindre, sphère, tore) |
| Plan, axe de construction | Plan, droite de référence |
| Paramètres du projet | Feuille de calcul « Parametres » ; les cotes et champs liés gardent leur équation (`Parametres.ep*2`) |
| Assemblage | Un lien placé (`App::Link`) par pièce insérée, regroupés par sous-assemblage, dans une pièce « Assemblage » ; les corps sont rangés dans « Pièces » |

**Étapes sans équivalent** (déplacer, découpe, coque, épaissir, dépouille, lissage, balayage,
générateurs d'engrenages, solide importé, extrusion jusqu'à une face, poche sur deux côtés, partie
commune, répétition en grille…) : elles sont reprises comme **forme figée**. La suite de la pièce
repart d'un nouveau corps posé sur la forme obtenue à ce point de l'historique (`BaseFeature`) ;
les esquisses dont elle a besoin y sont recréées. Une répétition ou une symétrie d'une étape
d'avant la forme figée est figée aussi. Une étape en erreur et les suivantes ne sont pas reprises.

Les liaisons de l'assemblage ne sont pas traduites : les pièces sont à leur place, sans
mécanisme. Les équations sont recopiées ; une équation qui vise un nom inconnu est remplacée par
sa valeur.

## « FCStd » : un document FreeCAD des formes finales

Un `.FCStd` qui s'ouvre d'un double-clic : une forme exacte par pièce (ou par pièce placée de
l'assemblage, rangées par bloc dans un groupe « assemblage »), avec son nom. Pas d'historique :
c'est l'équivalent du STEP, mais au format de FreeCAD.

## Vérification

`tests/geometry/freecad-export.test.ts` fait exécuter les scripts par FreeCAD (sans écran) et
compare le volume de chaque pièce reconstruite à celui de VibeCAD ; il ouvre aussi le `.FCStd`
pour contrôler les formes et leurs places. Il s'active avec une AppImage de FreeCAD :

```bash
FREECAD_APPIMAGE=~/FreeCAD.AppImage npx vitest run tests/geometry/freecad-export.test.ts
```

Sans FreeCAD, seule la génération est vérifiée.
