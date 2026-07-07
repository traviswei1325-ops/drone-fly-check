#!/usr/bin/env python3
"""Build parks.js (national-park boundary polygons) for the fly-check page.

Reads data/parks-index.csv — the 內政部國家公園署 layer index from data.gov.tw
dataset 174421 ("國家公園地理資訊圖層彙整") — downloads one boundary/zoning
SHP per park from TGOS, unions the polygons into a clean outline, simplifies,
and writes parks.js defining window.PARK_ZONES.

Source-data quirks handled here: DBF attribute tables are Big5; some zips
carry no .prj (assume TWD97 TM2, EPSG:3826 — override per pick if needed);
陽明山 ships a .rar inside the .zip (extracted with bsdtar); some boundaries
are POLYLINE rings that need polygonizing.

Needs pyshp + pyproj + shapely (not stdlib):
  python3 -m venv .venv && .venv/bin/pip install pyshp pyproj shapely
  .venv/bin/python build-parks.py
Downloads are cached in data/parks/.
"""
import csv
import io
import json
import os
import re
import subprocess
import tempfile
import urllib.parse
import zipfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, "data", "parks-index.csv")
CACHE = os.path.join(HERE, "data", "parks")
OUT = os.path.join(HERE, "parks.js")

# park label -> File_Name entries in the index (newest boundary layer;
# 台江 needs land + sea zoning files combined)
PICKS = {
    "墾丁國家公園": ["墾丁國家公園細部計畫圖(SHP)(第4次通盤檢討)"],
    "玉山國家公園": ["玉山國家公園範圍圖(SHP)(第4次通盤檢討)"],
    "陽明山國家公園": ["陽明山國家公園計畫範圍圖(SHP)(第4次通盤檢討)"],
    "太魯閣國家公園": ["太魯閣國家公園計畫圖(SHP)(第3次通盤檢討)"],
    "雪霸國家公園": ["雪霸國家公園計畫分區圖(SHP)(第3次通盤檢討)"],
    "金門國家公園": ["金門國家公園計畫範圍圖(SHP)(第3次通盤檢討)"],
    "東沙環礁國家公園": ["東沙環礁國家公園計畫圖(SHP)(第2次通盤檢討)"],
    "澎湖南方四島國家公園": ["澎湖南方四島國家公園計畫圖(SHP)"],
    "台江國家公園": ["台江國家公園陸域土地使用分區圖(SHP)",
                 "台江國家公園海域土地使用分區圖(SHP)"],
    "壽山國家自然公園": ["壽山國家自然公園計畫範圍圖(SHP)(第1次通盤檢討)"],
}

# Fallback CRS when a shapefile has no .prj and coords look like meters.
# TWD97 TM2 zone 121 (EPSG:3826) covers the main island; 澎湖/金門/馬祖 use
# zone 119 (EPSG:3825).
FALLBACK_EPSG = {"金門國家公園": 3825, "澎湖南方四島國家公園": 3825}
DEFAULT_METER_EPSG = 3826

SIMPLIFY_DEG = 0.0005  # ~50 m — plenty for a warning layer


def load_index():
    with open(INDEX, encoding="utf-8-sig") as f:
        return {r["File_Name"]: r["File_URL"] for r in csv.DictReader(f)}


def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    safe = re.sub(r"[^\w.-]", "_", name) + ".zip"
    path = os.path.join(CACHE, safe)
    if not os.path.exists(path):
        print("  downloading", url.split("/")[-1])
        # curl instead of urllib: TGOS's cert chain fails Python 3.13+ SSL checks
        subprocess.run(
            ["curl", "-sSL", "--fail", "-A", "Mozilla/5.0", "--max-time", "180",
             "-o", path, urllib.parse.quote(url, safe=":/?&=%")],
            check=True)
    return path


