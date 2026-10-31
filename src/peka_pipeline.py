#!/usr/bin/env python3
"""PEKA (Pendengar Keluhan Warga) - pipeline pemantauan sumber terbuka.

Menjalankan enam langkah rancangan PEKA pada sumber yang boleh dibaca siapa pun:
  dengar    : berita daring (Google News RSS, cadangan Bing News RSS), volume berita
              GDELT 90 hari, gempa BMKG, dan daftar hoaks TurnBackHoax (MAFINDO)
  pilah     : buang duplikat, saring berita bertanda hoaks, beri topik dan lokasi,
              gabungkan berita tentang kejadian yang sama menjadi satu "kasus"
  timbang   : beri status Darurat / Tindak / Pantau / Tercatat / Jalur khusus
              dengan ambang tertulis (Tabel 4.5 naskah, disesuaikan untuk berita)
  teruskan  : tentukan penanggung jawab menurut wilayah (Polda, Polres)
  kabarkan  : periksa apakah tanggapan polisi sudah terlihat di pemberitaan
  arsipkan  : simpan ringkasan tanpa identitas per bulan untuk Pusat Sejarah Polri

Unggahan media sosial TIDAK dibaca dan tidak ada identitas orang yang disimpan.
Semua keluaran ditulis ke folder data/ dan dibaca oleh index.html.

Mode uji: PEKA_FIXTURE=<folder> membaca respons tersimpan, PEKA_NOW=<ISO> mengatur jam.
"""
import csv
import hashlib
import html
import json
import os
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode, urlparse
import xml.etree.ElementTree as ET

try:
    import requests
except ImportError:  # mode uji tanpa jaringan
    requests = None

ROOT = Path(__file__).resolve().parents[1]
CONF, DATA = ROOT / "config", ROOT / "data"
DATA.mkdir(exist_ok=True)
FIXTURE = os.environ.get("PEKA_FIXTURE")
NOW = datetime.fromisoformat(os.environ["PEKA_NOW"]) if os.environ.get("PEKA_NOW") else datetime.now(timezone.utc)
WIB = timezone(timedelta(hours=7))
JENDELA = timedelta(hours=72)       # kasus aktif: berita terakhir dalam 72 jam
SIMPAN = timedelta(days=4)          # artikel & kasus disimpan di cache 4 hari (jendela 72 jam + cadangan)
MIN_MEDIA_TINDAK = 3                # setara ">= 3 akun berbeda" pada Tabel 4.5
UA = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
}
LOG = []
STATUS_SUMBER = {}


def log(*a):
    msg = " ".join(str(x) for x in a)
    print(msg, flush=True)
    LOG.append(f"{datetime.now(timezone.utc):%H:%M:%S} {msg}")


def iso(t):
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if t else None


def dari_iso(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def slug(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:10]


def bersih(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def baca_json(nama, bawaan):
    f = DATA / nama
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return bawaan


def tulis_json(nama, isi, ringkas=False):
    teks = json.dumps(isi, ensure_ascii=False, separators=(",", ":")) if ringkas else json.dumps(isi, ensure_ascii=False, indent=1)
    (DATA / nama).write_text(teks, encoding="utf-8")


def catat_sumber(nama, ok, n=0, pesan="", berkas=""):
    STATUS_SUMBER[nama] = {"dicek_utc": iso(datetime.now(timezone.utc) if not FIXTURE else NOW),
                           "ok": bool(ok), "n": n, "pesan": pesan[:200], "berkas": berkas}


def ambil(url, fixture, timeout=30, percobaan=2, jeda=8):
    if FIXTURE:
        f = Path(FIXTURE) / fixture
        if f.exists():
            return f.read_bytes()
        raise FileNotFoundError(f"fixture {fixture} tidak ada")
    galat = None
    for i in range(percobaan):
        try:
            r = requests.get(url, headers=UA, timeout=timeout)
            r.raise_for_status()
            return r.content
        except Exception as e:  # noqa: BLE001
            galat = e
            time.sleep(jeda * (i + 1))
    raise galat


# ============================================================ konfigurasi
TOPIK = json.loads((CONF / "topik.json").read_text(encoding="utf-8"))
WIL = json.loads((CONF / "wilayah.json").read_text(encoding="utf-8"))
PROV = {p["kode"]: p for p in WIL["provinsi"]}
TOPIK_BY = {t["id"]: t for t in TOPIK["topik"]}


def regex_kata(kata):
    kata = sorted({k.lower() for k in kata}, key=len, reverse=True)
    return re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(k) for k in kata) + r")(?![a-z0-9])")


RE_TOPIK = [(t["id"], regex_kata(t["kata"]), regex_kata(t["kecuali"]) if t.get("kecuali") else None)
            for t in TOPIK["topik"]]
RE_POLISI = regex_kata(TOPIK.get("kata_polisi", ["polisi", "polri"]))
RE_TANGGAPAN = regex_kata(TOPIK["tanggapan"])
RE_JIWA = regex_kata(TOPIK["ancaman_jiwa"])
RE_BUKTI = regex_kata(TOPIK["bukti"])
RE_BERAT = regex_kata(TOPIK.get("korban_berat", ["-"]))
RE_HOAKS = regex_kata(TOPIK["hoaks"])
RE_BUKAN = regex_kata(TOPIK.get("bukan_keluhan", ["-"]))
RE_LUAR = regex_kata(TOPIK.get("luar_negeri", ["-"]))
RE_PERKARA = regex_kata(TOPIK.get("keluhan_perkara", ["-"]))      # keluhan atas penanganan perkara
RE_POLDA_LV = regex_kata(TOPIK.get("tingkat_polda", ["-"]))       # unit tingkat Polda disebut
RE_POLRES_LV = regex_kata(TOPIK.get("tingkat_polres", ["-"]))     # unit tingkat Polres/Polsek disebut
RE_POLSEK_LV = regex_kata(TOPIK.get("tingkat_polsek", ["-"]))
RE_POLRES_SAJA = regex_kata(TOPIK.get("tingkat_polres_saja", ["-"]))
RE_DESAK = regex_kata(TOPIK.get("desak", ["-"]))
RE_SUDAH = regex_kata(TOPIK.get("anggota_sudah_ditangani", ["-"]))  # perilaku anggota yang sudah diproses Propam/penyidik
# tujuan aduan ("lapor ke Propam Polda X") bukan tingkat satuan yang dikeluhkan
RE_TUJUAN_ADUAN = re.compile(r"(?:lapor|melapor|melaporkan|laporkan|mengadu|adukan|diadukan|dilaporkan)\s+(?:\S+\s+){0,3}?ke\s+(?:propam|paminal|bidpropam|divpropam)?\s*(?:mabes\s+)?(?:polri|polda(?:\s+\S+)?)", re.I)                  # tuntutan warga, bukan tanggapan polisi
RE_TOLAK = regex_kata(TOPIK.get("penolakan_laporan", ["-"]))
RE_KEKERASAN = regex_kata(TOPIK.get("kekerasan_aparat", ["-"]))
RE_TEGAS = regex_kata(TOPIK.get("tindakan_tegas", ["-"]))
RE_TEGAS_KONTEKS = regex_kata(TOPIK.get("tindakan_tegas_konteks", ["-"]))
RE_TEGAS_RAGU = regex_kata(TOPIK.get("tindakan_tegas_ragu", ["-"]))
RE_BUKAN_SIDANG = regex_kata(TOPIK.get("bukan_keluhan_kecuali_anggota", ["-"]))
VERSI_ATURAN = "2026-10-31"


def bukan_keluhan(judul, tid):
    """Kegiatan, sosialisasi, opini, statistik, dan berita persidangan bukan kejadian yang dikeluhkan.
    Berita persidangan tetap dipakai untuk topik perilaku anggota (sidang etik, putusan PTDH)."""
    j = (judul or "").lower()
    return bool(RE_BUKAN.search(j) or (tid != "anggota" and RE_BUKAN_SIDANG.search(j)))

STOP = set("""yang dengan untuk dari pada akan dalam karena ini itu oleh tidak juga saat usai jadi ada kata
kini masih sudah bisa para satu dua tiga empat lima orang pria wanita warga korban pelaku kasus polisi polri
polres polsek polda viral video soal bikin hingga terkait setelah sebelum begini berikut kronologi fakta
ternyata diduga sebut akhirnya terungkap terbaru hari minggu senin selasa rabu kamis jumat sabtu malam pagi
siang sore jalan kota kabupaten kab provinsi sejumlah usia tahun bulan pekan lalu baru lagi tengah atas bawah
bagi agar namun tapi serta atau antara sempat tetap belum lebih kurang buat sang anak ibu bapak""".split())


def token(teks):
    return {w for w in re.findall(r"[a-z0-9]+", (teks or "").lower()) if len(w) >= 4 and w not in STOP}


def mirip(a, b):
    if not a or not b:
        return 0.0
    i = len(a & b)
    return i / len(a | b) if i >= 2 else 0.0


