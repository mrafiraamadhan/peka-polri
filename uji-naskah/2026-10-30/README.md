# Data uji naskah, 30 Oktober 2026

Folder ini membekukan data yang dipakai Subbab 4.3.9 naskah. Buka di situs dengan
`?data=uji-naskah/2026-10-30`.

## Asal data

- Cache kasus dari commit `cc23927` (putaran 30 Oktober 2026 pukul 04.15 UTC / 11.15 WIB).
- Diproses ulang dengan `src/peka_pipeline.py` aturan versi `2026-10-30` (`topik.json` di folder ini),
  tanpa mengambil sumber baru (mode uji, jam diatur ke waktu commit).
- `bmkg.json`, `gdelt_tren.json`, `status_sumber.json`, serta angka langkah *dengar* dan *pilah*,
  hoaks, dan gempa pada `ringkasan.json` disalin dari putaran asli commit itu, karena tidak bergantung
  pada aturan. Angka *timbang* sampai *arsipkan* dihitung ulang dengan aturan versi 2026-10-30.
- Arsip hanya bertambah: 68 baris lama yang tidak lolos aturan baru diberi keterangan `koreksi`, tidak dihapus.

## Uji presisi

- Sampel bertingkat 142 kasus (benih 20261030): sensus seluruh kasus Jalur khusus (13), Tindak (10), dan Pantau (59)
  yang tersisa, ditambah 60 kasus Tercatat acak; ditarik dengan
  `python uji/sampel_presisi.py uji-naskah/2026-10-30 <keluaran>`, setelah 75 kasus pengembangan
  (`uji/sampel_pengembangan.json`) dikeluarkan. Dari 75 kasus itu, 62 ada di data uji: 22 dari 35 Jalur khusus,
  19 dari 29 Tindak, satu-satunya Darurat, 13 Pantau, dan 7 Tercatat.
- `label_presisi.csv`: sampel beserta keluaran PEKA, label tahap 1 (buta: relevansi, jenis, lokasi) dan tahap 2 (status, rute,
  tanggapan) menurut `uji/buku_kode.md`.
- `label_antarpelabel.csv`: label buta kedua atas 50 kasus acak untuk mengukur kesepakatan.
- `hasil_presisi.json`: ukuran dan selang kepercayaan Wilson 95%.

Pelabelan dikerjakan dalam dua putaran terpisah dengan bantuan model bahasa besar yang diberi buku
kode yang sama. Label terbuka agar dapat diperiksa ulang oleh pelabel manusia.
