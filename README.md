# PEKA - Pendengar Keluhan Warga (purwarupa)

Purwarupa pendamping karya tulis **"Didengar Sebelum Viral: Delapan Dekade Suara Warga kepada
Kepolisian (1945–2026) dan PEKA, Sistem Pendengar Keluhan Warga untuk Reformasi Polri Menuju
Indonesia Emas 2045"** untuk Lomba Karya Tulis Ilmiah Sejarah Polri 2026. **Bukan situs resmi Polri.**

Situs: https://mrafiraamadhan.github.io/peka-polri/

## Cara kerja

Setiap jam, GitHub Actions (`.github/workflows/peka.yml`) menjalankan `src/peka_pipeline.py`,
yang menerapkan enam langkah PEKA pada **sumber terbuka saja**:

| Langkah | Yang dikerjakan |
|---|---|
| Dengar | Berita daring (Google News RSS; cadangan Bing News RSS), volume berita GDELT 90 hari, gempa BMKG, daftar hoaks TurnBackHoax (MAFINDO) |
| Pilah | Buang duplikat, saring berita bertanda hoaks atau cek fakta, beri topik (9 topik) dan lokasi sampai kabupaten/kota, gabungkan berita tentang kejadian yang sama menjadi satu kasus |
| Timbang | Status Darurat, Tindak, Pantau, Tercatat, atau Jalur khusus dengan ambang tertulis (Tabel 4.5 naskah) |
| Teruskan | Penanggung jawab menurut wilayah: Polda, Polres, Polsek/Bhabinkamtibmas, atau Propam |
| Kabarkan | Memeriksa apakah tanggapan polisi atau petugas sudah terlihat di pemberitaan dan berapa jam jedanya |
| Arsipkan | `data/arsip_kasus.csv` dan `data/arsip_bulanan.json`: ringkasan tanpa identitas untuk Pusat Sejarah Polri |

Unggahan media sosial **tidak** dibaca. Tidak ada identitas orang yang disimpan.

## Alat untuk menutup lingkaran

- **Lacak kabar**: setiap kasus aktif punya halaman `#lacak=<id>` (diterima, ditimbang, diteruskan, tanggapan,
  diarsipkan) beserta kode QR, sebagai contoh kode yang dicetak pada surat tanda terima laporan, SP2HP, dan SP3D.
- **Ringkasan pagi per Polda** (tab Per Polda): satu halaman siap cetak untuk apel pagi.
- **Papan kabar balik per Polda**: 30 hari, persentase kasus perlu tindak lanjut yang tanggapannya terlihat,
  median jeda, dan yang melewati batas. Indikatif, bukan peringkat kinerja.
- **Titik rawan berulang**: kab/kota dengan >= 3 kejadian terpisah (berselang >= 72 jam) pada topik yang sama
  dalam 30 hari, untuk pemolisian berbasis masalah.

## Berkas

- `index.html` - papan pantau (menu tab, mode gelap/terang)
- `src/peka_pipeline.py` - pipeline; `src/buat_wilayah.py` - penyusun gazeter wilayah
- `config/topik.json` - kata kunci sembilan topik; `config/wilayah.json` - 38 provinsi, 514 kab/kota, Polda
- `data/` - keluaran pipeline (diperbarui otomatis)
- `assets/vendor/qrcode.js` - pembuat kode QR (qrcode-generator, Kazuhiko Arase, lisensi MIT)

Sumber data gempa: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika).