# ------------------------------------------------------------ gazeter lokasi
PENANDA = r"(?:di|ke|dari|kota|kab\.?|kabupaten|polres(?:ta|tabes)?(?:\s+metro)?|polsek|warga|asal|wilayah|daerah)\s+"
ALIAS_KAB = {  # nama populer -> nama kab/kota di gazeter
    "Tangsel": "Kota Tangerang Selatan", "Jaksel": "Kota Jakarta Selatan", "Jaktim": "Kota Jakarta Timur",
    "Jakbar": "Kota Jakarta Barat", "Jakut": "Kota Jakarta Utara", "Jakpus": "Kota Jakarta Pusat",
    "Kukar": "Kabupaten Kutai Kartanegara", "Kutim": "Kabupaten Kutai Timur", "Kubar": "Kabupaten Kutai Barat",
    "Labuan Bajo": "Kabupaten Manggarai Barat", "Cikarang": "Kabupaten Bekasi", "Cibinong": "Kabupaten Bogor",
    "Timika": "Kabupaten Mimika", "Wamena": "Kabupaten Jayawijaya", "Sentani": "Kabupaten Jayapura",
    "Gunungkidul": "Kabupaten Gunung Kidul", "Kulonprogo": "Kabupaten Kulon Progo",
    "Bukittinggi": "Kota Bukittinggi", "Lubuklinggau": "Kota Lubuklinggau", "Bau-Bau": "Kota Baubau",
    "Pangkalpinang": "Kota Pangkal Pinang", "Tanjungpinang": "Kota Tanjung Pinang",
    "Deliserdang": "Kabupaten Deli Serdang", "Mamuju Utara": "Kabupaten Pasangkayu",
    "Talang Padang": "Kabupaten Tanggamus", "Madina": "Kabupaten Mandailing Natal", "Pessel": "Kabupaten Pesisir Selatan", "Malioboro": "Kota Yogyakarta", "Tanjung Perak": "Kota Surabaya", "Rengat": "Kabupaten Indragiri Hulu", "Batam": "Kota Batam",
}


def bangun_gazeter():
    pola = []  # (regex, prioritas, target)
    per_nama = defaultdict(list)
    for k in WIL["kabkota"]:
        per_nama[k["inti"].lower()].append(k)
    for nama, daftar in per_nama.items():
        kota = [k for k in daftar if k["jenis"] == "Kota"]
        pilih = kota[0] if kota else daftar[0]
        rawan = any(k["rawan"] for k in daftar)
        nm = re.escape(nama).replace(r"\ ", r"\s+")
        if rawan:
            rx = re.compile(r"(?<![a-z0-9])" + PENANDA + "(" + nm + r")(?![a-z0-9])", re.I)
        else:
            rx = re.compile(r"(?<![a-z0-9])(" + nm + r")(?![a-z0-9])", re.I)
        pola.append((rx, 2, {"kab": pilih, "semua": daftar}))
        # penanda jenis eksplisit: "Kabupaten X" / "Kab. X" vs "Kota X"
        for k in daftar:
            awal = r"(?:kabupaten|kab\.?)\s+" if k["jenis"] == "Kabupaten" else r"kota\s+"
            pola.append((re.compile(r"(?<![a-z0-9])" + awal + "(" + nm + r")(?![a-z0-9])", re.I), 3, {"kab": k, "semua": [k]}))
    nama_ke_kab = {k["nama"]: k for k in WIL["kabkota"]}
    for alias, nama in ALIAS_KAB.items():
        if nama in nama_ke_kab:
            pola.append((re.compile(r"(?<![a-z0-9])(" + re.escape(alias) + r")(?![a-z0-9])", re.I), 2,
                         {"kab": nama_ke_kab[nama], "semua": [nama_ke_kab[nama]]}))
    for p in WIL["provinsi"]:
        for a in p["alias"]:
            peka_huruf = a.isupper() and len(a) <= 4      # DIY, NTB, DKI: hanya huruf besar
            rx = re.compile(r"(?<![A-Za-z0-9])(" + re.escape(a).replace(r"\ ", r"\s+") + r")(?![A-Za-z0-9])",
                            0 if peka_huruf else re.I)
            pola.append((rx, 1, {"prov": p["kode"]}))
    return pola


GAZETER = bangun_gazeter()


def bangun_kecamatan():
    """Kecamatan sebagai petunjuk lokasi (judul berita sering hanya menyebut "Polsek Kajang" atau "di Carenang").
    Hanya nama kecamatan yang unik secara nasional, minimal 5 huruf, bukan nama kab/kota, dan didahului
    penanda tempat (di, Polsek, warga, desa, ...). Sumber: daftar kecamatan yang sama dengan gazeter kab/kota."""
    f = CONF / "districts.csv"
    if not f.exists():
        return None, {}
    per = defaultdict(set)
    for baris in csv.reader(f.open(encoding="utf-8")):
        if len(baris) >= 3:
            per[baris[2].strip().title()].add(baris[1].strip())
    kab_by = {k["kode"]: k for k in WIL["kabkota"]}
    inti = {k["inti"].lower() for k in WIL["kabkota"]} | {a.lower() for p in WIL["provinsi"] for a in p["alias"]}
    umum = {"barat", "timur", "utara", "selatan", "tengah", "kota", "pusat", "baru", "lama", "pasar", "pantai",
            "gunung", "sungai", "pulau", "kepulauan", "teluk", "tanjung", "batu", "air", "muara", "danau",
            # nama kecamatan yang juga kata umum dalam judul berita
            "simpang", "sumur", "negara", "pinggir", "rantau", "bandar", "karang", "tanah", "kampung", "pasir",
            "tambang", "sawah", "kebun", "hutan", "gudang", "istana", "merdeka", "damai", "sejahtera", "makmur",
            "harapan", "mekar", "sentosa", "indah", "permai", "lubuk", "kuala", "lembah", "bukit", "padang", "talang",
            "kelapa", "pinang", "durian", "melati", "mawar", "cempaka", "garuda", "rajawali", "pelabuhan", "terminal",
            "jalan", "rumah", "sekolah", "lapangan", "kantor", "perumahan", "pangkalan", "benteng", "kubu", "tapal",
            "batas", "hilir", "hulu", "ilir", "dalam", "luar", "lintas", "raya", "jaya", "agung", "mulia", "sakti",
            "panjang", "maron"}
    peta = {}
    for nama, kode in per.items():
        n = nama.lower()
        if len(kode) != 1 or len(n) < 5 or n in inti or n in umum:
            continue
        k = kab_by.get(next(iter(kode)))
        if k:
            peta[n] = k
    if not peta:
        return None, {}
    alt = "|".join(re.escape(n).replace(r"\ ", r"\s+") for n in sorted(peta, key=len, reverse=True))
    rx = re.compile(r"(?<![a-z0-9])(?:di|ke|dari|kecamatan|kec\.?|polsek|kapolsek|warga|desa|kelurahan|kampung|wilayah)\s+("
                    + alt + r")(?![a-z0-9])", re.I)
    return rx, peta


RE_KEC, KEC_KE_KAB = bangun_kecamatan()
TOK_TEMPAT = {w.lower() for w in ALIAS_KAB} | {w.lower() for p in WIL["provinsi"] for a in p["alias"] for w in a.split()} \
    | {"kabupaten", "kota", "kab"}


RE_TUJUAN = re.compile(r"(?:dipulangkan|dibawa|diterbangkan|dikirim|dimakamkan|dirujuk|diberangkatkan|pulang)\s+(?:ke|di)\s+$", re.I)
RE_TUJUAN2 = re.compile(r"(?:diamankan|dibawa|dipindahkan|digelandang|diterbangkan)(?:\s+\S+){0,4}\s+ke\s+$", re.I)
RE_POLDA_DEPAN = re.compile(r"(?:polda|kapolda|wakapolda)\s+$", re.I)  # "Polda Jambi" = provinsi, bukan Kota Jambi
RE_JALAN = re.compile(r"(?:jalan(?:\s+raya|\s+lintas)?|jl\.?(?:\s+raya)?|jln\.?|gang|gg\.?|simpang|tol|bandara|stasiun|terminal|pasar|rs|rsud|universitas|univ\.?)\s+$", re.I)


