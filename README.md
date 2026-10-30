# PEKA - Pendengar Keluhan Warga (purwarupa)

Purwarupa pendamping karya tulis **"Didengar Sebelum Viral: Delapan Dekade Suara Warga kepada Kepolisian (1945–2026) dan PEKA, Sistem Pendengar Keluhan Warga untuk Reformasi Polri Menuju Indonesia Emas 2045"** untuk Lomba Karya Tulis Ilmiah Sejarah Polri 2026. **Bukan situs resmi Polri.**

Situs: https://mrafiraamadhan.github.io/peka-polri/

## Cara kerja

Kira-kira setiap jam, GitHub Actions (`.github/workflows/peka.yml`) menjalankan `src/peka_pipeline.py`,
yang menerapkan enam langkah PEKA pada **sumber terbuka saja**:

| Langkah | Yang dikerjakan |
|---|---|
| Dengar | Berita daring (Google News RSS; cadangan Bing News RSS), volume berita GDELT 90 hari, gempa BMKG, daftar hoaks TurnBackHoax (MAFINDO) |
| Pilah | Buang duplikat, saring berita bertanda hoaks atau cek fakta, beri topik (9 topik) dan lokasi sampai kabupaten/kota, gabungkan berita tentang kejadian yang sama menjadi satu kasus |
| Timbang | Status Darurat, Tindak, Pantau, Tercatat, atau Jalur khusus dengan ambang tertulis (Tabel 4.6 naskah) |
| Teruskan | Penanggung jawab menurut wilayah: Polda, Polres, Polsek/Bhabinkamtibmas, atau Propam |
| Kabarkan | Memeriksa apakah tanggapan polisi atau petugas sudah terlihat di pemberitaan dan berapa jam jedanya |
| Arsipkan | `data/arsip_kasus.csv` dan `data/arsip_bulanan.json`: ringkasan tanpa identitas untuk Pusat Sejarah Polri |

Unggahan media sosial **tidak** dibaca. Judul berita disimpan sebagaimana terbit (sumber publik); nama anggota pada kasus
jalur khusus disingkat menjadi inisial; arsip untuk Pusat Sejarah Polri tidak memuat judul, tautan, atau nama.

**Cadangan jadwal.** Jadwal cron GitHub bisa terlambat atau terlewat. Karena itu setiap putaran, setelah
menunggu lewat *wait timer* environment `jeda-sejam`, menjalankan putaran berikutnya sendiri. Atur sekali:
Settings → Environments → New environment `jeda-sejam` → centang *Wait timer* → 50 menit → Save.
Bila environment ini belum diatur, putaran berantai tidak dijalankan dan PEKA bergantung pada cron saja.

**Aturan dapat dikoreksi.** Salah golong yang ditemukan diperbaiki di `config/topik.json`
(misalnya `bukan_keluhan` untuk razia rutin dan imbauan, `kecuali` untuk "oknum anggota DPRD").
Kasus yang tersimpan disaring ulang dengan aturan terbaru pada putaran berikutnya. Arsip hanya bertambah:
baris yang ternyata salah golong diberi keterangan `koreksi` dan versi aturannya, tidak dihapus.
Riwayat perubahan aturan terbuka di daftar commit; versi aturan tercatat di `ringkasan.json` (`versi_aturan`).

**Rute jalur khusus.** Keluhan tidak pernah dikirim ke satuan yang dikeluhkan (Perpol 2/2024):
perilaku anggota ke Propam satu tingkat di atasnya (Seksi Propam Polres untuk anggota Polsek, Bidpropam Polda
untuk anggota Polres, Divpropam untuk anggota Polda); kekerasan oleh aparat ke Propam dan reserse satu tingkat
di atasnya dengan tembusan Kompolnas dan Komnas HAM; keluhan atas penanganan perkara (laporan mandek, SP2HP)
ke Bagwassidik Direktorat Reserse Polda dan Itwasda; laporan yang ditolak ke Itwasda. Nama anggota pada
kasus jalur khusus disingkat menjadi inisial karena belum ada putusan.

**Data uji naskah.** Angka Subbab 4.3.9 naskah berasal dari satu putaran yang salinannya dibekukan di
`uji-naskah/2026-10-30/` (data, versi aturan, dan berkas label uji presisi; lihat README di folder itu).
Buka dengan `?data=uji-naskah/2026-10-30` di alamat situs. Sampel uji ditarik dengan `uji/sampel_presisi.py`
(benih 20261030) dan dinilai dengan `uji/buku_kode.md`.

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
- `config/topik.json` - kata kunci sembilan topik dan aturan rute; `config/wilayah.json` - 38 provinsi, 514 kab/kota, Polda,
  nama Polres resmi (`src/nama_satuan.py`); `config/districts.csv` - daftar kecamatan untuk petunjuk lokasi
  (sumber yang sama dengan daftar kab/kota: edwardsamuel/Wilayah-Administratif-Indonesia)
- `data/` - keluaran pipeline (diperbarui otomatis)
- `assets/vendor/qrcode.js` - pembuat kode QR (qrcode-generator, Kazuhiko Arase, lisensi MIT)

Sumber data gempa: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika).