def shp_groups_from_zip(path):
    """Yield dicts of {ext: BytesIO} for each shapefile in the zip,
    descending into nested .rar archives via bsdtar."""
    zf = zipfile.ZipFile(path)
    names = zf.namelist()

    def group(read, all_names, shp_name):
        base = shp_name[:-4]
        out = {}
        for ext in (".shp", ".dbf", ".shx", ".prj"):
            for n in all_names:
                if n.lower() == (base + ext).lower():
                    out[ext] = io.BytesIO(read(n))
        return out

    for shp_name in [n for n in names if n.lower().endswith(".shp")]:
        yield group(zf.read, names, shp_name)

    for rar_name in [n for n in names if n.lower().endswith(".rar")]:
        with tempfile.TemporaryDirectory() as td:
            rar_path = os.path.join(td, "inner.rar")
            with open(rar_path, "wb") as f:
                f.write(zf.read(rar_name))
            subprocess.run(["bsdtar", "-xf", rar_path, "-C", td], check=True)
            extracted = [os.path.join(dp, fn)
                         for dp, _, fns in os.walk(td) for fn in fns]
            for shp in [p for p in extracted if p.lower().endswith(".shp")]:
                g = group(lambda n: open(n, "rb").read(), extracted, shp)
                yield g


def shapes_from_zip(path, fallback_epsg):
    """Yield shapely geometries in WGS84 from every shapefile in the zip."""
    import shapefile
    from pyproj import CRS, Transformer
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform

    for g in shp_groups_from_zip(path):
        # attribute tables are Big5; we only use geometry, so decode loosely
        rdr = shapefile.Reader(shp=g.get(".shp"), dbf=g.get(".dbf"), shx=g.get(".shx"),
                               encoding="big5", encodingErrors="replace")
        if ".prj" in g:
            crs = CRS.from_wkt(g[".prj"].read().decode("utf-8", "replace"))
        elif abs(rdr.bbox[0]) > 360 or abs(rdr.bbox[1]) > 360:
            crs = CRS.from_epsg(fallback_epsg)
        else:
            crs = CRS.from_epsg(4326)
        tf = None
        if not crs.equals(CRS.from_epsg(4326)):
            tf = Transformer.from_crs(crs, CRS.from_epsg(4326), always_xy=True).transform
        for sr in rdr.iterShapes():
            if sr.shapeTypeName.startswith(("POLYGON", "POLYLINE")):
                geom = shape(sr.__geo_interface__)
                yield (shp_transform(tf, geom) if tf else geom), sr.shapeTypeName


def main():
    from shapely.ops import unary_union, polygonize
    from shapely.geometry import mapping

    index = load_index()
    features = []
    for park, file_names in PICKS.items():
        print(park)
        polys_in, lines_in = [], []
        for fn in file_names:
            fallback = FALLBACK_EPSG.get(park, DEFAULT_METER_EPSG)
            for geom, kind in shapes_from_zip(fetch(index[fn], fn), fallback):
                (polys_in if kind.startswith("POLYGON") else lines_in).append(geom)
        if lines_in:  # boundary drawn as rings — polygonize them
            polys_in.extend(polygonize(unary_union(lines_in)))
        if not polys_in:
            raise SystemExit(f"{park}: no polygons found — inspect the source zip")

        merged = unary_union(polys_in).simplify(SIMPLIFY_DEG).buffer(0)
        polys = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
        # drop slivers under ~0.1 km² to keep the file small
        polys = [p for p in polys if p.area > 1e-5] or polys
        for p in polys:
            gj = mapping(p)
            gj["coordinates"] = [
                [[round(x, 5), round(y, 5)] for x, y in ring]
                for ring in gj["coordinates"]
            ]
            features.append({
                "type": "Feature",
                "properties": {"name": park, "kind": "park"},
                "geometry": gj,
            })
        lng, lat = polys[0].representative_point().coords[0]
        print(f"  {len(polys)} polygon(s), sample point {lat:.3f},{lng:.3f}")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Generated by build-parks.py on %s — do not edit by hand.\n" % date.today())
        f.write("// Source: 內政部國家公園署 layers via TGOS (data.gov.tw dataset 174421).\n")
        f.write("window.PARK_ZONES = ")
        json.dump({"type": "FeatureCollection", "features": features}, f,
                  ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"wrote {OUT}: {len(features)} polygons, {os.path.getsize(OUT)//1024} KB")


if __name__ == "__main__":
    main()