def lokasi(teks):
    """Lokasi pertama yang disebut. Kab/kota (lebih rinci) diutamakan daripada provinsi.
    Nama yang didahului 'Jalan', 'Tol', 'Pasar', dan sejenisnya diabaikan (nama jalan, bukan wilayah)."""
    temu = []
    teks = teks or ""
    for rx, prio, target in GAZETER:
        for m in rx.finditer(teks):
            if RE_JALAN.search(teks[max(0, m.start(1) - 14):m.start(1)]):
                continue
            if RE_TUJUAN.search(teks[max(0, m.start(1) - 20):m.start(1)]):
                continue
            if RE_TUJUAN2.search(teks[max(0, m.start(1) - 60):m.start(1)]):
                continue
            if "kab" in target and RE_POLDA_DEPAN.search(teks[max(0, m.start(1) - 12):m.start(1)]):
                continue
            temu.append((m.start(1), -prio, -(m.end(1) - m.start(1)), target))
    if RE_KEC is not None:
        for m in RE_KEC.finditer(teks):
            k = KEC_KE_KAB.get(re.sub(r"\s+", " ", m.group(1).lower()))
            if k:
                temu.append((m.start(1), -1, -(m.end(1) - m.start(1)), {"kab": k, "semua": [k]}))
    if not temu:
        return None
    kab = [t for t in temu if "kab" in t[3]]
    if kab:
        t = min(kab)[3]["kab"]
        p = PROV[t["prov"]]
        return {"kode_kab": t["kode"], "kab": t["nama"], "kode_prov": p["kode"], "prov": p["nama"],
                "polda": t["polda"], "polres": t["polres"]}
    t = min(temu)[3]
    p = PROV[t["prov"]]
    return {"kode_kab": None, "kab": None, "kode_prov": p["kode"], "prov": p["nama"], "polda": p["polda"], "polres": None}


def topik_dari(judul):
    j = (judul or "").lower()
    for tid, rx, kecuali in RE_TOPIK:
        m = rx.search(j)
        # pengecualian: "oknum anggota DPRD" bukan keluhan tentang anggota Polri, kecuali judulnya juga menyebut polisi
        if m and kecuali and kecuali.search(j) and not RE_POLISI.search(j):
            continue
        if m:
            return tid, m.group(1)
    return None, None


# ============================================================ DENGAR
def waktu_rss(teks):
    try:
        t = parsedate_to_datetime(teks)
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def domain(u):
    try:
        return urlparse(u).netloc.replace("www.", "")
    except Exception:
        return ""


def buang_ekor_media(judul):
    """'Judul berita - kumparan.com' -> 'Judul berita' (ekor nama situs yang tidak sama persis dengan nama media)."""
    m = re.search(r"\s+[-|]\s+([A-Za-z0-9][\w.\- ]{1,40})$", judul or "")
    if m and ("." in m.group(1) or len(m.group(1).split()) <= 3 and m.group(1)[:1].isupper() is False):
        return judul[:m.start()].strip()
    if m and "." in m.group(1):
        return judul[:m.start()].strip()
    return judul


def google_news(q, kurun="2d"):
    url = "https://news.google.com/rss/search?" + urlencode(
        {"q": f"{q} when:{kurun}", "hl": "id", "gl": "ID", "ceid": "ID:id"})
    root = ET.fromstring(ambil(url, f"gnews_{slug(q)}.xml"))
    hasil = []
    for it in root.findall("./channel/item"):
        judul = bersih(it.findtext("title"))
        src = it.find("source")
        media = (src.text or "").strip() if src is not None else ""
        if media and judul.endswith(" - " + media):
            judul = judul[: -len(media) - 3].strip()
        judul = buang_ekor_media(judul)
        hasil.append({"judul": judul, "url": (it.findtext("link") or "").strip(),
                      "media": media or "(tanpa nama media)", "terbit": waktu_rss(it.findtext("pubDate")),
                      "sumber": "Google News"})
    return hasil


def bing_news(q):
    url = "https://www.bing.com/news/search?" + urlencode({"q": q, "format": "rss", "setlang": "id", "cc": "ID"})
    root = ET.fromstring(ambil(url, f"bing_{slug(q)}.xml"))
    ns = {"News": "https://www.bing.com/news/search?q=&format=rss"}
    hasil = []
    for it in root.findall("./channel/item"):
        src = it.find("News:Source", ns)
        link = (it.findtext("link") or "").strip()
        hasil.append({"judul": buang_ekor_media(bersih(it.findtext("title"))), "url": link,
                      "media": (src.text or "").strip() if src is not None else domain(link),
                      "terbit": waktu_rss(it.findtext("pubDate")), "sumber": "Bing News"})
    return hasil


def dengar_berita():
    semua, ok_g, ok_b, galat = [], 0, 0, []
    kueri = [(t["id"], q) for t in TOPIK["topik"] for q in t["cari"]]
    for tid, q in kueri:
        try:
            r = google_news(q)
            ok_g += 1
        except Exception as e:  # noqa: BLE001
            galat.append(f"Google {tid}: {e}")
            try:
                r = bing_news(q)
                ok_b += 1
            except Exception as e2:  # noqa: BLE001
                galat.append(f"Bing {tid}: {e2}")
                r = []
        for a in r:
            a["kueri"] = tid
        semua += r
        if not FIXTURE:
            time.sleep(2)
    log(f"dengar berita: {len(semua)} artikel dari {len(kueri)} kueri (Google ok {ok_g}, Bing {ok_b})")
    catat_sumber("Berita daring (Google News RSS)", ok_g > 0, len(semua),
                 "; ".join(galat[:3]) if galat else f"{ok_g} dari {len(kueri)} kueri berhasil", "kasus_terkini.json")
    return semua


def gdelt_timeline(q, mulai, akhir):
    params = {"query": f"{q} sourcelang:indonesian", "mode": "timelinevolraw", "format": "json",
              "startdatetime": mulai.strftime("%Y%m%d%H%M%S"), "enddatetime": akhir.strftime("%Y%m%d%H%M%S"),
              "timelinesmooth": 0}
    raw = ambil("https://api.gdeltproject.org/api/v2/doc/doc?" + urlencode(params), f"gdelt_{slug(q)}.json",
                timeout=30, percobaan=1)
    teks = raw.decode("utf-8", "ignore").strip()
    if not teks.startswith("{"):
        # GDELT kadang menjawab HTTP 200 berisi teks "please limit requests"; perlakukan seperti 429
        raise RuntimeError(("429 " if "limit" in teks.lower() else "") + "jawaban GDELT bukan JSON: " + teks[:60])
    j = json.loads(teks)
    harian, total = defaultdict(int), defaultdict(int)
    for seri in j.get("timeline", []):
        for d in seri.get("data", []):
            hari = d["date"][:8]
            harian[hari] += int(d.get("value", 0))
            total[hari] += int(d.get("norm", 0))
    return harian, total


def dengar_gdelt():
    """Volume berita GDELT 90 hari per topik. GDELT membatasi permintaan (galat 429), terutama dari server
    bersama seperti GitHub Actions. Karena itu: tiap topik cukup diperbarui setiap 6 jam, topik yang paling
    lama tidak diperbarui didahulukan, putaran berhenti meminta begitu terkena 429, dan topik yang belum
    terbarui tetap memakai deret lama sehingga grafik tidak kosong."""
    lama = baca_json("gdelt_tren.json", {})
    akhir = NOW.replace(minute=0, second=0, microsecond=0)
    mulai = (akhir - timedelta(days=89)).replace(hour=0)
    hari = [(mulai + timedelta(days=i)).strftime("%Y%m%d") for i in range((akhir - mulai).days + 1)]
    keluaran = {"diperbarui_utc": iso(NOW), "hari": [f"{h[:4]}-{h[4:6]}-{h[6:]}" for h in hari], "topik": {}}
    lama_topik, lama_hari = lama.get("topik", {}), lama.get("hari") or []

    def pakai_lama(tid):
        if tid in lama_topik and lama_hari:
            L = lama_topik[tid]
            peta = dict(zip(lama_hari, L.get("artikel", [])))
            petat = dict(zip(lama_hari, L.get("total", [0] * len(lama_hari))))
            keluaran["topik"][tid] = {"artikel": [peta.get(h, 0) for h in keluaran["hari"]],
                                      "total": [petat.get(h, 0) for h in keluaran["hari"]], "lama": True,
                                      "diperbarui_utc": L.get("diperbarui_utc")}

    def umur(tid):
        t = (lama_topik.get(tid) or {}).get("diperbarui_utc")
        return NOW - dari_iso(t) if t else timedelta(days=999)

    perlu = [t for t in TOPIK["topik"] if FIXTURE or umur(t["id"]) >= timedelta(hours=6)]
    perlu.sort(key=lambda t: -umur(t["id"]).total_seconds())
    ok, galat, berhenti = 0, [], None
    mulai_jam = time.time()
    for t in TOPIK["topik"]:
        if t not in perlu:
            pakai_lama(t["id"])
    for t in perlu:
        if berhenti is None and time.time() - mulai_jam > 240:
            berhenti = "batas waktu putaran"
        if berhenti:
            galat.append(f"{t['id']}: dilewati ({berhenti})")
            pakai_lama(t["id"])
            continue
        try:
            harian, total = gdelt_timeline(t["gdelt"], mulai, akhir)
            keluaran["topik"][t["id"]] = {"artikel": [harian.get(h, 0) for h in hari],
                                          "total": [total.get(h, 0) for h in hari], "diperbarui_utc": iso(NOW)}
            ok += 1
        except Exception as e:  # noqa: BLE001
            galat.append(f"{t['id']}: {str(e)[:80]}")
            pakai_lama(t["id"])
            if "429" in str(e):
                berhenti = "GDELT membatasi permintaan (429)"
        if not FIXTURE and not berhenti:
            time.sleep(8)   # GDELT meminta jeda >= 5 detik antar-permintaan
    keluaran["topik"] = {t["id"]: keluaran["topik"][t["id"]] for t in TOPIK["topik"] if t["id"] in keluaran["topik"]}
    segar = sum(1 for v in keluaran["topik"].values() if not v.get("lama"))
    if not perlu:
        log("dengar GDELT: semua topik masih segar (< 6 jam)")
        catat_sumber("Volume berita GDELT (90 hari)", True, len(keluaran["topik"]),
                     "deret per topik diperbarui setiap 6 jam; semua masih segar", "gdelt_tren.json")
    else:
        log(f"dengar GDELT: {ok}/{len(perlu)} topik diperbarui" + (f" | berhenti: {berhenti}" if berhenti else ""))
        pesan = f"{ok} dari {len(perlu)} topik diperbarui; topik lain memakai deret terakhir" + (f" ({berhenti})" if berhenti else "")
        catat_sumber("Volume berita GDELT (90 hari)", ok > 0, len(keluaran["topik"]), pesan, "gdelt_tren.json")
    keluaran["topik_segar"] = segar
    return keluaran


