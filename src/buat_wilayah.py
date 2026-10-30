#!/usr/bin/env python3
"""Sekali jalan: menyusun config/wilayah.json dari daftar kabupaten/kota (kode Kemendagri)
sumber https://github.com/edwardsamuel/Wilayah-Administratif-Indonesia (34 provinsi, 514 kab/kota),
ditambah empat provinsi pemekaran Papua 2022 dan nama Polda yang membawahi tiap provinsi."""
import csv, json, re, collections
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

PROV = {  # kode: (nama tampil, polda, alias)
 "11": ("Aceh", "Polda Aceh", ["Aceh", "NAD"]),
 "12": ("Sumatera Utara", "Polda Sumatera Utara", ["Sumatera Utara", "Sumut", "Polda Sumut"]),
 "13": ("Sumatera Barat", "Polda Sumatera Barat", ["Sumatera Barat", "Sumbar", "Polda Sumbar"]),
 "14": ("Riau", "Polda Riau", ["Riau"]),
 "15": ("Jambi", "Polda Jambi", ["Jambi"]),
 "16": ("Sumatera Selatan", "Polda Sumatera Selatan", ["Sumatera Selatan", "Sumsel", "Polda Sumsel"]),
 "17": ("Bengkulu", "Polda Bengkulu", ["Bengkulu"]),
 "18": ("Lampung", "Polda Lampung", ["Lampung"]),
 "19": ("Kepulauan Bangka Belitung", "Polda Kepulauan Bangka Belitung", ["Bangka Belitung", "Babel", "Polda Babel"]),
 "21": ("Kepulauan Riau", "Polda Kepulauan Riau", ["Kepulauan Riau", "Kepri", "Polda Kepri"]),
 "31": ("DKI Jakarta", "Polda Metro Jaya", ["DKI Jakarta", "Jakarta", "DKI", "Polda Metro Jaya", "Polda Metro", "Ibu Kota"]),
 "32": ("Jawa Barat", "Polda Jawa Barat", ["Jawa Barat", "Jabar", "Polda Jabar"]),
 "33": ("Jawa Tengah", "Polda Jawa Tengah", ["Jawa Tengah", "Jateng", "Polda Jateng"]),
 "34": ("DI Yogyakarta", "Polda DI Yogyakarta", ["Yogyakarta", "Jogja", "Yogya", "Jogjakarta", "DIY", "Polda DIY"]),
 "35": ("Jawa Timur", "Polda Jawa Timur", ["Jawa Timur", "Jatim", "Polda Jatim"]),
 "36": ("Banten", "Polda Banten", ["Banten"]),
 "51": ("Bali", "Polda Bali", ["Bali"]),
 "52": ("Nusa Tenggara Barat", "Polda Nusa Tenggara Barat", ["Nusa Tenggara Barat", "NTB", "Polda NTB"]),
 "53": ("Nusa Tenggara Timur", "Polda Nusa Tenggara Timur", ["Nusa Tenggara Timur", "NTT", "Polda NTT"]),
 "61": ("Kalimantan Barat", "Polda Kalimantan Barat", ["Kalimantan Barat", "Kalbar", "Polda Kalbar"]),
 "62": ("Kalimantan Tengah", "Polda Kalimantan Tengah", ["Kalimantan Tengah", "Kalteng", "Polda Kalteng"]),
 "63": ("Kalimantan Selatan", "Polda Kalimantan Selatan", ["Kalimantan Selatan", "Kalsel", "Polda Kalsel"]),
 "64": ("Kalimantan Timur", "Polda Kalimantan Timur", ["Kalimantan Timur", "Kaltim", "Polda Kaltim"]),
 "65": ("Kalimantan Utara", "Polda Kalimantan Utara", ["Kalimantan Utara", "Kaltara", "Polda Kaltara"]),
 "71": ("Sulawesi Utara", "Polda Sulawesi Utara", ["Sulawesi Utara", "Sulut", "Polda Sulut"]),
 "72": ("Sulawesi Tengah", "Polda Sulawesi Tengah", ["Sulawesi Tengah", "Sulteng", "Polda Sulteng"]),
 "73": ("Sulawesi Selatan", "Polda Sulawesi Selatan", ["Sulawesi Selatan", "Sulsel", "Polda Sulsel"]),
 "74": ("Sulawesi Tenggara", "Polda Sulawesi Tenggara", ["Sulawesi Tenggara", "Sultra", "Polda Sultra"]),
 "75": ("Gorontalo", "Polda Gorontalo", ["Gorontalo"]),
 "76": ("Sulawesi Barat", "Polda Sulawesi Barat", ["Sulawesi Barat", "Sulbar", "Polda Sulbar"]),
 "81": ("Maluku", "Polda Maluku", ["Maluku"]),
 "82": ("Maluku Utara", "Polda Maluku Utara", ["Maluku Utara", "Malut", "Polda Malut"]),
 "91": ("Papua Barat", "Polda Papua Barat", ["Papua Barat", "Polda Papua Barat"]),
 "94": ("Papua", "Polda Papua", ["Papua", "Polda Papua"]),
 # Pemekaran 2022 (kode provinsi BPS baru). Penanggung jawab ditulis umum
 # karena struktur Polda di wilayah baru masih berkembang.
 "92": ("Papua Barat Daya", "Polda yang membawahi Papua Barat Daya", ["Papua Barat Daya"]),
 "95": ("Papua Selatan", "Polda yang membawahi Papua Selatan", ["Papua Selatan"]),
 "96": ("Papua Tengah", "Polda yang membawahi Papua Tengah", ["Papua Tengah"]),
 "97": ("Papua Pegunungan", "Polda yang membawahi Papua Pegunungan", ["Papua Pegunungan"]),
}
PEMEKARAN = {  # nama kab/kota (huruf besar, tanpa awalan) -> provinsi baru (kode BPS)
 "95": ["MERAUKE", "BOVEN DIGOEL", "MAPPI", "ASMAT"],
 "96": ["NABIRE", "PANIAI", "MIMIKA", "PUNCAK JAYA", "PUNCAK", "DOGIYAI", "INTAN JAYA", "DEIYAI"],
 "97": ["JAYAWIJAYA", "LANNY JAYA", "MAMBERAMO TENGAH", "NDUGA", "PEGUNUNGAN BINTANG", "TOLIKARA", "YAHUKIMO", "YALIMO"],
 "92": ["SORONG", "SORONG SELATAN", "RAJA AMPAT", "TAMBRAUW", "MAYBRAT"],
}
# Nama yang juga kata umum atau nama lain; hanya dikenali bila didahului penanda tempat.
RAWAN = {"MALANG", "BATU", "BANJAR", "BONE", "AGAM", "BARRU", "BURU", "MUNA", "PATI", "KUDUS", "KAUR",
         "LAHAT", "SABU RAIJUA", "ALOR", "ENDE", "BELU", "MALAKA", "PUNCAK", "LANDAK", "TOBA", "LINGGA",
         "SIGI", "TOJO UNA-UNA", "KARO", "DAIRI", "BIMA", "DOMPU", "SIAK", "SOLOK", "KAPUAS", "MELAWI",
         "KOTABARU", "TANAH LAUT", "BALANGAN", "PASER", "BERAU", "MAROS", "GOWA", "WAJO", "SOPPENG",
         "SINJAI", "BANTAENG", "TAKALAR", "PINRANG", "ENREKANG", "LUWU", "BOLAANG MONGONDOW", "BITUNG",
         "TUAL", "NABIRE", "SARMI", "KEEROM", "ASMAT", "MAPPI", "BIAK NUMFOR", "SUPIORI", "WAROPEN",
         "KAIMANA", "FAKFAK", "MAYBRAT", "TAMBRAUW", "NDUGA", "YALIMO", "DEIYAI", "DOGIYAI", "PANIAI",
         "MIMIKA", "BANGLI", "BADUNG", "TABANAN", "JEMBRANA", "KLUNGKUNG", "KARANGASEM", "GIANYAR",
         "BULELENG", "NGADA", "SIKKA", "NAGEKEO", "LEMBATA", "MANGGARAI", "SUMBA BARAT", "KUPANG",
         "BLITAR", "KEDIRI", "MADIUN", "MAGETAN", "NGAWI", "PACITAN", "TUBAN", "BLORA", "DEMAK",
         "BATANG", "PEMALANG", "TEGAL", "BREBES", "KENDAL", "BLANG", "LANGSA", "NIAS", "SAMOSIR",
         "ASAHAN", "LABUHANBATU", "PAKPAK BHARAT", "BENGKALIS", "KAMPAR", "PELALAWAN", "ROKAN HULU",
         "NATUNA", "BINTAN", "KARIMUN", "ANAMBAS", "MERANGIN", "TEBO", "BUNGO", "SAROLANGUN",
         "MUARO JAMBI", "LEBONG", "SELUMA", "KEPAHIANG", "MESUJI", "TULANG BAWANG", "WAY KANAN",
         "PRINGSEWU", "PESAWARAN", "METRO", "KAPUAS HULU", "SEKADAU", "SINTANG", "KETAPANG", "SAMBAS",
         "BENGKAYANG", "SERUYAN", "KATINGAN", "LAMANDAU", "SUKAMARA", "BARITO", "TABALONG", "TAPIN",
         "MAHAKAM ULU", "TANA TIDUNG", "MALINAU", "NUNUKAN", "BULUNGAN", "POSO", "BUOL", "BANGGAI",
         "MOROWALI", "PARIGI MOUTONG", "TOLITOLI", "DONGGALA", "MAJENE", "MAMASA", "MAMUJU",
         "POLEWALI MANDAR", "PASANGKAYU", "KOLAKA", "KONAWE", "BUTON", "WAKATOBI", "BOMBANA",
         "BOALEMO", "POHUWATO", "PULAU MOROTAI", "HALMAHERA", "TIDORE", "TERNATE", "SERAM",
         "AMBON", "ARU", "SULA", "TALIABU", "SANGIHE", "TALAUD", "SITARO", "MINAHASA", "TOMOHON",
         "KOTAMOBAGU", "BOLMONG", "SUMEDANG", "MAJALENGKA", "KUNINGAN", "INDRAMAYU", "SUBANG",
         "PURWAKARTA", "KARAWANG", "CIAMIS", "PANGANDARAN", "GARUT", "TASIKMALAYA", "CIANJUR",
         "SUKABUMI", "LEBAK", "PANDEGLANG", "SERANG", "CILEGON", "SITUBONDO", "BONDOWOSO", "PROBOLINGGO",
         "LUMAJANG", "JEMBER", "BANYUWANGI", "SAMPANG", "PAMEKASAN", "SUMENEP", "BANGKALAN",
         "LAMONGAN", "GRESIK", "BOJONEGORO", "JOMBANG", "NGANJUK", "TRENGGALEK", "TULUNGAGUNG",
         "PONOROGO", "MOJOKERTO", "PASURUAN", "SIDOARJO", "KLATEN", "BOYOLALI", "SRAGEN", "WONOGIRI",
         "KARANGANYAR", "SUKOHARJO", "GROBOGAN", "REMBANG", "JEPARA", "PURWOREJO", "KEBUMEN",
         "CILACAP", "BANYUMAS", "PURBALINGGA", "BANJARNEGARA", "WONOSOBO", "TEMANGGUNG", "MAGELANG",
         "SALATIGA", "PEKALONGAN", "SLEMAN", "BANTUL", "KULON PROGO", "GUNUNGKIDUL", "GUNUNG KIDUL"}
