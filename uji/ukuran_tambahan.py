"""Ukuran tambahan untuk dua uji presisi naskah (Subbab 4.3.9, Tabel 4.8).

Jalankan dari akar repositori (perlu riwayat git untuk aturan lama):

    python uji/ukuran_tambahan.py > uji-naskah/2026-10-31/ukuran_tambahan.json

Ukuran yang dihitung:
1. Definisi ketat buku kode versi 2026-10-31 diterapkan pada jalur khusus uji pertama
   (label ulang di uji-naskah/2026-10-30/label_ulang_jk_v1031.csv): perilaku anggota
   yang judulnya menyebut sudah diperiksa, diamankan, atau ditahan Propam semestinya Tercatat.
2. Sensitivitas jalur khusus: dari keluhan tentang polisi atau perkara yang semestinya masuk
   jalur khusus, berapa yang memang masuk.
3. Perkara anggota yang sudah ditangani (uji kedua): ketepatan, kemampuan mengenali, dan status.
4. Status berbiaya tinggi termasuk Darurat.
5. Cek kebocoran aturan: kata kunci baru versi 2026-10-31 yang muncul di judul sampel uji kedua
   tetapi tidak di data uji pertama.
"""
import csv
import json
import math
import re
import subprocess

U1, U2 = "uji-naskah/2026-10-30", "uji-naskah/2026-10-31"
KELUHAN = ("keluhan_polisi", "keluhan_perkara")


def wilson(k, n, z=1.96):
    if n == 0:
        return {"pembilang": k, "penyebut": n}
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return {"pembilang": k, "penyebut": n, "nilai": round(p, 4),
            "wilson95": [round(max(0, c - h), 4), round(min(1, c + h), 4)]}


def baca(folder):
    return list(csv.DictReader(open(f"{folder}/label_presisi.csv", encoding="utf-8")))


u1, u2 = baca(U1), baca(U2)
ulang = {r["id"]: r["L_status_v1031"] for r in csv.DictReader(open(f"{U1}/label_ulang_jk_v1031.csv", encoding="utf-8"))}
for x in u1:
    if x["id"] in ulang:
        x["L_status"] = ulang[x["id"]]

hasil = {}

# 1. Definisi ketat pada uji pertama
jk1 = [x for x in u1 if x["status"] == "JALUR KHUSUS"]
td1 = [x for x in u1 if x["status"] == "TINDAK"]
tepat = lambda xs: sum(x["L_status"] == "tepat" for x in xs)
hasil["uji1 jalur khusus, definisi uji kedua"] = wilson(tepat(jk1), len(jk1))
hasil["uji1 jalur khusus dan Tindak, definisi uji kedua"] = wilson(tepat(jk1) + tepat(td1), len(jk1) + len(td1))
daftar1 = [x for x in u1 if x["status"] in ("JALUR KHUSUS", "TINDAK", "PANTAU", "DARURAT")]
hasil["uji1 presisi daftar tindak lanjut, definisi uji kedua"] = wilson(tepat(daftar1), len(daftar1))


# 2. Sensitivitas jalur khusus
def sensitivitas(rows):
    semestinya = [x for x in rows if x["L_jenis"] in KELUHAN and (
        (x["status"] == "JALUR KHUSUS" and x["L_status"] == "tepat") or
        (x["status"] != "JALUR KHUSUS" and x["L_status"] == "terlalu_rendah"))]
    masuk = [x for x in semestinya if x["status"] == "JALUR KHUSUS"]
    return wilson(len(masuk), len(semestinya)), sorted(x["id"] for x in semestinya if x["status"] != "JALUR KHUSUS")


for nama, rows in (("uji1", u1), ("uji2", u2)):
    w, luput = sensitivitas(rows)
    hasil[f"{nama} sensitivitas jalur khusus"] = w
    hasil[f"{nama} keluhan yang luput dari jalur khusus"] = luput

# 3. Perkara anggota yang sudah ditangani (label: keluhan tentang polisi yang semestinya Tercatat)
sudah = [x for x in u2 if x["L_jenis"] == "keluhan_polisi" and (
    (x["status"] == "TERCATAT" and x["L_status"] == "tepat") or
    (x["status"] != "TERCATAT" and x["L_status"] == "terlalu_tinggi"))]
dikenali = [x for x in u2 if x["jenis_khusus"] == "anggota_ditangani"]
hasil["uji2 anggota_ditangani tepat"] = wilson(sum(x["L_status"] == "tepat" for x in dikenali), len(dikenali))
hasil["uji2 anggota sudah ditangani dikenali"] = wilson(sum(x["jenis_khusus"] == "anggota_ditangani" for x in sudah), len(sudah))
hasil["uji2 anggota sudah ditangani berstatus tepat"] = wilson(sum(x["status"] == "TERCATAT" for x in sudah), len(sudah))
hasil["uji2 anggota sudah ditangani tidak dikenali"] = sorted(x["id"] for x in sudah if x["jenis_khusus"] != "anggota_ditangani")

# 4. Status berbiaya tinggi termasuk Darurat
mahal = [x for x in u2 if x["status"] in ("JALUR KHUSUS", "TINDAK", "DARURAT")]
hasil["uji2 jalur khusus, Tindak, dan Darurat"] = wilson(tepat(mahal), len(mahal))


# 5. Cek kebocoran aturan
def kata_kunci(teks):
    out = set()

    def jalan(o, kunci=""):
        if isinstance(o, dict):
            for k, v in o.items():
                if k != "catatan":
                    jalan(v, k)
        elif isinstance(o, list):
            for v in o:
                if isinstance(v, str):
                    out.add(v.lower())
                else:
                    jalan(v, kunci)
    jalan(json.loads(teks))
    return out


lama = kata_kunci(subprocess.check_output(["git", "show", "c7dfc9a^:config/topik.json"], text=True))
baru = kata_kunci(open("config/topik.json", encoding="utf-8").read()) - lama
judul2 = [(x["judul"] + " " + x["judul_lain"]).lower() for x in u2]
data1 = [open(f"{U1}/kasus_terkini.json", encoding="utf-8").read().lower(),
         open(f"{U1}/arsip_kasus.csv", encoding="utf-8").read().lower()]


def ada(k, teks):
    p = re.compile(r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])")
    return any(p.search(t) for t in teks)


hasil["kebocoran: kata kunci baru"] = len(baru)
hasil["kebocoran: hanya muncul di judul sampel uji kedua"] = sorted(k for k in baru if ada(k, judul2) and not ada(k, data1))
hasil["_catatan"] = ("Definisi mengikuti uji/buku_kode.md versi 2026-10-31. Label status uji pertama untuk 13 kasus jalur "
                     "khusus dinilai ulang dengan definisi itu (alasan per kasus di label_ulang_jk_v1031.csv); label lain "
                     "tidak diubah. Semua label, termasuk label ulang tersebut, dibuat dengan bantuan model bahasa besar.")
print(json.dumps(hasil, ensure_ascii=False, indent=1))