def dengar_bmkg():
    hasil = {"diperbarui_utc": iso(NOW), "terbaru": None, "dirasakan": [], "m5": []}
    ok = 0
    def rapikan(g):
        t = dari_iso(g.get("DateTime", "").replace("+00:00", "Z")) if g.get("DateTime") else None
        try:
            mag = float(str(g.get("Magnitude", "0")).replace(",", "."))
        except ValueError:
            mag = 0.0
        lok = lokasi(g.get("Wilayah", "") + " " + g.get("Dirasakan", ""))
        return {"waktu_utc": iso(t) if t else None, "magnitudo": mag, "kedalaman": g.get("Kedalaman"),
                "wilayah": g.get("Wilayah"), "potensi": g.get("Potensi"), "dirasakan": g.get("Dirasakan"),
                "koordinat": g.get("Coordinates") or (g.get("point") or {}).get("coordinates"),
                "prov": lok["prov"] if lok else None, "kode_prov": lok["kode_prov"] if lok else None}
    for nama, kunci in (("autogempa.json", "terbaru"), ("gempadirasakan.json", "dirasakan"), ("gempaterkini.json", "m5")):
        try:
            j = json.loads(ambil(f"https://data.bmkg.go.id/DataMKG/TEWS/{nama}", f"bmkg_{nama}"))
            g = j["Infogempa"]["gempa"]
            hasil[kunci] = rapikan(g) if isinstance(g, dict) else [rapikan(x) for x in g]
            ok += 1
        except Exception as e:  # noqa: BLE001
            log("BMKG gagal", nama, e)
    catat_sumber("Gempa BMKG", ok > 0, ok, f"{ok} dari 3 berkas", "bmkg.json")
    return hasil


def dengar_hoaks():
    try:
        root = ET.fromstring(ambil("https://turnbackhoax.id/feed/", "turnbackhoax.xml"))
        daftar = []
        for it in root.findall("./channel/item"):
            daftar.append({"judul": bersih(it.findtext("title")), "url": (it.findtext("link") or "").strip(),
                           "terbit": iso(waktu_rss(it.findtext("pubDate")))})
        catat_sumber("Daftar hoaks TurnBackHoax (MAFINDO)", True, len(daftar), f"{len(daftar)} klaim terbaru", "ringkasan.json")
        return daftar
    except Exception as e:  # noqa: BLE001
        catat_sumber("Daftar hoaks TurnBackHoax (MAFINDO)", False, 0, str(e), "ringkasan.json")
        return []


# ============================================================ PILAH
def kunci_judul(j):
    return re.sub(r"[^a-z0-9]+", "", (j or "").lower())[:90]


def pilah(artikel, hoaks, terlihat, kasus):
    hit = Counter()
    hoaks_tok = [token(h["judul"]) for h in hoaks]
    baru = []
    for a in artikel:
        hit["masuk"] += 1
        if not a.get("judul") or not a.get("terbit"):
            hit["rusak"] += 1
            continue
        if NOW - a["terbit"] > SIMPAN:
            hit["lama"] += 1
            continue
        k1, k2 = slug(a["url"]), slug(kunci_judul(a["judul"]) + "|" + a["media"].lower())
        if k1 in terlihat or k2 in terlihat:
            hit["sudah_ada"] += 1
            continue
        terlihat[k1] = terlihat[k2] = iso(a["terbit"])
        j = a["judul"].lower()
        if RE_HOAKS.search(j):
            hit["hoaks"] += 1
            continue
        tk = token(a["judul"])
        if any(mirip(tk, h) >= 0.5 for h in hoaks_tok):
            hit["hoaks"] += 1
            continue
        tid, kata = topik_dari(a["judul"])
        if not tid:
            hit["tidak_relevan"] += 1
            continue
        if bukan_keluhan(a["judul"], tid):
            hit["bukan_kejadian"] += 1
            continue
        lk = lokasi(a["judul"])
        if not lk and RE_LUAR.search(j):  # berita luar negeri
            hit["luar_negeri"] += 1
            continue
        if lk:   # kata nama tempat tidak ikut menentukan kemiripan kejadian
            tk = tk - token((lk.get("kab") or "") + " " + lk["prov"]) - TOK_TEMPAT
        a.update({"id": slug(a["url"] or a["judul"]), "topik": tid, "kata": kata, "tok": tk, "lok": lk})
        baru.append(a)
    # duplikat judul sama dari media berbeda tetap dihitung sebagai media berbeda;
    # judul yang sama persis dari media yang sama sudah dibuang di atas.
    baru.sort(key=lambda a: a["terbit"])
    for a in baru:
        cocok, skor_terbaik = None, 0.0
        for k in kasus:
            if k["topik"] != a["topik"]:
                continue
            if abs((a["terbit"] - dari_iso(k["terakhir"])).total_seconds()) > JENDELA.total_seconds() and \
               abs((a["terbit"] - dari_iso(k["pertama"])).total_seconds()) > JENDELA.total_seconds():
                continue
            la, lk = a["lok"], k["lok"]
            if la and lk and la["kode_prov"] != lk["kode_prov"]:
                continue
            if la and lk and la.get("kode_kab") and lk.get("kode_kab") and la["kode_kab"] != lk["kode_kab"]:
                continue
            sama_kab = bool(la and lk and la.get("kode_kab") and la.get("kode_kab") == lk.get("kode_kab"))
            ambang = 0.25 if sama_kab else (0.3 if (la and lk) else 0.35)
            s = mirip(a["tok"], set(k["tok"]))
            # kab/kota sama + kata kunci kejadian sama (mis. "pembunuhan") dalam 72 jam: hampir pasti kejadian yang sama
            # artikel yang lokasinya hanya sampai provinsi tidak dipaksa bergabung: harus mirip sendiri
            if sama_kab and a["kata"] in k.get("kata", []):
                s = max(s, ambang + 0.01)
            if s >= ambang and s > skor_terbaik:
                cocok, skor_terbaik = k, s
        art = {"id": a["id"], "judul": a["judul"], "url": a["url"], "media": a["media"],
               "terbit": iso(a["terbit"]), "sumber": a["sumber"]}
        if cocok:
            cocok["artikel"].append(art)
            if len(cocok["tok"]) < 40:
                cocok["tok"] = sorted(set(cocok["tok"]) | a["tok"])
            cocok["pertama"] = min(cocok["pertama"], art["terbit"])
            cocok["terakhir"] = max(cocok["terakhir"], art["terbit"])
            if a["kata"] not in cocok.setdefault("kata", []):
                cocok["kata"].append(a["kata"])
            if not cocok["lok"] and a["lok"]:
                cocok["lok"] = a["lok"]
            elif cocok["lok"] and a["lok"] and not cocok["lok"].get("kode_kab") and a["lok"].get("kode_kab"):
                cocok["lok"] = a["lok"]
            cocok["diperbarui"] = iso(NOW)
            hit["gabung"] += 1
        else:
            kasus.append({"id": "K" + slug(a["id"] + a["topik"]), "topik": a["topik"], "lok": a["lok"], "kata": [a["kata"]],
                          "tok": sorted(a["tok"]), "pertama": art["terbit"], "terakhir": art["terbit"],
                          "artikel": [art], "dibuat": iso(NOW), "diperbarui": iso(NOW)})
            hit["kasus_baru"] += 1
    hit["relevan"] = len(baru)
    return kasus, hit


# ============================================================ TIMBANG, TERUSKAN, KABARKAN
STATUS_URUT = {"DARURAT": 0, "JALUR KHUSUS": 1, "TINDAK": 2, "PANTAU": 3, "TERCATAT": 4}
BATAS = {"DARURAT": ("Diteruskan ≤5 menit", 1), "TINDAK": ("Pemeriksaan ≤24 jam; kabar balik ≤72 jam", 72),
         "PANTAU": ("≤24 jam", 24), "TERCATAT": ("Rekap mingguan", None), "JALUR KHUSUS": ("Tanda terima ≤72 jam; SP3D ≤20 hari kerja", 72)}