# RAWAN di atas sengaja lebar: nama yang aman tetap dikenali bila diawali penanda tempat
# (di, Kota, Kabupaten, Polres, warga, asal). Nama yang benar-benar khas dikenali langsung.
KHAS = {"SLEMAN", "BANTUL", "GUNUNGKIDUL", "SIDOARJO", "BANYUWANGI", "JEMBER", "GRESIK", "LAMONGAN",
        "BOJONEGORO", "JOMBANG", "NGANJUK", "TULUNGAGUNG", "PONOROGO", "MOJOKERTO", "PASURUAN",
        "PROBOLINGGO", "LUMAJANG", "SITUBONDO", "BONDOWOSO", "SAMPANG", "PAMEKASAN", "SUMENEP",
        "BANGKALAN", "KLATEN", "BOYOLALI", "SRAGEN", "WONOGIRI", "KARANGANYAR", "SUKOHARJO",
        "GROBOGAN", "REMBANG", "JEPARA", "PURWOREJO", "KEBUMEN", "CILACAP", "BANYUMAS", "PURBALINGGA",
        "BANJARNEGARA", "WONOSOBO", "TEMANGGUNG", "MAGELANG", "SALATIGA", "PEKALONGAN", "SUMEDANG",
        "MAJALENGKA", "INDRAMAYU", "PURWAKARTA", "KARAWANG", "CIAMIS", "PANGANDARAN", "GARUT",
        "TASIKMALAYA", "CIANJUR", "SUKABUMI", "PANDEGLANG", "CILEGON", "MINAHASA", "TOMOHON",
        "KOTAMOBAGU", "TERNATE", "AMBON", "MAMUJU", "DONGGALA", "KONAWE", "WAKATOBI", "BOMBANA",
        "POHUWATO", "BOALEMO", "MIMIKA", "NABIRE", "BIAK NUMFOR", "JEMBRANA", "BULELENG",
        "KARANGASEM", "GIANYAR", "KLUNGKUNG", "TABANAN", "BADUNG", "KUPANG", "MANGGARAI", "BLITAR",
        "KEDIRI", "MADIUN", "MAGETAN", "NGAWI", "PACITAN", "TUBAN", "BLORA", "DEMAK", "PEMALANG",
        "BREBES", "KENDAL", "LANGSA", "SAMOSIR", "ASAHAN", "LABUHANBATU", "BENGKALIS", "KAMPAR",
        "PELALAWAN", "NATUNA", "KARIMUN", "MERANGIN", "SAROLANGUN", "MESUJI", "PRINGSEWU",
        "PESAWARAN", "SEKADAU", "SINTANG", "SAMBAS", "BENGKAYANG", "SERUYAN", "KATINGAN", "LAMANDAU",
        "SUKAMARA", "TABALONG", "NUNUKAN", "MALINAU", "BULUNGAN", "MOROWALI", "TOLITOLI", "MAJENE",
        "MAMASA", "KOLAKA", "INDRAGIRI HULU", "KULON PROGO", "SERANG", "LEBAK", "SUBANG", "KUNINGAN",
        "MAROS", "GOWA", "WAJO", "SOPPENG", "SINJAI", "BANTAENG", "TAKALAR", "PINRANG", "ENREKANG",
        "SITARO", "TALAUD", "SANGIHE", "SERAM", "POSO", "BANGGAI", "BUOL", "BITUNG", "DOMPU", "BIMA"}

