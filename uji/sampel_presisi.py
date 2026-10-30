"""Sampel acak bertingkat untuk uji presisi PEKA (Subbab 4.3.9 naskah).

Pemakaian:  python uji/sampel_presisi.py <folder data> <keluaran.csv>
Benih acak diumumkan (BENIH) supaya siapa pun dapat menarik sampel yang sama dari data yang sama.
Lapisan: semua kasus Darurat, Jalur khusus, dan Tindak (sensus bila <= 60), 60 Pantau, 60 Tercatat.
Kasus pada uji/sampel_pengembangan.json dikeluarkan. Kolom label diisi pelabel memakai buku kode uji/buku_kode.md tanpa melihat kolom keluaran PEKA."""
import csv, json, random, sys
from pathlib import Path

BENIH = 20261030
KUOTA = {"DARURAT": 60, "JALUR KHUSUS": 60, "TINDAK": 60, "PANTAU": 60, "TERCATAT": 60}


def main(folder, keluar):
    k = json.loads((Path(folder) / "kasus_terkini.json").read_text(encoding="utf-8"))["kasus"]
    dev = Path(__file__).with_name("sampel_pengembangan.json")
    if dev.exists():   # kasus yang dibaca saat memperbaiki aturan tidak boleh ikut diuji
        keluar_id = set(json.loads(dev.read_text(encoding="utf-8"))["id"])
        k = [x for x in k if x["id"] not in keluar_id]
    acak = random.Random(BENIH)
    sampel = []
    for st, n in KUOTA.items():
        lapis = sorted([x for x in k if x["status"] == st], key=lambda x: x["id"])
        sampel += lapis if len(lapis) <= n else acak.sample(lapis, n)
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
    main(sys.argv[1], sys.argv[2])
