# Fabrication

L'onglet **Fabrication** (à côté de Pièces et Assemblage) prépare les fichiers pour fabriquer ce
qui a été conçu. Les réglages sont enregistrés dans le projet (champ `fabrication` du fichier
`.vibecad`) et entrent dans Annuler / Rétablir.

## Impression 3D (3MF)

- Une ligne par pièce ayant un volume : **nombre d'exemplaires** (0 = ne pas imprimer),
  **échelle** (%), et **face du dessous** : un clic sur une face plate de la pièce la pose sur le
  plateau (la pièce est retournée en conséquence). « orientation d'origine » annule ce choix.
- **Plateau** : taille X × Y × hauteur (220 × 220 × 250 mm par défaut). Les exemplaires sont
  rangés en lignes, espacés de 5 mm. Un avertissement apparaît si une pièce est plus grande que le
  plateau ou si tout ne tient pas.
- **Matière** : estimation pour des pièces pleines en PLA (1,24 g/cm³). Le logiciel d'impression,
  avec son remplissage, en utilisera moins.
- **Exporter le plateau (3MF)** : un objet par exemplaire, à sa place, orienté et mis à
  l'échelle, en millimètres, avec le nom et la couleur de la pièce.

## Découpe laser (SVG, DXF)

- Pour chaque pièce plate (une extrusion de l'épaisseur du matériau) : **nombre d'exemplaires**
  et **face du contour** (par défaut la plus grande face plate ; un clic sur une autre face plate
  la remplace). L'épaisseur de la pièce est affichée et comparée à celle du **matériau**.
- **Trait de coupe (kerf)** : le contour extérieur est décalé vers l'extérieur et les trous vers
  l'intérieur de la moitié du trait, pour que les pièces découpées aient la bonne taille.
- **Plaque** : largeur × hauteur (600 × 400 mm par défaut), espace entre les pièces (4 mm). Les
  pièces sont rangées en lignes ; quand une plaque est pleine, on passe à la suivante (plaques
  posées côte à côte dans le fichier, séparées de 20 mm). Aperçu de la première plaque.
- **Export** à l'échelle 1:1 en millimètres : SVG (traits rouges de 0,1 mm = découpe, textes
  bleus = gravure du nom des pièces si demandé) et DXF R12 (polylignes fermées sur le calque
  `DECOUPE` en rouge, textes sur le calque `GRAVURE` en bleu), lisibles par LightBurn, Inkscape,
  LibreCAD et la plupart des logiciels de découpe.
- Les contours viennent du maillage d'affichage (écart à la forme exacte inférieur à 0,1 mm) : les
  arcs sont des suites de petits segments.

## Prévu

- Documents : gabarit papier 1:1 (PDF), mise en plan cotée, nomenclature de l'assemblage.
