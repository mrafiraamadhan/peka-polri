"""Nama Polres menurut nomenklatur yang dipakai Polri (Polres Metro, Polrestabes, Polresta, Polres ... Kota).
Dipakai buat_wilayah.py; juga dapat dijalankan sendiri untuk memperbarui config/wilayah.json.
Daftar ini disusun dari nama satuan yang dipakai situs dan rilis resmi Polri; bila ada yang keliru,
cukup ubah kamus di bawah lalu jalankan ulang."""
import json
from pathlib import Path

METRO = {  # wilayah hukum Polda Metro Jaya
    "Kota Jakarta Pusat": "Polres Metro Jakarta Pusat", "Kota Jakarta Utara": "Polres Metro Jakarta Utara",
    "Kota Jakarta Barat": "Polres Metro Jakarta Barat", "Kota Jakarta Selatan": "Polres Metro Jakarta Selatan",
    "Kota Jakarta Timur": "Polres Metro Jakarta Timur", "Kabupaten Kepulauan Seribu": "Polres Kepulauan Seribu",
    "Kota Bekasi": "Polres Metro Bekasi Kota", "Kabupaten Bekasi": "Polres Metro Bekasi",
    "Kota Depok": "Polres Metro Depok", "Kota Tangerang": "Polres Metro Tangerang Kota",
    "Kota Tangerang Selatan": "Polres Tangerang Selatan",
}
TABES = {"Kota Medan", "Kota Palembang", "Kota Bandung", "Kota Semarang", "Kota Surabaya", "Kota Makassar"}
POLRESTA = {  # nama kab/kota -> nama satuan
    "Kota Banda Aceh": "Polresta Banda Aceh", "Kota Padang": "Polresta Padang", "Kota Pekanbaru": "Polresta Pekanbaru",
    "Kota Jambi": "Polresta Jambi", "Kota Bengkulu": "Polresta Bengkulu", "Kota Bandar Lampung": "Polresta Bandar Lampung",
    "Kota Pangkal Pinang": "Polresta Pangkalpinang", "Kota Tanjung Pinang": "Polresta Tanjungpinang",
    "Kota Batam": "Polresta Barelang", "Kota Bogor": "Polresta Bogor Kota", "Kota Yogyakarta": "Polresta Yogyakarta",
    "Kota Surakarta": "Polresta Surakarta", "Kota Malang": "Polresta Malang Kota", "Kota Serang": "Polresta Serang Kota",
    "Kota Denpasar": "Polresta Denpasar", "Kota Mataram": "Polresta Mataram", "Kota Kupang": "Polresta Kupang Kota",
    "Kota Pontianak": "Polresta Pontianak", "Kota Palangka Raya": "Polresta Palangka Raya",
    "Kota Banjarmasin": "Polresta Banjarmasin", "Kota Samarinda": "Polresta Samarinda",
    "Kota Balikpapan": "Polresta Balikpapan", "Kota Manado": "Polresta Manado", "Kota Palu": "Polresta Palu",
    "Kota Kendari": "Polresta Kendari", "Kota Gorontalo": "Polresta Gorontalo Kota",
    "Kota Ambon": "Polresta Pulau Ambon dan Pulau-Pulau Lease", "Kota Jayapura": "Polresta Jayapura Kota",
    "Kota Sorong": "Polresta Sorong Kota",
    "Kabupaten Deli Serdang": "Polresta Deli Serdang", "Kabupaten Tangerang": "Polresta Tangerang",
    "Kabupaten Bandung": "Polresta Bandung", "Kabupaten Cirebon": "Polresta Cirebon",
    "Kabupaten Sidoarjo": "Polresta Sidoarjo", "Kabupaten Banyuwangi": "Polresta Banyuwangi",
    "Kabupaten Cilacap": "Polresta Cilacap", "Kabupaten Banyumas": "Polresta Banyumas", "Kabupaten Pati": "Polresta Pati",
    "Kabupaten Magelang": "Polresta Magelang", "Kabupaten Sleman": "Polresta Sleman",
}
GANTI_NAMA = {  # nama kabupaten baru
    "Kabupaten Kota Baru": ("Kabupaten Kotabaru", "Kotabaru"),
    "Kabupaten Mamuju Utara": ("Kabupaten Pasangkayu", "Pasangkayu"),
}


def nama_polres(k, inti_kabupaten):
    if k["nama"] in METRO:
        return METRO[k["nama"]]
    if k["nama"] in TABES:
        return "Polrestabes " + k["inti"]
    if k["nama"] in POLRESTA:
        return POLRESTA[k["nama"]]
    if k["nama"] == "Kota Banjar":       # Kota Banjar (Jawa Barat) dilayani Polres Banjar
        return "Polres Banjar"
    if k["jenis"] == "Kota":
        return f"Polres {k['inti']} Kota" if k["inti"] in inti_kabupaten else f"Polres {k['inti']}"
    return "Polres " + k["inti"]


def terapkan(kabkota):
    for k in kabkota:
        if k["nama"] in GANTI_NAMA:
            k["nama"], k["inti"] = GANTI_NAMA[k["nama"]]
    inti_kab = {k["inti"] for k in kabkota if k["jenis"] == "Kabupaten"}
    for k in kabkota:
        k["polres"] = nama_polres(k, inti_kab)
    return kabkota


if __name__ == "__main__":
    f = Path(__file__).resolve().parents[1] / "config" / "wilayah.json"
    w = json.loads(f.read_text(encoding="utf-8"))
    terapkan(w["kabkota"])
    f.write_text(json.dumps(w, ensure_ascii=False, indent=0), encoding="utf-8")
    print("nama satuan diperbarui:", len(w["kabkota"]), "kab/kota")
