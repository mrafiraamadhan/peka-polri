# Buku kode uji presisi PEKA

Pelabel membaca judul dan judul lain dalam satu kasus. Kolom keluaran PEKA (status, penanggung jawab) dibaca
**setelah** label L_relevan, L_jenis, dan L_lokasi diisi.

| Kolom | Isi | Nilai |
|---|---|---|
| L_relevan | Apakah kasus ini kejadian atau keluhan kamtibmas di Indonesia yang relevan bagi polisi? | 1 = ya; 0 = derau (kegiatan/sosialisasi, kebijakan/statistik, opini, persidangan, instansi lain, luar negeri) |
| L_jenis | Jenis suara | keluhan_polisi (tentang perilaku anggota); keluhan_perkara (penanganan perkara mandek/ditolak); kejadian_belum (kejadian yang belum terlihat ditangani); rilis (penindakan yang sudah dilakukan polisi); bencana |
| L_lokasi | Lokasi kab/kota yang dipakai PEKA | benar; salah; kosong_ada (judul menyebut tempat tetapi PEKA kosong); kosong_tidak (judul memang tidak menyebut tempat) |
| L_status | Status PEKA dibanding Tabel 4.6 | tepat; terlalu_tinggi; terlalu_rendah |
| L_rute | Penanggung jawab PEKA dibanding Tabel 4.6 | tepat; salah_fungsi; salah_wilayah; tidak_dapat (lokasi kosong) |
| L_tanggapan | Deteksi tanggapan polisi | benar; salah_tutup (dianggap ditanggapi padahal belum); terlewat (sudah ditanggapi tetapi tidak terbaca) |

Ukuran yang dilaporkan (dengan selang kepercayaan Wilson 95%):
- **relevansi** = L_relevan = 1 dibagi semua kasus sampel;
- **presisi daftar tindak lanjut** = kasus berstatus Darurat, Jalur khusus, Tindak, atau Pantau yang relevan dan L_status = tepat, dibagi semua kasus berstatus itu (rencana awal juga menerima "terlalu tinggi satu tingkat", tetapi label tidak mencatat selisih tingkat, sehingga dipakai ukuran yang lebih ketat ini);
- **rute tepat** = L_rute = tepat dibagi kasus relevan yang lokasinya terisi;
- **lokasi benar** = L_lokasi = benar dibagi kasus relevan yang judulnya menyebut tempat;
- **salah tutup** = L_tanggapan = salah_tutup dibagi kasus relevan.
- **rute tepat bila status tepat** = L_rute = tepat dibagi kasus relevan yang lokasinya terisi dan L_status = tepat
  (ukuran ini memisahkan kesalahan rute dari kesalahan status; pelabel menilai rute terhadap kebutuhan kasus,
  sehingga rute dari status yang keliru ikut dihitung salah pada ukuran **rute tepat**);
- **keluhan tentang polisi yang masuk jalur khusus** = kasus dengan L_jenis keluhan_polisi atau keluhan_perkara
  yang berstatus Jalur khusus, dibagi semua kasus dengan L_jenis itu;
- **tanggapan terlewat** = L_tanggapan = terlewat dibagi kasus relevan.

Catatan aturan versi 2026-10-31 (uji kedua): perilaku anggota yang sudah diperiksa Propam atau diproses penyidik berstatus
Tercatat dengan jenis `anggota_ditangani` (dipantau kabar baliknya oleh Itwasda, rekap bulanan Kompolnas); status itu
dinilai **tepat** bila kasusnya memang sudah ditangani. Ukuran **keluhan tentang polisi yang keluar dari lingkungan yang
dikeluhkan** = kasus dengan L_jenis keluhan_polisi atau keluhan_perkara yang berstatus Jalur khusus atau berjenis
`anggota_ditangani`, dibagi semua kasus dengan L_jenis itu.
