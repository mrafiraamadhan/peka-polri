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


RE_TOPIK = [(t["id"], regex_kata(t["kata"])) for t in TOPIK["topik"]]
RE_TANGGAPAN = regex_kata(TOPIK["tanggapan"])
RE_JIWA = regex_kata(TOPIK["ancaman_jiwa"])
RE_BUKTI = regex_kata(TOPIK["bukti"])
RE_HOAKS = regex_kata(TOPIK["hoaks"])
RE_BUKAN = regex_kata(TOPIK.get("bukan_keluhan", ["-"]))
RE_LUAR = regex_kata(TOPIK.get("luar_negeri", ["-"]))

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
TOK_TEMPAT = {w.lower() for w in ALIAS_KAB} | {w.lower() for p in WIL["provinsi"] for a in p["alias"] for w in a.split()} \
    | {"kabupaten", "kota", "kab"}


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
            temu.append((m.start(1), -prio, -(m.end(1) - m.start(1)), target))
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
    for tid, rx in RE_TOPIK:
        m = rx.search(j)
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
                timeout=30, percobaan=2, jeda=20)
    teks = raw.decode("utf-8", "ignore").strip()
    j = json.loads(teks)
    harian, total = defaultdict(int), defaultdict(int)
    for seri in j.get("timeline", []):
        for d in seri.get("data", []):
            hari = d["date"][:8]
            harian[hari] += int(d.get("value", 0))
            total[hari] += int(d.get("norm", 0))
    return harian, total


def dengar_gdelt():
    lama = baca_json("gdelt_tren.json", {})
    # GDELT berubah harian dan membatasi permintaan; cukup diperbarui setiap 6 jam.
    if not FIXTURE and lama.get("diperbarui_utc") and NOW - dari_iso(lama["diperbarui_utc"]) < timedelta(hours=6) \
            and sum(1 for v in lama.get("topik", {}).values() if sum(v.get("artikel", [])) > 0) >= 5:
        log("dengar GDELT: dilewati, deret masih segar")
        catat_sumber("Volume berita GDELT (90 hari)", True, len(lama["topik"]),
                     f"memakai deret {lama['diperbarui_utc']} (diperbarui setiap 6 jam)", "gdelt_tren.json")
        return lama
    akhir = NOW.replace(minute=0, second=0, microsecond=0)
    mulai = (akhir - timedelta(days=89)).replace(hour=0)
    hari = [(mulai + timedelta(days=i)).strftime("%Y%m%d") for i in range((akhir - mulai).days + 1)]
    keluaran = {"diperbarui_utc": iso(NOW), "hari": [f"{h[:4]}-{h[4:6]}-{h[6:]}" for h in hari], "topik": {}}
    ok, galat = 0, []
    mulai_jam = time.time()
    for t in TOPIK["topik"]:
        if time.time() - mulai_jam > 360:      # batas 6 menit supaya putaran tidak melewati batas waktu
            galat.append(f"{t['id']}: dilewati (batas waktu)")
            continue
        try:
            harian, total = gdelt_timeline(t["gdelt"], mulai, akhir)
            keluaran["topik"][t["id"]] = {"artikel": [harian.get(h, 0) for h in hari],
                                          "total": [total.get(h, 0) for h in hari]}
            ok += 1
        except Exception as e:  # noqa: BLE001
            galat.append(f"{t['id']}: {str(e)[:80]}")
            # pakai deret lama bila ada, supaya grafik tidak kosong
            if lama.get("topik", {}).get(t["id"]) and lama.get("hari"):
                peta = dict(zip(lama["hari"], lama["topik"][t["id"]]["artikel"]))
                petat = dict(zip(lama["hari"], lama["topik"][t["id"]].get("total", [0] * len(lama["hari"]))))
                keluaran["topik"][t["id"]] = {"artikel": [peta.get(h, 0) for h in keluaran["hari"]],
                                              "total": [petat.get(h, 0) for h in keluaran["hari"]], "lama": True}
        if not FIXTURE:
            time.sleep(10)  # GDELT meminta jeda >= 5 detik antar-permintaan; dibuat lebih longgar
    log(f"dengar GDELT: {ok}/{len(TOPIK['topik'])} topik")
    catat_sumber("Volume berita GDELT (90 hari)", ok > 0, ok, "; ".join(galat[:2]) or f"{ok} topik", "gdelt_tren.json")
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
        if RE_BUKAN.search(j):          # kegiatan, sosialisasi, opini, statistik: bukan kejadian yang dikeluhkan
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
            satu_prov_umum = bool(la and lk and la["kode_prov"] == lk["kode_prov"] and not (la.get("kode_kab") and lk.get("kode_kab")))
            if (sama_kab or satu_prov_umum) and a["kata"] in k.get("kata", []):
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
         "PANTAU": ("≤24 jam", 24), "TERCATAT": ("Rekap mingguan", None), "JALUR KHUSUS": ("Tanda terima ≤72 jam", 72)}