DIT_RESERSE = {"narkoba": "Ditresnarkoba", "penipuan": "Ditreskrimsus"}
KOMNAS_HAM = "; Komnas HAM bila ada kematian atau penyiksaan"


def penanggung_jawab(status, lok, berat=False, topik=None, jenis=None, tingkat="polres"):
    """Penerima tindak lanjut (Tabel 4.6). Prinsip jalur khusus: keluhan diterima satu tingkat di atas
    satuan yang dikeluhkan dan tidak pernah dikirim ke satuan itu sendiri.
    jenis: anggota | kekerasan | perkara | penolakan; tingkat: polsek | polres | polda."""
    polda = lok["polda"] if lok else None
    polres = lok.get("polres") if lok else None
    atas = (not lok) or tingkat == "polda"           # ditangani Mabes bila lokasi belum jelas atau pelaku di Polda
    ket = " (lokasi belum jelas)" if not lok else (" (satuan tingkat Polda)" if tingkat == "polda" else "")
    if status == "JALUR KHUSUS":
        if jenis == "perkara":
            if atas:
                return "Biro Wassidik Bareskrim dan Itwasum Polri; rekap bulanan Kompolnas" + ket
            return f"Bagwassidik {DIT_RESERSE.get(topik, 'Ditreskrimum')} {polda} dan Itwasda {polda}; rekap bulanan Kompolnas"
        if jenis == "penolakan":
            if atas:
                return "Itwasum Polri; Divpropam bila ada unsur perilaku; rekap bulanan Kompolnas" + ket
            return f"Itwasda {polda}; Bidpropam {polda} bila ada unsur perilaku; rekap bulanan Kompolnas"
        if jenis == "kekerasan":
            if atas:
                return "Divpropam Polri dan Bareskrim (aspek pidana); tembusan per kasus Kompolnas" + KOMNAS_HAM + ket
            return f"Bidpropam {polda} dan Ditreskrimum {polda} (aspek pidana); tembusan per kasus Kompolnas" + KOMNAS_HAM
        if atas:
            return "Divpropam Polri; tembusan per kasus Kompolnas" + ket
        if tingkat == "polsek" and polres:
            return f"Seksi Propam {polres}; tembusan Bidpropam {polda}"
        return f"Bidpropam {polda}; rekap bulanan Kompolnas"
    if jenis == "anggota_ditangani":
        return (f"Itwasda {polda} memantau kabar balik" if polda else "Itwasum Polri memantau kabar balik") + "; rekap bulanan Kompolnas"
    if not lok:
        return "Belum dapat diteruskan: lokasi belum jelas (dipetakan manual oleh piket Polres terdekat)"
    if topik == "darurat" and status in ("DARURAT", "TINDAK", "PANTAU"):
        return f"BPBD dan Basarnas memimpin; Polri mendukung: Kabag Ops dan Sat Samapta {polres or polda}"
    if status == "DARURAT":
        return f"Layanan 110 dan Sat Samapta {polres or polda} (dari berita hanya pembanding kanal 110)"
    if not polres and status in ("TINDAK", "PANTAU", "TERCATAT"):
        return f"{polda}: dipetakan ke Polres setempat setelah lokasi diperjelas"
    if status == "TINDAK":
        if topik == "lalulintas":
            return f"Kasat Lantas {polres} (Unit Gakkum); Kapolsek setempat"
        if topik == "narkoba":
            return f"Kasat Resnarkoba {polres}"
        if topik == "perempuan_anak":
            return f"Unit PPA Satreskrim {polres}"
        if berat:
            return f"Kasat Reskrim {polres}; Kapolsek setempat"
        return f"Kapolsek setempat; Kasat Reskrim {polres} bila pidana berat"
    if status == "PANTAU":
        return f"Kanit Reskrim Polsek setempat; Bhabinkamtibmas menghubungi warga ({polda})"
    return f"Kasat Binmas {polres or polda} (rekap mingguan)"


PANGKAT = r"(?:Bharada|Bharatu|Bharaka|Bripda|Briptu|Brigpol|Brigadir|Bripka|Aipda|Aiptu|Ipda|Iptu|AKP|Kompol|AKBP|Kombes|Kombes Pol|Brigjen|Irjen|Komjen|Jenderal)"
RE_NAMA_PANGKAT = re.compile(r"\b(" + PANGKAT + r")\s+((?:[A-Z][a-z]+\s?){1,3})")
BUKAN_NAMA = {"polisi", "polri", "polda", "polres", "polsek", "polresta", "polrestabes", "propam", "mabes", "pol",
              "dan", "di", "ke", "dari", "yang", "jadi", "usai", "saat", "soal", "kini", "akhirnya", "resmi", "akan",
              "sudah", "masih", "hingga", "untuk", "pada", "dengan", "bersama", "kembali", "terancam", "terseret",
              "terlibat", "tega", "bantah", "akui", "minta", "lapor", "jalani", "sebut", "beri", "punya", "ini", "itu"}


def _nama(kata):
    """Ambil kata nama di depan; berhenti pada kata umum atau kata kerja berawalan di-/ter-/me-/ber-."""
    out = []
    for w in kata.split():
        wl = w.lower()
        if wl in BUKAN_NAMA or (len(wl) > 5 and re.match(r"^(di|ter|me|ber)", wl) and not out == []):
            break
        if wl in BUKAN_NAMA or re.match(r"^(dipe|dita|dila|didu|dico|dimu|disa|dise|divo|ditu|diam|diad|dibe|diha|diba)", wl):
            break
        out.append(w)
    return out


def samar(judul):
    """Nama anggota pada kasus jalur khusus disingkat menjadi inisial: belum ada putusan, jadi
    PEKA tidak menampilkan nama lengkap orang yang dikeluhkan."""
    def ganti(m):
        nama = _nama(m.group(2))
        if not nama:
            return m.group(0)
        sisa = m.group(2).split()[len(nama):]
        inisial = "".join(w[0] + "." for w in nama)
        return f"{m.group(1)} {inisial} " + (" ".join(sisa) + " " if sisa else "")
    return re.sub(r"\s{2,}", " ", RE_NAMA_PANGKAT.sub(ganti, judul or "")).strip()


