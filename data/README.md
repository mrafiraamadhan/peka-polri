# Folder data

Diisi otomatis oleh `src/peka_pipeline.py` setiap jam. Jangan diedit manual.

- `ringkasan.json` - jumlah kasus per status, per topik, per provinsi, dan angka enam langkah
- `kasus_terkini.json` - kasus aktif (berita terakhir dalam 72 jam) beserta status, alasan, penanggung jawab, dan tanggapan
- `gdelt_tren.json` - volume berita harian 90 hari per topik (GDELT)
- `bmkg.json` - gempa terbaru, gempa M 5+, dan gempa dirasakan (sumber: BMKG)
- `arsip_kasus.csv` - arsip satu baris per kasus, tanpa judul, tautan, atau identitas
- `arsip_bulanan.json` - rekap bulanan untuk Pusat Sejarah Polri
- `status_sumber.json` - kapan tiap sumber dicek, berhasil atau gagal, dan log singkat
- `_kasus_cache.json`, `_terlihat.json` - cache internal (dihapus otomatis setelah 4 hari)
