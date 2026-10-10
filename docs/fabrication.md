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

## Prévu

- Découpe laser : contour d'une face plate, compensation du trait de coupe, placement sur une
  plaque, export SVG et DXF.
- Documents : gabarit papier 1:1 (PDF), mise en plan cotée, nomenclature de l'assemblage.