def timbang(k, lonjakan, gempa_darurat):
    t = TOPIK_BY[k["topik"]]
    lok = k.get("lok")
    judul = " ".join(a["judul"] for a in k["artikel"]).lower()
    media = sorted({a["media"] for a in k["artikel"]})
    pertama = dari_iso(k["pertama"])
    umur_jam = (NOW - pertama).total_seconds() / 3600
    lokasi_jelas = bool(lok and lok.get("kode_kab"))
    ancaman = RE_JIWA.search(judul)
    bukti = RE_BUKTI.search(judul)
    berat = RE_BERAT.search(judul)       # korban jiwa, luka berat, atau kekerasan seksual
    # KABARKAN: apakah tanggapan polisi sudah terlihat di pemberitaan?
    urut = sorted(k["artikel"], key=lambda a: a["terbit"])
    tanggap = None
    for i, a in enumerate(urut):
        jl = a["judul"].lower()
        m = RE_TANGGAPAN.search(jl)
        if m and not RE_DESAK.search(jl):     # "keluarga desak polisi usut tuntas" = tuntutan, bukan tanggapan
            tanggap = {"terbit": a["terbit"], "judul": a["judul"], "media": a["media"], "url": a["url"],
                       "kata": m.group(1), "sejak_awal": i == 0}
            break
    jeda = None
    if tanggap and not tanggap["sejak_awal"]:
        jeda = round((dari_iso(tanggap["terbit"]) - pertama).total_seconds() / 3600, 1)
    alasan = []
    perkara = RE_PERKARA.search(judul)
    tolak = RE_TOLAK.search(judul)
    keras = RE_KEKERASAN.search(judul)
    tegas = RE_TEGAS.search(judul)
    if not (tegas and RE_TEGAS_KONTEKS.search(judul)) or RE_TEGAS_RAGU.search(judul) or keras:
        tegas = None
    judul_tk = RE_TUJUAN_ADUAN.sub(" ", judul)
    if RE_POLDA_LV.search(judul_tk) and not RE_POLRES_LV.search(judul_tk):
        tingkat = "polda"
    elif RE_POLSEK_LV.search(judul_tk) and not RE_POLRES_SAJA.search(judul_tk):
        tingkat = "polsek"
    else:
        tingkat = "polres"
    jenis = None
    bisa = t.get("jalur_khusus") or t.get("pidana") or k["topik"] == "layanan"
    if t.get("jalur_khusus") and tegas:
        status = "TERCATAT"
        alasan.append(f"tindakan tegas yang dilaporkan polisi sendiri: “{tegas.group(1)}”; masuk jalur khusus "
                      "hanya bila ada keberatan, kata 'diduga', atau salah tembak")
    elif tolak and bisa:
        status, jenis = "JALUR KHUSUS", "penolakan"
        alasan.append(f"laporan warga ditolak: “{tolak.group(1)}” → inspektorat (Itwasda), tidak dikirim ke "
                      "satuan yang menolak")
    elif perkara and bisa:
        status, jenis = "JALUR KHUSUS", "perkara"
        alasan.append(f"keluhan atas penanganan perkara: “{perkara.group(1)}” → pengawas penyidikan (Wassidik) "
                      "dan inspektorat, tidak dikirim ke penyidik yang dikeluhkan")
    elif t.get("jalur_khusus") and not keras and RE_SUDAH.search(judul):
        # sejak versi 2026-10-31: anggota yang sudah diperiksa Propam atau diproses penyidik tidak diteruskan ulang;
        # kasus dipantau kabar baliknya oleh Itwasda dan masuk rekap bulanan Kompolnas
        status, jenis = "TERCATAT", "anggota_ditangani"
        alasan.append(f"perilaku anggota yang sudah ditangani: “{RE_SUDAH.search(judul).group(1)}” → dipantau kabar "
                      "baliknya, masuk rekap bulanan Kompolnas")
    elif t.get("jalur_khusus"):
        status, jenis = "JALUR KHUSUS", ("kekerasan" if keras else "anggota")
        alasan.append(("kekerasan oleh aparat: “" + keras.group(1) + "” → Propam dan reserse satu tingkat di atasnya"
                       if keras else "perilaku anggota → Propam satu tingkat di atas satuan yang dikeluhkan"))
    elif (k["topik"] in ("darurat", "konflik") and umur_jam <= 12 and ancaman and lokasi_jelas
          and len(media) >= 2) or (lok and lok["kode_prov"] in gempa_darurat and k["topik"] == "darurat"):
        status = "DARURAT"
        if lok and lok["kode_prov"] in gempa_darurat and k["topik"] == "darurat":
            alasan.append("gempa signifikan BMKG ≤24 jam di provinsi yang sama")
        else:
            alasan += [f"baru terjadi ({umur_jam:.0f} jam)", f"ancaman jiwa: “{ancaman.group(1)}”",
                       "lokasi jelas", f"{len(media)} media"]
    elif t.get("pidana") and lokasi_jelas and (len(media) >= MIN_MEDIA_TINDAK or bukti or berat):
        status = "TINDAK"
        alasan.append("pidana/keselamatan")
        if berat:
            alasan.append(f"korban jiwa, luka berat, atau kekerasan seksual: “{berat.group(1)}”")
        elif len(media) >= MIN_MEDIA_TINDAK:
            alasan.append(f"{len(media)} media berbeda ≥ {MIN_MEDIA_TINDAK} dalam 72 jam")
        else:
            alasan.append(f"ada bukti: “{bukti.group(1)}”")
        alasan.append("lokasi jelas")
    else:
        kunci = (lok["kode_prov"] if lok else None, k["topik"])
        if kunci in lonjakan:
            status = "PANTAU"
            L = lonjakan[kunci]
            alasan.append(f"lonjakan: {L['hari_ini']} kasus 24 jam ≥ 2 × rata-rata {L['rata']:.1f} dan ≥ 5")
        elif t.get("pidana") and lok:
            status = "PANTAU"
            alasan.append("pidana/keselamatan tanpa bukti, tanpa korban berat, dan < 3 media" if lokasi_jelas
                          else "pidana/keselamatan, lokasi baru sampai provinsi")
        else:
            status = "TERCATAT"
            alasan.append("lokasi belum jelas, masuk rekap pola" if not lok else "tidak ada ambang yang terpenuhi")
    # Lingkaran tertutup: bila tanggapan polisi/petugas sudah terlihat di pemberitaan, kasus Tindak/Pantau
    # tidak perlu diteruskan ulang; ia masuk rekap (Tercatat) dengan keterangan sudah ditanggapi.
    status_awal = status
    if tanggap and status in ("TINDAK", "PANTAU"):
        alasan = [f"semula {status.lower()}: " + "; ".join(alasan), f"tanggapan sudah terlihat: “{tanggap['kata']}”"]
        status = "TERCATAT"
    batas_teks, batas_jam = BATAS[status]
    if status == "JALUR KHUSUS" and jenis == "kekerasan":
        batas_teks, batas_jam = "Tanda terima ≤24 jam; SP3D ≤20 hari kerja", 24
    lewat = bool(batas_jam and not tanggap and umur_jam > batas_jam)
    rahasia = status == "JALUR KHUSUS" or bool(t.get("jalur_khusus"))   # nama anggota disingkat bila belum ada putusan
    return {
        "id": k["id"], "topik": k["topik"], "topik_nama": t["nama"], "status": status, "status_awal": status_awal,
        "alasan": alasan,
        "lok": lok, "jenis_khusus": jenis, "tingkat": tingkat,
        "penanggung_jawab": penanggung_jawab(status, lok, bool(berat), k["topik"], jenis, tingkat),
        "batas_waktu": batas_teks,
        "penanggung_jawab_awal": penanggung_jawab(status_awal, lok, bool(berat), k["topik"], jenis, tingkat),
        "batas_awal": batas_teks if status_awal == status else BATAS[status_awal][0],
        "pertama": k["pertama"], "terakhir": k["terakhir"], "umur_jam": round(umur_jam, 1),
        "n_media": len(media), "n_artikel": len(k["artikel"]), "media": media[:8],
        "judul": samar(urut[0]["judul"]) if rahasia else urut[0]["judul"],
        "artikel": [{"judul": samar(a["judul"]) if rahasia else a["judul"],
                     "media": a["media"], "url": a["url"], "terbit": a["terbit"]}
                    for a in sorted(k["artikel"], key=lambda a: a["terbit"], reverse=True)[:6]],
        "tanggapan": ({**tanggap, "judul": samar(tanggap["judul"])} if tanggap and rahasia else tanggap),
        "jeda_tanggapan_jam": jeda, "melewati_batas": lewat,
    }


# ============================================================ ARSIPKAN
KOLOM_ARSIP = ["id", "pertama_utc", "tanggal_wib", "bulan", "topik", "kode_prov", "provinsi", "kode_kab", "kabkota",
               "status", "n_media", "n_artikel", "tanggapan_terlihat", "tanggapan_sejak_awal", "jeda_tanggapan_jam",
               "diperbarui_utc", "polda", "polres", "status_awal", "melewati_batas", "jenis_khusus",
               "versi_aturan", "koreksi"]


def muat_arsip():
    f = DATA / "arsip_kasus.csv"
    if not f.exists():
        return {}
    with f.open(encoding="utf-8") as fh:
        return {r["id"]: r for r in csv.DictReader(fh)}


def simpan_arsip(arsip):
    baris = sorted(arsip.values(), key=lambda r: r["pertama_utc"])
    with (DATA / "arsip_kasus.csv").open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=KOLOM_ARSIP)
        w.writeheader()
        for r in baris:
            w.writerow({c: r.get(c, "") for c in KOLOM_ARSIP})


def ke_arsip(h):
    t = dari_iso(h["pertama"]).astimezone(WIB)
    lok = h["lok"] or {}
    tg = h["tanggapan"]
    return {"id": h["id"], "pertama_utc": h["pertama"], "tanggal_wib": t.strftime("%Y-%m-%d"),
            "bulan": t.strftime("%Y-%m"), "topik": h["topik"], "kode_prov": lok.get("kode_prov") or "",
            "provinsi": lok.get("prov") or "", "kode_kab": lok.get("kode_kab") or "", "kabkota": lok.get("kab") or "",
            "status": h["status"], "n_media": h["n_media"], "n_artikel": h["n_artikel"],
            "tanggapan_terlihat": int(bool(tg)), "tanggapan_sejak_awal": int(bool(tg and tg["sejak_awal"])),
            "jeda_tanggapan_jam": "" if h["jeda_tanggapan_jam"] is None else h["jeda_tanggapan_jam"],
            "diperbarui_utc": iso(NOW), "polda": lok.get("polda") or "", "polres": lok.get("polres") or "",
            "status_awal": h.get("status_awal") or h["status"], "melewati_batas": int(bool(h["melewati_batas"])),
            "jenis_khusus": h.get("jenis_khusus") or "", "versi_aturan": VERSI_ATURAN, "koreksi": ""}


def sahih(arsip):
    """Baris arsip yang tidak dikoreksi. Baris salah golong tidak dihapus (arsip hanya bertambah),
    tetapi diberi keterangan koreksi dan tidak ikut dihitung."""
    return [r for r in arsip.values() if not r.get("koreksi")]


