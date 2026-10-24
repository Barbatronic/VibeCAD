# Tôlerie et pliage

Secteur « Tôle » de l'onglet Pièces (niveau Intermédiaire) : des pièces faites d'une plaque fine
pliée — équerre, boîte, support, profilé en U — en métal (plieuse), en plastique (thermoplieuse) ou
en carton. La pièce garde sa **forme à plat** (le développé), qui se découpe au laser.

## Utilisation

![Capot en tôle d'acrylique 3 mm plié en U, fentes d'aération découpées après les plis](images/tolerie.png)

![La même pièce dépliée (outil Déplier) : développé à plat et lignes de pli à 90°](images/tolerie-deplie.png)

1. **Esquisse** : dessiner le contour de la tôle à plat (rectangle, contour quelconque, avec trous
   éventuels).
2. **Tôle** : choisir l'esquisse, le **matériau**, l'**épaisseur** et le **rayon des plis**. La
   tôle est posée au-dessus du plan de l'esquisse (ou en dessous).
3. **Trous, découpes, congés et chanfreins** : poches, perçages, formes retirées, coins arrondis
   ou chanfreinés… se font à plat ou **sur la pièce pliée** (esquisse posée sur une face pliée,
   arêtes d'un rebord) : la matière retirée est **reportée sur le développé**. Une étape qui retire
   de la matière dans l'arrondi d'un pli donne un avertissement (cette partie n'est pas reportée).
   Une étape qui ajoute de la matière après un pli n'est pas dans le développé : elle est signalée
   au pli suivant.
4. **Bord plié** : cliquer un ou plusieurs bords du dessus (ou du dessous) de la tôle dans la vue
   3D ; régler la **longueur du rebord** (partie droite après le pli), l'**angle**, le **sens**
   (vers le haut ou vers le bas) et, si besoin, un rayon propre à ce pli. Les quatre bords d'un
   rectangle donnent une boîte (coins ouverts).
5. **Pli** : dessiner un trait sur la tôle (esquisse sur sa face, ou sur le plan de son esquisse),
   puis « Pli » : choisir le **côté du trait qui se plie** (à gauche ou à droite en allant du premier
   au second point), l'angle, le sens et le rayon.
6. **Déplier** : bascule entre la pièce pliée et sa forme à plat ; les lignes de pli sont en
   tirets verts, avec l'angle et le sens (↑ vers le haut, ↓ vers le bas).
7. **Découpe laser** (onglet Fabrication) : une pièce pliée y est posée **à plat** ; le SVG et le
   DXF contiennent le contour (rouge) et les lignes de pli (tirets verts, calque `PLIAGE` du DXF),
   à marquer légèrement ou à désactiver selon la machine.

## Matériaux et limites

Les valeurs sont **indicatives** (atelier scolaire) : un essai sur une chute reste le meilleur
réglage. Un pli plus serré que le rayon minimal, ou plus ouvert que l'angle maximal, donne un
avertissement dans l'historique et l'aperçu.

| Matériau | Pliage | Épaisseurs courantes (mm) | Rayon minimal | Angle maximal | Facteur K (r ≈ t) |
| --- | --- | --- | --- | --- | --- |
| Acier doux | à froid | 0,5 ; 0,8 ; 1 ; 1,5 ; 2 | 1 × épaisseur | 160° | 0,42 |
| Inox | à froid | 0,5 ; 0,8 ; 1 ; 1,5 | 2 × épaisseur | 135° | 0,45 |
| Aluminium | à froid | 0,5 ; 1 ; 1,5 ; 2 ; 3 | 1,5 × épaisseur | 135° | 0,42 |
| Laiton | à froid | 0,5 ; 0,8 ; 1 | 1 × épaisseur | 160° | 0,44 |
| Acrylique (PMMA) | à chaud | 2 ; 3 ; 4 ; 5 | 1 × épaisseur | 135° | 0,5 |
| PETG | à chaud | 0,5 ; 1 ; 2 ; 3 | 1 × épaisseur | 160° | 0,5 |
| Polypropylène | à froid | 0,5 ; 0,8 ; 1 ; 2 | 0,5 × épaisseur | 180° | 0,5 |
| Carton | à froid | 0,5 à 3 | 0,5 × épaisseur | 180° | 0,5 |

## Calcul

- **Longueur développée** d'un pli d'angle θ, de rayon intérieur r, dans une tôle d'épaisseur t :
  θ · (r + K · t). La fibre neutre (ni étirée ni écrasée) est à K · t de la face intérieure. K
  dépend du rapport r / t : celui du tableau pour r ≈ t, plus petit pour un pli serré (0,33 au
  moins), 0,5 au-delà de r = 4 t ; toujours 0,5 pour les plastiques chauffés et le carton
  (`src/domain/sheet-metal.ts`).
- **Une seule source : la tôle à plat** (`src/features/sheet/fold.ts`). La pièce garde son
  développé et la liste de ses plis (ligne, côté plié, angle, rayon, K) ; la pièce pliée est
  reconstruite à chaque fois : la tôle est coupée à l'entrée et à la sortie de la bande de chaque
  pli ; la section à l'entrée tourne autour de l'axe du pli (l'arrondi : opération
  `revolveSection` du noyau) ; ce qui est au-delà de la bande est ramené sur la ligne puis tourné
  de l'angle du pli. Plusieurs plis : chaque morceau garde le placement des plis qui l'ont déplacé.
  Le développé est donc exact par construction.
- **Bord plié** : une languette de longueur « longueur développée + rebord » est ajoutée au plat
  le long du bord, puis pliée sur la ligne du bord.
- **Faces de la pièce pliée** : un morceau déplacé par un pli est réétiqueté au nom de ce pli
  (l'étape d'origine reste dans l'étiquette), et chaque rebord d'une même étape « Bord plié » a ses
  propres étiquettes : une esquisse posée sur une face pliée retrouve sa face sans ambiguïté, et un
  bord cliqué sur la pièce pliée est retrouvé sur la tôle à plat.
- **Étape faite après un pli** (`unfoldCut`) : la matière qu'elle retire (pièce d'avant moins pièce
  d'après : trou, poche, congé, chanfrein, découpe…) est découpée selon les morceaux plats ; chaque
  partie est ramenée à plat par le placement inverse de son morceau, puis retirée du développé.
  Les plis suivants repartent de ce développé et gardent ces retouches.
- Un pli qui traverse l'arrondi d'un pli précédent est **refusé** (on ne plie pas à travers un
  pli), avec l'étape en cause.
- **Export FreeCAD** : les étapes de tôlerie sont reprises comme formes figées.

## Validation

`tests/geometry/sheet-fold.test.ts` — tôle 100 × 40 × 2 : pli à 90° vers le haut (volume conservé
avec K = 0,5 ; rebord entre x = 62 et 64, de la hauteur attendue), vers le bas, profil en U (deux
plis), pli à 45°. `tests/geometry/sheet-metal.test.ts` — par l'historique : tôle, bord plié
(développé allongé de θ · (r + K t) + longueur, rebord à la bonne place), boîte (quatre bords en une
étape), pli sur un trait, avertissement de rayon, pli qui traverse un bord plié refusé, faces de
chaque rebord retrouvées, trou fait après le pli reporté sur le développé (et gardé par un pli
suivant), chanfrein et congé d'un coin de rebord reportés, trou qui touche un arrondi signalé,
format
natif relu à l'identique et conforme au schéma. `tests/unit/sheet-metal.test.ts` — longueur
développée, facteur K, limites, lignes de pli coupées au contour (trous compris).
`tests/e2e/sheet-metal.spec.ts` — dans l'application : tôle, pli sur un trait, bord plié cliqué
dans la vue, esquisse sur la face pliée et trou percé après le pli, avertissement de rayon,
dépliage (lignes et angles), export laser du développé (contour, trou) avec ses lignes de pli.

## Limites

- Les bords pliés se posent sur les bords de la tôle à plat (pas encore sur le bord d'un rebord).
- Pas de dégagement de coin automatique (les coins d'une boîte restent ouverts, sans entaille).
- Les plis se font sur toute la largeur de la tôle (pas de pli partiel sur une partie seulement).
