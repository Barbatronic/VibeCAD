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
  plateau.
- **Plusieurs plateaux** : quand tout ne tient pas sur un plateau, les exemplaires suivants passent
  sur un nouveau plateau (calculé automatiquement, à imprimer l'un après l'autre). Les flèches
  « Plateau 1 sur N » choisissent le plateau affiché ; la matière est donnée pour ce plateau et
  pour l'ensemble.
- **Matière** : estimation pour des pièces pleines en PLA (1,24 g/cm³). Le logiciel d'impression,
  avec son remplissage, en utilisera moins.
- **Exporter le plateau (3MF)** : un objet par exemplaire, à sa place, orienté et mis à
  l'échelle, en millimètres, avec le nom et la couleur de la pièce. S'il y a plusieurs plateaux, le
  dialogue propose le plateau affiché, un autre, ou **tous** (un fichier 3MF par plateau).

## Découpe laser (SVG, DXF)

- **Matériaux** : une « page » par matériau (onglets du panneau de droite), avec son nom, son
  **épaisseur**, la taille de ses **plaques** et son **trait de coupe**. Quatre matériaux sont
  préréglés, en plaques de 300 × 200 mm : contreplaqué 3 mm et 5 mm (trait de 0,15 mm), acrylique
  3 mm et 5 mm (trait de 0,1 mm). À épaisseur égale, « Auto » choisit le contreplaqué ; l'acrylique
  se choisit pièce par pièce. « + » ajoute un matériau (carton, MDF…), « Supprimer » en retire un
  (il en reste toujours au moins un). Ces préréglages valent pour les nouveaux projets : un projet
  existant garde ses matériaux.
  Un même projet peut ainsi mélanger plusieurs matériaux et plusieurs épaisseurs.
- Pour chaque pièce plate (une extrusion de l'épaisseur du matériau) : **nombre d'exemplaires**,
  **matériau** (« Auto » par défaut : celui dont l'épaisseur est la plus proche de celle de la
  pièce) et **face du contour** (par défaut la plus grande face plate ; un clic sur une autre face
  plate la remplace). Un avertissement apparaît si l'épaisseur de la pièce diffère de celle du
  matériau choisi.
- **Trait de coupe (kerf)** : le contour extérieur est décalé vers l'extérieur et les trous vers
  l'intérieur de la moitié du trait, pour que les pièces découpées aient la bonne taille.
- **Plaques** : les pièces de chaque matériau sont rangées en lignes sur ses plaques, espacées de
  4 mm (une pièce trop longue est tournée d'un quart de tour) ; quand une plaque est pleine, on
  passe à la suivante. Aperçu de chaque plaque sur la page du matériau.
- **Optimiser** : imbrication serrée de toutes les pièces du matériau. Chaque pièce, élargie de la
  moitié de l'espacement, est tracée sur une grille (environ 400 cases sur le grand côté de la
  plaque) pour 4 orientations ; des plus grandes aux plus petites, elle est posée là où son haut
  reste le plus bas, puis le plus à gauche, sur la première plaque où elle tient. Une petite pièce
  peut se loger dans le trou d'une grande (`src/app/nesting.ts`).
- **Plaques en grand…** : la plaque à la taille de la fenêtre. Glisser une pièce la déplace ;
  **R** la tourne d'un quart de tour (Maj + R dans l'autre sens), l'angle se règle aussi au degré
  près ; les flèches la décalent de 1 mm (Maj : 10 mm) ; « Plaque » l'envoie sur une autre plaque
  (ou une nouvelle). Les pièces qui se chevauchent ou dépassent de la plaque sont en rouge, et
  comptées en bas. Molette : zoom ; glisser le fond : déplacer la vue ; « Tout voir » recadre.
  Le premier déplacement fige la disposition de toutes les pièces du matériau (champ facultatif
  `placements` du matériau dans le projet) ; une pièce ajoutée ensuite se loge autour des autres.
  « Ranger automatiquement » revient au rangement par rangées.
- **Export** à l'échelle 1:1 en millimètres, **un fichier par matériau** (ses plaques posées côte
  à côte, séparées de 20 mm ; boutons SVG / DXF de la page, ou « Exporter tout ») : SVG (traits rouges de 0,1 mm = découpe, textes
  bleus = gravure du nom des pièces si demandé) et DXF R12 (polylignes fermées sur le calque
  `DECOUPE` en rouge, textes sur le calque `GRAVURE` en bleu), lisibles par LightBurn, Inkscape,
  LibreCAD et la plupart des logiciels de découpe.
- Les contours viennent du maillage d'affichage (écart à la forme exacte inférieur à 0,1 mm) : les
  arcs sont des suites de petits segments.

## Documents (PDF, SVG, CSV)

- **Mise en plan cotée** : pour la pièce choisie (dans la liste ou d'un clic dans la vue 3D), vue
  de face, vue de dessus (en dessous) et vue de gauche (à droite), en projection européenne, sur
  une page A4 paysage. Arêtes vues en traits continus, arêtes cachées en traits interrompus,
  contours apparents des faces courbes (cylindres, révolutions). Les traits vus et cachés sont
  calculés exactement sur la forme (algorithme HLR d'Open CASCADE, dans le worker) : un trou vu
  de dessus est un vrai cercle. Pendant ce calcul, l'aperçu montre aussitôt des traits déduits du
  maillage, puis se met à jour ; les fichiers exportés attendent toujours la version exacte. Cotes d'encombrement (largeur et
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
