# Data uji naskah kedua, 31 Oktober 2026

Folder ini membekukan data uji kedua Subbab 4.3.9 naskah. Buka di situs dengan `?data=uji-naskah/2026-10-31`.

## Asal data

- Cache kasus dari commit `5be463b` (putaran 31 Oktober 2026 pukul 02.20 UTC / 09.20 WIB), diproses ulang dengan
  aturan versi `2026-10-31` (`topik.json` di folder ini) memakai `uji/bekukan.py`, tanpa mengambil sumber baru.
  Folder ini dibuat ulang oleh alur kerja `.github/workflows/bekukan.yml`.
- Aturan versi 2026-10-31 adalah koreksi dari uji pertama: kata tanggapan yang terlewat, kata *terungkap* dikeluarkan,
  derau berita kegiatan polisi, keluhan perkara, korban berat, perilaku anggota yang sudah ditangani Propam atau penyidik
  (dipantau kabar baliknya oleh Itwasda), lokasi tujuan aduan dan nama Polda, serta aturan tembusan Kompolnas.

## Uji presisi kedua

- Hanya kasus yang berita pertamanya terbit sesudah data uji pertama dibekukan (2026-10-30T04:15:02Z), sehingga tidak ada
  kasus yang pernah dibaca saat aturan diperbaiki:
  `python uji/sampel_presisi.py uji-naskah/2026-10-31 <keluaran> --sejak 2026-10-30T04:15:02Z`.
- Sampel 149 kasus (penarik sampel yang sama menyensus perkara anggota yang sudah ditangani): sensus 12 Jalur khusus,
  18 Tindak, 53 Pantau, 1 Darurat, dan 5 perkara anggota yang sudah ditangani;
  60 Tercatat acak (benih 20261030).
- `label_presisi.csv`: sampel beserta keluaran PEKA, label tahap 1 (buta) dan tahap 2; `label_antarpelabel.csv`: label
  buta kedua atas 50 kasus acak; `hasil_presisi.json`: ukuran dan selang kepercayaan Wilson 95%.

Pelabelan dikerjakan dalam dua putaran terpisah dengan bantuan model bahasa besar yang diberi buku kode yang sama.
Label terbuka agar dapat diperiksa ulang oleh pelabel manusia.
