"""Sampel acak bertingkat untuk uji presisi PEKA (Subbab 4.3.9 naskah).

Pemakaian:  python uji/sampel_presisi.py <folder data> <keluaran.csv> [--sejak ISO-UTC]
--sejak: hanya kasus yang berita pertamanya terbit sesudah waktu itu (uji kedua memakai kasus yang belum pernah
dilihat saat aturan diperbaiki, yaitu sesudah data uji pertama dibekukan).
Benih acak diumumkan (BENIH) supaya siapa pun dapat menarik sampel yang sama dari data yang sama.
Lapisan: semua kasus Darurat, Jalur khusus, dan Tindak (sensus bila <= 60), 60 Pantau, 60 Tercatat.
Kasus pada uji/sampel_pengembangan.json dikeluarkan. Kolom label diisi pelabel memakai buku kode uji/buku_kode.md tanpa melihat kolom keluaran PEKA."""
import csv, json, random, sys
from pathlib import Path

BENIH = 20261030
KUOTA = {"DARURAT": 60, "JALUR KHUSUS": 60, "TINDAK": 60, "PANTAU": 60, "TERCATAT": 60}


def main(folder, keluar, sejak=None):
    k = json.loads((Path(folder) / "kasus_terkini.json").read_text(encoding="utf-8"))["kasus"]
    if sejak:
        k = [x for x in k if x["pertama"] > sejak]
    dev = Path(__file__).with_name("sampel_pengembangan.json")
    if dev.exists():   # kasus yang dibaca saat memperbaiki aturan tidak boleh ikut diuji
        keluar_id = set(json.loads(dev.read_text(encoding="utf-8"))["id"])
        k = [x for x in k if x["id"] not in keluar_id]
    acak = random.Random(BENIH)
    sampel = []
    for st, n in KUOTA.items():
        lapis = sorted([x for x in k if x["status"] == st], key=lambda x: x["id"])
        sampel += lapis if len(lapis) <= n else acak.sample(lapis, n)
    # sejak aturan 2026-10-31: perkara anggota yang sudah ditangani (berstatus Tercatat) ikut disensus
    ada = {x["id"] for x in sampel}
    sampel += sorted([x for x in k if x.get("jenis_khusus") == "anggota_ditangani" and x["id"] not in ada], key=lambda x: x["id"])
    kol = ["id", "status", "jenis_khusus", "topik", "kab", "polda", "penanggung_jawab", "tanggapan", "judul", "judul_lain",
           "L_relevan", "L_jenis", "L_lokasi", "L_status", "L_rute", "L_tanggapan", "L_catatan"]
    with open(keluar, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=kol)
        w.writeheader()
        for x in sampel:
            lok = x.get("lok") or {}
            w.writerow({"id": x["id"], "status": x["status"], "jenis_khusus": x.get("jenis_khusus") or "",
                        "topik": x["topik"], "kab": lok.get("kab") or lok.get("prov") or "", "polda": lok.get("polda") or "",
                        "penanggung_jawab": x["penanggung_jawab"], "tanggapan": (x.get("tanggapan") or {}).get("kata", ""),
                        "judul": x["judul"], "judul_lain": " || ".join(a["judul"] for a in x["artikel"][1:4])})
    print(len(sampel), "kasus ->", keluar)


if __name__ == "__main__":
    a = sys.argv[1:]
    sejak = a[a.index("--sejak") + 1] if "--sejak" in a else None
    main(a[0], a[1], sejak)