def penanggung_jawab(status, lok):
    if not lok:
        return "Belum dapat diteruskan: lokasi belum jelas (dipetakan manual oleh piket Polres terdekat)"
    polda, polres = lok["polda"], lok.get("polres")
    if status == "DARURAT":
        return f"Piket SPKT {polres or polda} dan layanan 110"
    if not polres and status in ("TINDAK", "PANTAU", "TERCATAT"):
        return f"{polda}: dipetakan ke Polres setempat setelah lokasi diperjelas"
    if status == "TINDAK":
        return f"Kapolsek setempat; Kasat Reskrim {polres} bila pidana berat ({polda})"
    if status == "PANTAU":
        return f"Bhabinkamtibmas setempat; bila belum ada, Kanit Binmas Polsek ({polda})"
    if status == "JALUR KHUSUS":
        return f"Propam {polda}; tembusan Kompolnas"
    return f"Kasat Binmas {polres or polda} (rekap mingguan)"


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
    # KABARKAN: apakah tanggapan polisi sudah terlihat di pemberitaan?
    urut = sorted(k["artikel"], key=lambda a: a["terbit"])
    tanggap = None
    for i, a in enumerate(urut):
        m = RE_TANGGAPAN.search(a["judul"].lower())
        if m:
            tanggap = {"terbit": a["terbit"], "judul": a["judul"], "media": a["media"], "url": a["url"],
                       "kata": m.group(1), "sejak_awal": i == 0}
            break
    jeda = None
    if tanggap and not tanggap["sejak_awal"]:
        jeda = round((dari_iso(tanggap["terbit"]) - pertama).total_seconds() / 3600, 1)
    alasan = []
    if t.get("jalur_khusus"):
        status = "JALUR KHUSUS"
        alasan.append("topik perilaku anggota → jalur khusus, tidak dikirim ke satuan yang dikeluhkan")
    elif (k["topik"] in ("darurat", "konflik") and umur_jam <= 12 and ancaman and lokasi_jelas
          and len(media) >= 2) or (lok and lok["kode_prov"] in gempa_darurat and k["topik"] == "darurat"):
        status = "DARURAT"
        if lok and lok["kode_prov"] in gempa_darurat and k["topik"] == "darurat":
            alasan.append("gempa signifikan BMKG ≤24 jam di provinsi yang sama")
        else:
            alasan += [f"baru terjadi ({umur_jam:.0f} jam)", f"ancaman jiwa: “{ancaman.group(1)}”",
                       "lokasi jelas", f"{len(media)} media"]
    elif t.get("pidana") and lokasi_jelas and (len(media) >= MIN_MEDIA_TINDAK or bukti):
        status = "TINDAK"
        alasan.append("pidana/keselamatan")
        alasan.append(f"{len(media)} media berbeda ≥ {MIN_MEDIA_TINDAK} dalam 72 jam" if len(media) >= MIN_MEDIA_TINDAK
                      else f"ada bukti: “{bukti.group(1)}”")
        alasan.append("lokasi jelas")
    else:
        kunci = (lok["kode_prov"] if lok else None, k["topik"])
        if kunci in lonjakan:
            status = "PANTAU"
            L = lonjakan[kunci]
            alasan.append(f"lonjakan: {L['hari_ini']} kasus 24 jam ≥ 2 × rata-rata {L['rata']:.1f} dan ≥ 5")
        elif t.get("pidana") and lok:
            status = "PANTAU"
            alasan.append("pidana/keselamatan tanpa bukti dan < 3 media" if lokasi_jelas
                          else "pidana/keselamatan, lokasi baru sampai provinsi")
        else:
            status = "TERCATAT"
            alasan.append("lokasi belum jelas, masuk rekap pola" if not lok else "tidak ada ambang yang terpenuhi")
    # Lingkaran tertutup: bila tanggapan polisi/petugas sudah terlihat di pemberitaan, kasus Tindak/Pantau
    # tidak perlu diteruskan ulang; ia masuk rekap (Tercatat) dengan keterangan sudah ditanggapi.
    if tanggap and status in ("TINDAK", "PANTAU"):
        alasan = [f"semula {status.lower()}: " + "; ".join(alasan), f"tanggapan sudah terlihat: “{tanggap['kata']}”"]
        status = "TERCATAT"
    batas_teks, batas_jam = BATAS[status]
    lewat = bool(batas_jam and not tanggap and umur_jam > batas_jam)
    return {
        "id": k["id"], "topik": k["topik"], "topik_nama": t["nama"], "status": status, "alasan": alasan,
        "lok": lok, "penanggung_jawab": penanggung_jawab(status, lok), "batas_waktu": batas_teks,
        "pertama": k["pertama"], "terakhir": k["terakhir"], "umur_jam": round(umur_jam, 1),
        "n_media": len(media), "n_artikel": len(k["artikel"]), "media": media[:8],
        "judul": urut[0]["judul"],
        "artikel": [{"judul": a["judul"], "media": a["media"], "url": a["url"], "terbit": a["terbit"]}
                    for a in sorted(k["artikel"], key=lambda a: a["terbit"], reverse=True)[:6]],
        "tanggapan": tanggap, "jeda_tanggapan_jam": jeda, "melewati_batas": lewat,
    }