def hitung_lonjakan(arsip, aktif):
    """Lonjakan per (provinsi, topik): kasus 24 jam terakhir >= 2 x rata-rata harian 28 hari sebelumnya dan >= 5."""
    hari_ini = Counter()
    for h in aktif:
        if NOW - dari_iso(h["pertama"]) <= timedelta(hours=24):
            hari_ini[((h["lok"] or {}).get("kode_prov"), h["topik"])] += 1
    awal = min((r["tanggal_wib"] for r in sahih(arsip)), default=None)
    hari_riwayat = 0
    harian = Counter()
    batas_bawah = (NOW - timedelta(days=28)).astimezone(WIB).strftime("%Y-%m-%d")
    kemarin = (NOW - timedelta(days=1)).astimezone(WIB).strftime("%Y-%m-%d")
    for r in sahih(arsip):
        if batas_bawah <= r["tanggal_wib"] <= kemarin:
            harian[(r["kode_prov"] or None, r["topik"])] += 1
    if awal:
        hari_riwayat = min(28, max(0, (NOW.astimezone(WIB).date() - datetime.strptime(awal, "%Y-%m-%d").date()).days))
    hasil = {}
    for kunci, n in hari_ini.items():
        if hari_riwayat < 7:
            continue
        rata = harian[kunci] / hari_riwayat
        if n >= 5 and n >= 2 * rata:
            hasil[kunci] = {"hari_ini": n, "rata": round(rata, 2)}
    return hasil, hari_riwayat


def lonjakan_nasional(gd):
    out = []
    for tid, s in gd.get("topik", {}).items():
        if s.get("lama"):          # deret lama tidak dipakai untuk menilai lonjakan kemarin
            continue
        a = s["artikel"]
        if len(a) < 30:
            continue
        kemarin, sebelum = a[-2], a[-30:-2]
        rata = sum(sebelum) / len(sebelum) if sebelum else 0
        out.append({"topik": tid, "nama": TOPIK_BY[tid]["nama"], "kemarin": kemarin, "rata28": round(rata, 1),
                    "rasio": round(kemarin / rata, 2) if rata else None,
                    "lonjakan": bool(rata and kemarin >= 2 * rata and kemarin >= 5)})
    return sorted(out, key=lambda r: -(r["rasio"] or 0))


def ringkas_bulanan(arsip):
    per = defaultdict(lambda: {"kasus": 0, "topik": Counter(), "status": Counter(), "prov": Counter(),
                               "tanggapan": 0, "jeda": []})
    for r in sahih(arsip):
        b = per[r["bulan"]]
        b["kasus"] += 1
        b["topik"][r["topik"]] += 1
        b["status"][r["status"]] += 1
        if r["provinsi"]:
            b["prov"][r["provinsi"]] += 1
        b["tanggapan"] += int(r["tanggapan_terlihat"] or 0)
        if r["jeda_tanggapan_jam"] not in ("", None):
            b["jeda"].append(float(r["jeda_tanggapan_jam"]))
    out = []
    for bulan in sorted(per):
        b = per[bulan]
        out.append({"bulan": bulan, "kasus": b["kasus"], "topik": dict(b["topik"]), "status": dict(b["status"]),
                    "provinsi_teratas": b["prov"].most_common(10), "tanggapan_terlihat": b["tanggapan"],
                    "median_jeda_jam": round(statistics.median(b["jeda"]), 1) if b["jeda"] else None,
                    "n_jeda": len(b["jeda"])})
    return out


# ============================================================ PAPAN KABAR BALIK & TITIK RAWAN
JENDELA_PAPAN = timedelta(days=30)
PERLU = ("DARURAT", "JALUR KHUSUS", "TINDAK", "PANTAU")
MIN_KEJADIAN_RAWAN = 3                 # >= 3 kejadian terpisah, topik sama, kab/kota sama, 30 hari
SELA_KEJADIAN = timedelta(hours=72)    # kasus yang berselang < 72 jam dianggap kejadian yang sama
KAB_BY = {k["kode"]: k for k in WIL["kabkota"]}


def polda_dari(r):
    if r.get("polda"):
        return r["polda"], r.get("polres") or None
    if r.get("kode_kab") in KAB_BY:
        k = KAB_BY[r["kode_kab"]]
        return k["polda"], k["polres"]
    if r.get("kode_prov") in PROV:
        return PROV[r["kode_prov"]]["polda"], None
    return None, None


def papan_kabar_balik(arsip):
    """Per Polda, 30 hari: berapa kasus yang perlu ditindaklanjuti dan berapa yang tanggapannya terlihat.
    Indikatif: sumbernya berita, jadi ini bukan peringkat kinerja."""
    batas = iso(NOW - JENDELA_PAPAN)
    per = {}
    for p in WIL["provinsi"]:
        b = per.setdefault(p["polda"], {"polda": p["polda"], "provinsi": [], "kasus": 0, "perlu": 0,
                                        "perlu_tanggap": 0, "tanggap": 0, "jalur_khusus": 0, "lewat": 0,
                                        "jeda": [], "topik": Counter()})
        b["provinsi"].append(p["kode"])
    tanpa = 0
    for r in sahih(arsip):
        if r["pertama_utc"] < batas:
            continue
        polda, _ = polda_dari(r)
        if polda not in per:
            tanpa += 1
            continue
        b = per[polda]
        sa = r.get("status_awal") or ""      # baris arsip versi lama tidak punya status awal
        tg = int(r["tanggapan_terlihat"] or 0)
        b["kasus"] += 1
        b["tanggap"] += tg
        b["topik"][r["topik"]] += 1
        if r["status"] == "JALUR KHUSUS" or sa == "JALUR KHUSUS":
            b["jalur_khusus"] += 1
        # kasus yang tanggapannya sudah ada sejak berita pertama tidak pernah "menunggu"
        if sa in PERLU and not int(r.get("tanggapan_sejak_awal") or 0):
            b["perlu"] += 1
            b["perlu_tanggap"] += tg
            b["lewat"] += int(r.get("melewati_batas") or 0)
            if r["jeda_tanggapan_jam"] not in ("", None):
                b["jeda"].append(float(r["jeda_tanggapan_jam"]))
    out = []
    for b in per.values():
        out.append({"polda": b["polda"], "provinsi": b["provinsi"], "kasus": b["kasus"], "perlu": b["perlu"],
                    "perlu_tanggap": b["perlu_tanggap"],
                    "persen_tanggap": round(100 * b["perlu_tanggap"] / b["perlu"], 1) if b["perlu"] else None,
                    "tanggap": b["tanggap"], "jalur_khusus": b["jalur_khusus"], "melewati_batas": b["lewat"],
                    "median_jeda_jam": round(statistics.median(b["jeda"]), 1) if b["jeda"] else None,
                    "n_jeda": len(b["jeda"]), "topik_teratas": b["topik"].most_common(3)})
    out.sort(key=lambda x: (-x["perlu"], -x["kasus"], x["polda"]))
    return out, tanpa


def titik_rawan(arsip):
    """Masalah, bukan kejadian (Goldstein, 1979): kab/kota dengan >= 3 kejadian terpisah pada topik yang sama
    dalam 30 hari. Kasus yang berselang < 72 jam dihitung satu kejadian, karena satu kejadian besar
    dapat terpecah menjadi beberapa kasus bila judul beritanya berbeda."""
    batas = iso(NOW - JENDELA_PAPAN)
    grup = defaultdict(list)
    for r in sahih(arsip):
        if r["pertama_utc"] >= batas and r["kode_kab"]:
            grup[(r["kode_kab"], r["topik"])].append(r)
    out = []
    for (kab, tp), rs in grup.items():
        rs.sort(key=lambda r: r["pertama_utc"])
        kejadian, mulai = [], None
        for r in rs:
            t = dari_iso(r["pertama_utc"])
            if mulai is None or t - mulai >= SELA_KEJADIAN:
                kejadian.append([r])
                mulai = t
            else:
                kejadian[-1].append(r)
        if len(kejadian) < MIN_KEJADIAN_RAWAN:
            continue
        polda, polres = polda_dari(rs[0])
        out.append({"kode_kab": kab, "kabkota": rs[0]["kabkota"], "kode_prov": rs[0]["kode_prov"],
                    "provinsi": rs[0]["provinsi"], "polda": polda, "polres": polres, "topik": tp,
                    "nama": TOPIK_BY.get(tp, {}).get("nama", tp), "kejadian": len(kejadian), "kasus": len(rs),
                    "tanggal": [k[0]["tanggal_wib"] for k in kejadian],
                    "kejadian_ditanggapi": sum(1 for k in kejadian if any(int(r["tanggapan_terlihat"] or 0) for r in k)),
                    "penanggung_jawab": (f"Kasat Binmas {polres}" if polres else f"Dirbinmas {polda}") + " bersama pemerintah daerah"})
    out.sort(key=lambda x: (-x["kejadian"], -x["kasus"], x["kabkota"]))
    return out