def bersih(nama):
    nama = re.sub(r"^(KABUPATEN|KOTA)\s+", "", nama.strip())
    if re.fullmatch(r"(?:[A-Z] )+[A-Z]", nama):   # "B A T A M" -> "BATAM"
        nama = nama.replace(" ", "")
    return nama

def tampil(s):
    kecil = {"DAN"}
    out = []
    for w in s.split():
        if w in ("DKI", "DI"): out.append(w)
        elif w in kecil: out.append(w.lower())
        else: out.append("-".join(p.capitalize() for p in w.split("-")))
    return " ".join(out)

reg = list(csv.reader(open(ROOT / "config" / "regencies.csv", encoding="utf-8")))
provnama = collections.defaultdict(set)
for r in reg: provnama[bersih(r[2])].add(r[1])
kabkota = []
for kode, prov, nama in reg:
    jenis = "Kota" if nama.startswith("KOTA") else "Kabupaten"
    inti = bersih(nama)
    p = prov
    if prov in ("91", "94"):
        for baru, daftar in PEMEKARAN.items():
            if inti in daftar:
                p = baru
    rawan = (inti in RAWAN and inti not in KHAS) or len(provnama[inti]) > 1 or len(inti) <= 4
    kabkota.append({
        "kode": kode,
        "nama": f"{jenis} {tampil(inti)}",
        "inti": tampil(inti),
        "jenis": jenis,
        "prov": p,
        "rawan": bool(rawan),
    })