# ============================================================ ARSIPKAN
KOLOM_ARSIP = ["id", "pertama_utc", "tanggal_wib", "bulan", "topik", "kode_prov", "provinsi", "kode_kab", "kabkota",
               "status", "n_media", "n_artikel", "tanggapan_terlihat", "tanggapan_sejak_awal", "jeda_tanggapan_jam",
               "diperbarui_utc"]


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
            "diperbarui_utc": iso(NOW)}


def hitung_lonjakan(arsip, aktif):
    """Lonjakan per (provinsi, topik): kasus 24 jam terakhir >= 2 x rata-rata harian 28 hari sebelumnya dan >= 5."""
    hari_ini = Counter()
    for h in aktif:
        if NOW - dari_iso(h["pertama"]) <= timedelta(hours=24):
            hari_ini[((h["lok"] or {}).get("kode_prov"), h["topik"])] += 1
    awal = min((r["tanggal_wib"] for r in arsip.values()), default=None)
    hari_riwayat = 0
    harian = Counter()
    batas_bawah = (NOW - timedelta(days=29)).astimezone(WIB).strftime("%Y-%m-%d")
    kemarin = (NOW - timedelta(days=1)).astimezone(WIB).strftime("%Y-%m-%d")
    for r in arsip.values():
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
    for r in arsip.values():
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


# ============================================================ UTAMA
def main():
    log("PEKA mulai", iso(NOW), "(mode uji)" if FIXTURE else "")
    terlihat = baca_json("_terlihat.json", {})
    kasus = baca_json("_kasus_cache.json", [])
    # bersihkan cache lama
    batas = iso(NOW - SIMPAN)
    terlihat = {k: v for k, v in terlihat.items() if v and v >= batas}
    kasus = [k for k in kasus if k["terakhir"] >= batas]

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
                         "median_jeda_jam": round(statistics.median(jeda), 1) if jeda else None, "n_jeda": len(jeda),
                         "melewati_batas": sum(1 for h in jendela72 if h["melewati_batas"])},
            "arsipkan": {"baris": len(arsip), "bulan": len({r["bulan"] for r in arsip.values()}),
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
    tulis_json("kasus_terkini.json", {"diperbarui_utc": iso(NOW), "kasus": hasil[:400]}, ringkas=True)
    tulis_json("gdelt_tren.json", gd)
    tulis_json("bmkg.json", bmkg)
    tulis_json("arsip_bulanan.json", {"diperbarui_utc": iso(NOW), "bulan": ringkas_bulanan(arsip)})
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