# ============================================================ UTAMA
def main():
    log("PEKA mulai", iso(NOW), "(mode uji)" if FIXTURE else "")
    terlihat = baca_json("_terlihat.json", {})
    kasus = baca_json("_kasus_cache.json", [])
    # bersihkan cache lama
    batas = iso(NOW - SIMPAN)
    terlihat = {k: v for k, v in terlihat.items() if v and v >= batas}
    kasus = [k for k in kasus if k["terakhir"] >= batas]
    # Aturan dapat diperbaiki (mis. kata pengecualian baru). Kasus di cache disaring ulang dengan aturan
    # terbaru supaya salah golong lama tidak terus tampil. Baris arsipnya tidak dihapus, hanya diberi
    # keterangan koreksi, supaya riwayat tetap utuh bagi Pusat Sejarah Polri.
    salah_golong = set()
    for k in kasus:
        k["artikel"] = [a for a in k["artikel"] if topik_dari(a["judul"])[0] == k["topik"]
                        and not bukan_keluhan(a["judul"], k["topik"])]
        if k["artikel"]:
            k["pertama"] = min(a["terbit"] for a in k["artikel"])
            k["terakhir"] = max(a["terbit"] for a in k["artikel"])
            # lokasi dihitung ulang dengan gazeter terbaru (nama satuan, kecamatan, alias baru)
            for a in sorted(k["artikel"], key=lambda a: a["terbit"]):
                lk = lokasi(a["judul"])
                if lk and (lk.get("kode_kab") or not (k.get("lok") or {}).get("kode_kab")):
                    k["lok"] = lk
                    if lk.get("kode_kab"):
                        break
        else:
            salah_golong.add(k["id"])
    kasus = [k for k in kasus if k["artikel"]]
    if salah_golong:
        log("saring ulang:", len(salah_golong), "kasus lama tidak lolos aturan terbaru")

    artikel = dengar_berita()
    hoaks = dengar_hoaks()
    bmkg = dengar_bmkg()
    gd = dengar_gdelt()

    kasus, hit = pilah(artikel, hoaks, terlihat, kasus)
    log("pilah:", dict(hit))

    # gempa signifikan: M>=6 atau berpotensi tsunami dalam 24 jam
    gempa_darurat = set()
    for g in [bmkg.get("terbaru")] + list(bmkg.get("m5") or []):
        if not g or not g.get("waktu_utc"):
            continue
        baru = NOW - dari_iso(g["waktu_utc"]) <= timedelta(hours=24)
        tsunami = g.get("potensi") and "tidak" not in g["potensi"].lower() and "tsunami" in g["potensi"].lower()
        if baru and (g["magnitudo"] >= 6.0 or tsunami) and g.get("kode_prov"):
            gempa_darurat.add(g["kode_prov"])

    arsip = muat_arsip()
    for i in salah_golong:
        if i in arsip and not arsip[i].get("koreksi"):
            arsip[i]["koreksi"] = f"tidak lolos aturan versi {VERSI_ATURAN}"
    aktif_kasus = [k for k in kasus if NOW - dari_iso(k["terakhir"]) <= JENDELA]
    # timbang dua kali: putaran pertama untuk menghitung lonjakan, putaran kedua memakai lonjakan
    awal = [timbang(k, {}, gempa_darurat) for k in aktif_kasus]
    lonjakan, hari_riwayat = hitung_lonjakan(arsip, awal)
    hasil = [timbang(k, lonjakan, gempa_darurat) for k in aktif_kasus]
    hasil.sort(key=lambda h: (STATUS_URUT[h["status"]], -h["n_media"], h["pertama"]))
    for h in hasil:
        arsip[h["id"]] = ke_arsip(h)
    simpan_arsip(arsip)

    st = Counter(h["status"] for h in hasil)
    jendela72 = hasil   # kasus aktif: berita terakhir dalam 72 jam
    jeda = [h["jeda_tanggapan_jam"] for h in jendela72 if h["jeda_tanggapan_jam"] is not None]
    tanggap = [h for h in jendela72 if h["tanggapan"]]
    perlu = [h for h in jendela72 if h["status"] in ("DARURAT", "TINDAK", "JALUR KHUSUS", "PANTAU")]
    polda = {(h["lok"] or {}).get("polda") for h in perlu if h["lok"]}
    per_prov = defaultdict(lambda: Counter())
    for h in jendela72:
        if h["lok"]:
            per_prov[h["lok"]["kode_prov"]][h["status"]] += 1
    nasional = lonjakan_nasional(gd)

    ringkasan = {
        "diperbarui_utc": iso(NOW),
        "versi_aturan": VERSI_ATURAN,
        "jalur_khusus_jenis": dict(Counter(h["jenis_khusus"] for h in hasil if h["status"] == "JALUR KHUSUS")),
        "anggota_sudah_ditangani": sum(1 for h in hasil if h.get("jenis_khusus") == "anggota_ditangani"),
        "jendela_jam": 72,
        "status": {s: st.get(s, 0) for s in STATUS_URUT},
        "kasus_aktif": len(hasil),
        "topik": {t["id"]: {"nama": t["nama"], "kasus": sum(1 for h in jendela72 if h["topik"] == t["id"])}
                  for t in TOPIK["topik"]},
        "provinsi": {k: {"nama": PROV[k]["nama"], "polda": PROV[k]["polda"], **dict(v)} for k, v in per_prov.items()},
        "langkah": {
            "dengar": {"artikel": hit["masuk"], "sumber": sum(1 for s in STATUS_SUMBER.values() if s["ok"])},
            "pilah": {"relevan": hit["relevan"], "sudah_ada": hit["sudah_ada"], "hoaks": hit["hoaks"],
                      "tidak_relevan": hit["tidak_relevan"], "bukan_kejadian": hit["bukan_kejadian"],
                      "luar_negeri": hit["luar_negeri"], "kasus_baru": hit["kasus_baru"], "digabung": hit["gabung"]},
            "timbang": {s: st.get(s, 0) for s in STATUS_URUT},
            "teruskan": {"polda": len(polda), "kasus": len(perlu)},
            "kabarkan": {"tanggapan_terlihat": len(tanggap), "kasus": len(jendela72),
                         "tanggapan_sejak_berita_pertama": sum(1 for h in tanggap if h["tanggapan"]["sejak_awal"]),
                         "median_jeda_jam": round(statistics.median(jeda), 1) if jeda else None, "n_jeda": len(jeda),
                         "melewati_batas": sum(1 for h in jendela72 if h["melewati_batas"])},
            "arsipkan": {"baris": len(arsip), "dikoreksi": sum(1 for r in arsip.values() if r.get("koreksi")),
                         "bulan": len({r["bulan"] for r in arsip.values()}),
                         "hari_riwayat": hari_riwayat},
        },
        "lonjakan_wilayah": [{"kode_prov": k[0], "prov": PROV[k[0]]["nama"] if k[0] else "Tanpa lokasi",
                              "topik": k[1], "nama": TOPIK_BY[k[1]]["nama"], **v} for k, v in lonjakan.items()],
        "lonjakan_nasional": nasional,
        "hari_riwayat": hari_riwayat,
        "gempa_darurat": sorted(gempa_darurat),
        "hoaks_terbaru": hoaks[:6],
    }
    tulis_json("ringkasan.json", ringkasan)
    tulis_json("kasus_terkini.json", {"diperbarui_utc": iso(NOW), "kasus": hasil[:1000]}, ringkas=True)
    tulis_json("gdelt_tren.json", gd)
    tulis_json("bmkg.json", bmkg)
    tulis_json("arsip_bulanan.json", {"diperbarui_utc": iso(NOW), "bulan": ringkas_bulanan(arsip)})
    papan, tanpa_polda = papan_kabar_balik(arsip)
    rawan = titik_rawan(arsip)
    awal_arsip = min((r["pertama_utc"] for r in arsip.values()), default=None)
    tulis_json("polda.json", {"diperbarui_utc": iso(NOW), "jendela_hari": JENDELA_PAPAN.days,
                              "hari_riwayat": hari_riwayat, "arsip_sejak_utc": awal_arsip,
                              "kasus_tanpa_polda": tanpa_polda, "polda": papan,
                              "titik_rawan": rawan[:60], "aturan_rawan": {
                                  "min_kejadian": MIN_KEJADIAN_RAWAN, "sela_jam": int(SELA_KEJADIAN.total_seconds() // 3600),
                                  "jendela_hari": JENDELA_PAPAN.days}})
    log(f"papan Polda: {sum(1 for p in papan if p['kasus'])} Polda berkasus | titik rawan: {len(rawan)}")
    # cache internal
    for k in kasus:
        k["tok"] = sorted(k["tok"])[:40]
    tulis_json("_kasus_cache.json", kasus, ringkas=True)
    tulis_json("_terlihat.json", terlihat, ringkas=True)
    tulis_json("status_sumber.json", {"diperbarui_utc": iso(NOW), "sumber": STATUS_SUMBER, "log": LOG[-40:]})
    log("selesai:", dict(st), f"| {len(hasil)} kasus aktif | arsip {len(arsip)} baris")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        log("GAGAL:", repr(e))
        tulis_json("status_sumber.json", {"diperbarui_utc": iso(NOW), "sumber": STATUS_SUMBER, "log": LOG[-40:],
                                          "galat": repr(e)})
        raise
