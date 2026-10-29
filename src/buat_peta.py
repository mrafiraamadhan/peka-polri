#!/usr/bin/env python3
"""Sekali jalan: mengubah GeoJSON 38 provinsi menjadi jalur SVG ringan (assets/peta_id.json).
Sumber batas: "Indonesia GeoJSON & TopoJSON Maps (38 Provinces)", denyherianto, CC BY 4.0.
Pemakaian: python3 src/buat_peta.py <berkas.geojson>"""
import json, sys
from pathlib import Path
from shapely.geometry import shape, Polygon, MultiPolygon

ROOT = Path(__file__).resolve().parents[1]
NAMA_KE_BPS = {"Papua": "94", "Papua Barat": "91", "Papua Pegunungan": "97", "Papua Selatan": "95",
               "Papua Tengah": "96", "Papua Barat Daya": "92"}
LON0, LAT0, K = 94.6, 6.4, 21.0   # proyeksi sederhana: 1 derajat = 21 satuan
W, H = round((141.2 - LON0) * K), round((LAT0 + 11.2) * K)

def proj(x, y):
    return ((x - LON0) * K, (LAT0 - y) * K)

def jalur(poly):
    out = []
    for ring in [poly.exterior] + list(poly.interiors)[:0]:
        pts = [proj(x, y) for x, y in ring.coords]
        if len(pts) < 4:
            continue
        s = "M" + " ".join(f"{x:.1f} {y:.1f}" for x, y in pts[:-1]) + "Z"
        out.append(s.replace(".0 ", " ").replace(".0Z", "Z"))
    return "".join(out)

g = json.load(open(sys.argv[1]))
hasil = {}
for f in g["features"]:
    nama = f["properties"]["PROVINSI"]
    kode = NAMA_KE_BPS.get(nama, f["properties"]["KODE_PROV"])
    geom = shape(f["geometry"]).buffer(0)
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    polys.sort(key=lambda p: -p.area)
    besar = polys[0].area
    simpan = []
    for p in polys:
        # buang pulau sangat kecil, tetapi pertahankan poligon terbesar tiap provinsi
        if p is not polys[0] and p.area < max(0.004, besar * 0.0015):
            continue
        q = Polygon([proj(x, y) for x, y in p.exterior.coords]).simplify(0.55, preserve_topology=True)
        if q.is_empty or q.area < 0.6 and p is not polys[0]:
            continue
        simpan.append(q)
    d = ""
    for q in simpan:
        pts = list(q.exterior.coords)
        d += "M" + " ".join(f"{x:.1f} {y:.1f}" for x, y in pts[:-1]) + "Z"
    c = polys[0].representative_point()
    cx, cy = proj(c.x, c.y)
    hasil[kode] = {"nama": nama.replace("Daerah Istimewa Yogyakarta", "DI Yogyakarta"), "d": d,
                   "cx": round(cx, 1), "cy": round(cy, 1)}
keluaran = {"viewBox": f"0 0 {W} {H}", "sumber": "Batas provinsi: Indonesia GeoJSON & TopoJSON Maps (38 Provinces), denyherianto, CC BY 4.0; disederhanakan.",
            "prov": hasil}
(ROOT / "assets" / "peta_id.json").write_text(json.dumps(keluaran, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(hasil), "provinsi;", (ROOT / "assets" / "peta_id.json").stat().st_size // 1024, "KB;", keluaran["viewBox"])
