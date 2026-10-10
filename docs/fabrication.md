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

## Documents (PDF, SVG, CSV)

- **Mise en plan cotée** : pour la pièce choisie (dans la liste ou d'un clic dans la vue 3D), vue
  de face, vue de dessus (en dessous) et vue de gauche (à droite), en projection européenne, sur
  une page A4 paysage. Arêtes vues en traits continus, arêtes cachées en traits interrompus,
  contours apparents des faces courbes (cylindres, révolutions). Cotes d'encombrement (largeur et
  hauteur sur la vue de face, profondeur sur la vue de dessus), liste des diamètres (Ø) et rayons
  (R), cartouche (nom de la pièce, du projet, échelle normalisée : 10:1 … 1:100). Aperçu dans le
  panneau de droite ; export PDF (une page par pièce) ou SVG (la pièce affichée).
- **Gabarit 1:1** (PDF) : le contour d'une face plate de chaque pièce (celle choisie pour la
  découpe laser, sinon la plus grande, de préférence celle du dessus), à taille réelle, centré sur
  une page A4 (ou A3 si besoin), avec un trait de contrôle de 50 mm : imprimer en « taille
  réelle » puis vérifier ce trait à la règle. Une pièce plus grande qu'un A3 est signalée.
- **Nomenclature** : les pièces de l'assemblage avec leur nombre d'exemplaires (ou, sans
  assemblage, une ligne par pièce), leur encombrement et leur volume ; tableau à l'écran et export
  CSV (séparateur « ; », UTF-8) qui s'ouvre directement dans un tableur.
- Les traits viennent du maillage d'affichage : les courbes sont des suites de petits segments
  (écart inférieur à 0,1 mm). Le PDF est écrit par VibeCAD lui-même (police Helvetica, sans
  dépendance).
