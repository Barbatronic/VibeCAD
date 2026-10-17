# Ouvre un document .FCStd et résume ses objets (formes, volumes, placements) en JSON.
import sys, json
import FreeCAD as App

path = sys.argv[-1]
doc = App.openDocument(path)
doc.recompute()
objects = []
for o in doc.Objects:
    shape = getattr(o, "Shape", None)
    objects.append({
        "type": o.TypeId,
        "label": o.Label,
        "valid": o.isValid(),
        "volume": shape.Volume if shape is not None and shape.Solids else 0,
        "position": [o.Placement.Base.x, o.Placement.Base.y, o.Placement.Base.z] if hasattr(o, "Placement") else None,
        "group": [g.Label for g in getattr(o, "Group", [])],
    })
print("RESULT_JSON " + json.dumps(objects))
