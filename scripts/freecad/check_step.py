# Vérification d'un fichier STEP dans FreeCAD, sans interface graphique.
# Utilisation : freecadcmd scripts/freecad/check_step.py chemin/vers/fichier.step
# Affiche une ligne « RESULT_JSON [...] » : pour chaque objet importé, son nom, le nombre de
# solides, la validité, le volume (mm³) et la boîte englobante (mm).
import sys, json
import FreeCAD, Import

path = sys.argv[-1]
doc = FreeCAD.newDocument("verification")
Import.insert(path, doc.Name)
doc.recompute()
out = []
for o in doc.Objects:
    if hasattr(o, "Shape") and not o.Shape.isNull() and o.Shape.Solids:
        s = o.Shape
        bb = s.BoundBox
        out.append({
            "label": o.Label,
            "solids": len(s.Solids),
            "valid": s.isValid(),
            "volume": round(s.Volume, 4),
            "bbox": [round(v, 4) for v in (bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax)],
        })
print("RESULT_JSON " + json.dumps(out, ensure_ascii=False))