# Kota di wilayah hukum Polda Metro Jaya walau provinsinya Jawa Barat/Banten.
METRO = {"Kota Bekasi", "Kabupaten Bekasi", "Kota Depok", "Kota Tangerang", "Kota Tangerang Selatan"}
for k in kabkota:
    k["polda"] = "Polda Metro Jaya" if k["nama"] in METRO else PROV[k["prov"]][1]
    k["polres"] = ""
import sys; sys.path.insert(0, str(ROOT / "src"))
from nama_satuan import terapkan   # nama satuan resmi: Polres Metro, Polrestabes, Polresta, Polres ... Kota
terapkan(kabkota)
provinsi = [{"kode": k, "nama": v[0], "polda": v[1], "alias": v[2]} for k, v in PROV.items()]
out = {"sumber": "Kode wilayah BPS sebelum pemekaran Papua (data edwardsamuel/Wilayah-Administratif-Indonesia); provinsi pemekaran 2022 memakai kode provinsi BPS baru",
       "provinsi": provinsi, "kabkota": kabkota}
json.dump(out, open(ROOT / "config" / "wilayah.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print(len(provinsi), "provinsi;", len(kabkota), "kab/kota;", sum(k["rawan"] for k in kabkota), "rawan")
print(collections.Counter(k["prov"] for k in kabkota if k["prov"] in ("91","92","94","95","96","97")))
