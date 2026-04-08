# Panduan Aplikasi SANO

## Platform Kendali Proyek Konstruksi

---

## Daftar Isi

1. Latar Belakang & Mengapa SANO Dibangun
2. Masalah yang Ingin Diselesaikan
3. Bagaimana SANO Menjawab Tantangan Ini
4. Sistem 5 Gate — Alur Kendali Proyek
5. Panduan untuk Supervisor
6. Panduan untuk Estimator
7. Panduan untuk Admin
8. Panduan untuk Prinsipal

---

## 1. Latar Belakang & Mengapa SANO Dibangun

Dalam proyek konstruksi, ada banyak alur kerja yang berjalan bersamaan: permintaan material, penerimaan barang, pencatatan progres, pelacakan cacat, pengelolaan perubahan desain, opname mandor, dan rekonsiliasi keuangan. Selama ini, sebagian besar koordinasi ini dilakukan melalui WhatsApp, catatan manual, atau spreadsheet terpisah-pisah.

Masalah utama dari pendekatan tersebut:

- **Data tersebar** — informasi penting terpencar di chat pribadi, nota fisik, dan file Excel yang berbeda-beda versi. Tidak ada satu sumber kebenaran.
- **Tidak ada jejak audit** — sulit mengetahui siapa yang menyetujui apa, kapan, dan mengapa. Jika terjadi sengketa, tidak ada catatan yang bisa diandalkan.
- **Validasi manual yang lambat** — setiap permintaan material, penerimaan barang, atau klaim opname harus diperiksa secara manual tanpa sistem yang membantu mendeteksi anomali.
- **Laporan dibuat secara manual** — untuk menyiapkan laporan mingguan, rekapitulasi, atau dokumen serah terima, tim harus mengumpulkan data dari berbagai sumber secara manual.
- **Visibilitas terbatas untuk pemilik proyek** — prinsipal sulit melihat kondisi proyek secara real-time tanpa harus bertanya langsung ke tim lapangan.

SANO dibangun untuk menjadi **satu platform terpadu** yang menghubungkan semua peran di proyek — dari supervisor di lapangan hingga prinsipal yang memantau dari jarak jauh. Prinsip utamanya:

> **Input sederhana di lapangan, logika kuat di backend.**

Supervisor cukup mengisi data dengan cepat dari handphone. Sistem yang memproses, memvalidasi, dan menyajikan data tersebut ke pihak yang tepat.

---

## 2. Masalah yang Ingin Diselesaikan

### Pengendalian Material

| Masalah Lama | Solusi SANO |
|---|---|
| Permintaan material via WhatsApp, sering tidak lengkap | Form permintaan terstruktur per item BoQ, dengan validasi otomatis |
| Tidak tahu material sudah sampai berapa dari total pesanan | Penerimaan parsial per PO dengan akumulasi otomatis |
| Material datang tanpa bukti foto, sulit audit | Wajib foto bukti penerimaan, dengan GPS |
| Tidak ada rekonsiliasi material terpakai vs diterima | Material balance otomatis dari data progres dan penerimaan |

### Pencatatan Progres & Mutu

| Masalah Lama | Solusi SANO |
|---|---|
| Progres dilaporkan lewat chat, tidak ada data historis | Log progres per item BoQ, append-only (tidak bisa dihapus/diubah) |
| Cacat ditemukan tapi tidak ada tracking sampai selesai | Siklus hidup cacat: Open → Validated → In Repair → Resolved → Verified |
| Perubahan desain dan VO dicatat seadanya | Catatan perubahan terstruktur dengan klasifikasi penyebab dan dampak biaya |
| Rework tidak tercatat, biayanya "hilang" | Rework dicatat terpisah dan masuk perhitungan performa |

### Pengelolaan Mandor & Tenaga Kerja

| Masalah Lama | Solusi SANO |
|---|---|
| Opname mandor dihitung manual di Excel, rawan salah | Opname mingguan otomatis dari data progres, dengan waterfall: Bruto → Retensi → Sudah Dibayar → Kasbon → Net |
| Kasbon mandor sulit dilacak | Ledger kasbon dengan status dan aging otomatis |
| Absensi pekerja dicatat manual | Sistem absensi per pekerja per hari, dengan perhitungan upah otomatis |
| Kontrak mandor tidak terdokumentasi | Kontrak mandor digital dengan rate per item BoQ dan kategori pekerjaan |

### Pelaporan & Transparansi

| Masalah Lama | Solusi SANO |
|---|---|
| Laporan mingguan dibuat manual, memakan waktu | Laporan otomatis dari data yang sudah masuk: progres, material, keuangan, perubahan |
| Prinsipal harus bertanya langsung untuk tahu status proyek | Dashboard real-time dengan ringkasan hari ini, status keuangan, dan milestone |
| Tidak ada export dokumen untuk arsip atau presentasi | Export ke PDF dan Excel untuk semua jenis laporan |

---

## 3. Bagaimana SANO Menjawab Tantangan Ini

### Satu Sumber Kebenaran

Semua data masuk ke satu database terpusat. Tidak ada lagi data tersebar di chat, notes, atau file terpisah. Setiap aksi terekam: siapa, kapan, apa.

### Pembagian Peran yang Jelas

Setiap pengguna melihat tampilan yang berbeda sesuai perannya:

| Peran | Perangkat Utama | Fokus Tampilan |
|---|---|---|
| **Supervisor** | Handphone | Input data lapangan: permintaan, penerimaan, progres, cacat |
| **Estimator** | Komputer | Review, validasi, analisis: baseline, harga, milestone, performa |
| **Admin** | Komputer | Operasional: PO, vendor, harga, pengadaan |
| **Prinsipal** | Handphone | Monitoring & keputusan: approval, ringkasan, audit |

### Sistem 5 Gate (Pintu Validasi)

SANO menggunakan sistem 5 Gate yang menjadi tulang punggung kendali proyek. Setiap tahap operasional — dari permintaan material sampai laporan akhir — melewati "gate" validasi otomatis. Penjelasan lengkap ada di **Bagian 4**.

### Komunikasi Melalui Data, Bukan Chat

Dengan SANO, koordinasi tim menjadi berbasis data:

- Supervisor input → sistem validasi → estimator/admin review → prinsipal approve
- Setiap langkah terekam, setiap keputusan bisa di-audit
- Notifikasi dan dashboard menggantikan chat manual untuk koordinasi rutin
- Laporan otomatis menggantikan rangkuman manual di grup WhatsApp

---

## 4. Sistem 5 Gate — Alur Kendali Proyek

Dalam konstruksi, uang, material, dan pekerjaan mengalir melalui tahapan yang saling terhubung. SANO memodelkan alur ini sebagai **5 Gate** — lima pintu validasi yang memastikan setiap langkah tercatat, tervalidasi, dan bisa diaudit.

Berikut gambaran besar alurnya:

```
  Gate 1             Gate 2            Gate 3             Gate 4              Gate 5
Permintaan   →   Validasi Harga  →  Penerimaan    →   Progres & Mutu  →  Rekonsiliasi
  Material          & PO              Barang            di Lapangan        & Laporan

Supervisor       Admin/Estimator     Supervisor        Supervisor        Semua Peran
  mengajukan       memproses          mengkonfirmasi    mencatat           mereview
```

Setiap gate memiliki aturan validasi otomatis. Data dari satu gate mengalir ke gate berikutnya, sehingga tidak ada tahap yang terlewat.

### Gate 1 — Permintaan Material

**Tujuan:** Memastikan material yang diminta sesuai kebutuhan proyek, tidak berlebihan, dan terjadwal.

**Siapa yang terlibat:**
- **Supervisor** mengajukan permintaan dari lapangan
- **Estimator** mereview permintaan yang ditandai sistem
- **Prinsipal** menyetujui permintaan besar atau yang bermasalah

**Cara kerja:**

1. Supervisor memilih item BoQ yang membutuhkan material
2. Sistem menampilkan **resep material dari AHS** — daftar material yang seharusnya dibutuhkan untuk item tersebut, beserta kuantitas teoritis
3. Supervisor mengisi kuantitas yang diminta, bisa dalam beberapa baris material sekaligus (satu permintaan bundel)
4. Sistem menjalankan validasi otomatis:

| Pengecekan | Penjelasan |
|---|---|
| **Sisa kebutuhan teoritis** | Untuk material Tier 1 (presisi seperti beton, besi): apakah kuantitas yang diminta masih dalam batas kebutuhan BoQ dikurangi yang sudah diminta/diterima? |
| **Envelope budget** | Untuk material Tier 2 (bulk seperti bata, pasir): apakah total permintaan masih dalam "amplop" anggaran yang ditetapkan? |
| **Spend cap** | Untuk material Tier 3 (consumables seperti paku, kawat): apakah masih dalam batas belanja? |
| **Anomali kecepatan** | Apakah laju permintaan material ini terlalu cepat dibanding progres pekerjaan? |
| **Kewajaran jadwal** | Apakah permintaan ini sesuai dengan milestone yang sedang aktif? |

5. Hasil validasi menentukan **flag** permintaan:
   - **OK** — permintaan wajar, bisa langsung diproses
   - **INFO** — ada catatan tapi tidak menghalangi
   - **WARNING** — perlu perhatian estimator
   - **HIGH / CRITICAL** — perlu review dan persetujuan prinsipal

**Yang dilihat supervisor:** Hanya status sederhana — Terkirim, Sedang Ditinjau, Diblokir, Disetujui. Supervisor tidak melihat detail perhitungan validasi.

**Yang dilihat estimator/prinsipal:** Detail lengkap — alasan flag, perbandingan dengan baseline, histori permintaan.

### Gate 2 — Validasi Harga & Pengadaan

**Tujuan:** Memastikan harga pembelian material wajar dan terdokumentasi sebelum PO diterbitkan.

**Siapa yang terlibat:**
- **Admin** membuat PO, memilih vendor, menginput harga aktual
- **Estimator** mereview deviasi harga dan benchmark
- **Prinsipal** menyetujui pembelian dengan deviasi tinggi

**Cara kerja:**

1. Setelah permintaan material disetujui (Gate 1), admin memproses pengadaan
2. Admin memilih vendor dan menginput harga penawaran
3. Sistem membandingkan harga input dengan:

| Pengecekan | Penjelasan |
|---|---|
| **Deviasi baseline** | Seberapa jauh harga aktual dari harga baseline AHS? |
| **Histori harga** | Bagaimana harga ini dibanding pembelian sebelumnya untuk material yang sama? |
| **Konsistensi vendor** | Apakah vendor ini konsisten dalam penawarannya, atau ada pola harga yang mencurigakan? |

4. Sistem menandai deviasi dengan tingkat keparahan:
   - **OK** — harga wajar
   - **INFO** — sedikit di atas normal, informasi saja
   - **WARNING** — deviasi cukup besar, perlu justifikasi
   - **HIGH** — deviasi signifikan, perlu review estimator
   - **CRITICAL** — deviasi besar, perlu persetujuan prinsipal

5. Admin wajib menuliskan **justifikasi** jika harga menyimpang dari baseline
6. Setelah disetujui, PO diterbitkan dan masuk ke Gate 3

### Gate 3 — Verifikasi Penerimaan Barang

**Tujuan:** Memastikan barang yang datang sesuai PO, tercatat dengan bukti, dan akumulasinya benar.

**Siapa yang terlibat:**
- **Supervisor** mengkonfirmasi penerimaan di lapangan
- **Sistem** menghitung akumulasi dan mendeteksi anomali

**Cara kerja:**

1. Barang datang ke lokasi proyek. Supervisor membuka daftar PO yang aktif.
2. Supervisor mencatat kuantitas yang diterima kali ini
3. **Wajib mengambil foto bukti:**
   - Foto kendaraan pengiriman (otomatis merekam GPS)
   - Foto material yang diterima
   - Foto surat jalan (untuk ready mix)
4. Satu PO bisa diterima dalam **beberapa kali pengiriman** (penerimaan parsial). Sistem menghitung akumulasi otomatis.
5. Sistem menjalankan validasi:

| Pengecekan | Penjelasan |
|---|---|
| **Quantity match** | Apakah total diterima melebihi jumlah yang dipesan? |
| **Kelengkapan foto** | Apakah bukti foto sudah lengkap sesuai ketentuan? |
| **Akumulasi** | Berapa total sudah diterima vs sisa pesanan? |
| **Anomali pola** | Apakah ada pola penerimaan yang mencurigakan? (selalu pas, selalu kurang, dll.) |

6. Status PO otomatis berubah berdasarkan akumulasi:
   - **OPEN** — belum ada penerimaan
   - **PARTIAL RECEIVED** — sudah diterima sebagian
   - **FULLY RECEIVED** — semua sudah diterima
   - **CLOSED** — PO ditutup

7. Sistem secara berkala menjalankan **audit acak** — memilih penerimaan tertentu untuk diperiksa lebih lanjut, terutama jika ada pola anomali.

### Gate 4 — Progres, Mutu, dan Perubahan

**Tujuan:** Mencatat semua pekerjaan yang terpasang, masalah mutu, perubahan desain, dan rework dalam satu hub terpadu.

**Siapa yang terlibat:**
- **Supervisor** mencatat semua data dari lapangan
- **Estimator** memvalidasi cacat dan menganalisis VO/rework
- **Prinsipal** melihat ringkasan masalah yang memblokir serah terima

**Gate 4 adalah hub operasional utama di lapangan.** Dari sini, supervisor bisa mencatat:

#### a. Progres Pemasangan

- Pilih item BoQ → masukkan kuantitas terpasang → foto bukti → simpan
- Data bersifat **append-only**: setiap entry menambah akumulasi, tidak menimpa data sebelumnya
- Sistem menghitung di server: total terpasang, persentase progres, status milestone

#### b. Cacat (Punch List)

Cacat dicatat di dalam Progres, bukan tab terpisah. Siklus hidup cacat:

```
OPEN → VALIDATED → IN_REPAIR → RESOLVED → VERIFIED → (ACCEPTED_BY_PRINCIPAL)
```

| Tahap | Siapa | Aksi |
|---|---|---|
| **OPEN** | Supervisor | Membuat laporan cacat dengan foto, lokasi, deskripsi, tingkat keparahan |
| **VALIDATED** | Estimator | Memvalidasi keparahan, menetapkan pihak bertanggung jawab, target penyelesaian |
| **IN_REPAIR** | Supervisor | Mencatat bukti perbaikan dengan foto |
| **RESOLVED** | Estimator | Memverifikasi perbaikan sudah memadai |
| **VERIFIED** | Estimator | Konfirmasi final bahwa cacat sudah teratasi |
| **ACCEPTED** | Prinsipal | Untuk cacat minor: prinsipal bisa menerima tanpa perbaikan penuh |

Cacat Critical dan Major yang belum terselesaikan akan **memblokir serah terima** dan muncul di dashboard prinsipal.

#### c. Variation Order (VO) dan Perubahan

Setiap perubahan dari rencana awal dicatat sebagai catatan perubahan, dengan klasifikasi:

**Jenis perubahan:**
- Permintaan owner / klien
- Revisi desain
- Rework / perbaikan
- Catatan mutu
- Revisi desain teknis

**Penyebab VO:**
- Permintaan klien
- Revisi desain
- Kesalahan asumsi estimator
- Kesalahan pelaksanaan di lapangan
- Kondisi tak terduga
- Masalah barang dari owner
- Rework kontraktor

**Dampak:**
- Ringan, Sedang, atau Berat
- Estimasi biaya tambahan
- Apakah memblokir serah terima

#### d. Rework

Rework dicatat **terpisah** dari VO biasa karena:
- Rework adalah biaya internal, bukan tagihan ke klien
- Rework mempengaruhi evaluasi performa supervisor dan mandor
- Rework harus terlihat dalam laporan rekonsiliasi

#### e. Absensi Pekerja

Daftar hadir harian per pekerja per mandor, termasuk:
- Status kehadiran (hadir, izin, sakit, absen)
- Jam lembur
- Perhitungan upah otomatis berdasarkan rate yang ditetapkan

### Gate 5 — Rekonsiliasi, Laporan, dan Export

**Tujuan:** Mengkompilasi semua data dari Gate 1-4 menjadi laporan yang bisa ditinjau, direkonsiliasi, dan di-export.

**Siapa yang terlibat:**
- **Semua peran** bisa mengakses laporan sesuai kewenangannya
- **Estimator** melakukan rekonsiliasi mingguan
- **Prinsipal** mereview laporan ringkasan

**Gate 5 adalah pusat pelaporan tunggal.** Semua export laporan terpusat di sini, tidak tersebar di berbagai layar.

**Laporan yang tersedia:**

| Laporan | Isi |
|---|---|
| **Ringkasan Progres** | Progres keseluruhan, per item BoQ, volume terpasang vs rencana |
| **Material Balance** | Perbandingan material: rencana vs diterima vs terpasang vs sisa di lokasi |
| **Log Penerimaan** | Histori penerimaan barang per PO dengan status |
| **Catatan Perubahan** | Semua VO dan perubahan: jenis, dampak, keputusan, biaya |
| **Varians Jadwal** | Status milestone: on track, at risk, delayed, ahead |
| **Rangkuman Mingguan** | Digest aktivitas mingguan untuk management review |
| **Daftar Audit & Anomali** | Temuan audit otomatis dan kasus yang perlu ditindaklanjuti |
| **Rekap Tenaga Kerja** | Absensi, upah, lembur per mandor dan pekerja |
| **Aging Kasbon** | Kasbon mandor yang belum terpotong, berapa hari tertunggak |
| **Laporan Tagihan Klien** | VO yang bisa ditagihkan ke klien dengan bukti pendukung |
| **Laporan Dukungan Payroll** | Data progres yang ditandai sebagai pendukung payroll |

**Format export:** Setiap laporan bisa di-export ke **PDF** (untuk presentasi dan arsip) atau **Excel** (untuk analisis lebih lanjut).

**Filter:** Semua laporan mendukung filter berdasarkan rentang tanggal, item BoQ, vendor, penanggung jawab, tingkat keparahan, dan tag lainnya.

### Bagaimana 5 Gate Saling Terhubung

Data mengalir dari satu gate ke gate berikutnya:

```
Gate 1: Permintaan material → menjadi dasar PO di Gate 2
Gate 2: PO diterbitkan → menjadi daftar yang menunggu penerimaan di Gate 3
Gate 3: Barang diterima → material tersedia untuk dicatat pemasangannya di Gate 4
Gate 4: Progres terpasang → menjadi dasar opname mandor dan laporan di Gate 5
Gate 5: Semua data dikompilasi → laporan untuk review, rekonsiliasi, dan keputusan
```

Dengan sistem gate ini, tidak ada langkah yang bisa dilewati. Setiap material yang dipasang bisa dilacak: siapa yang minta, berapa harganya, kapan diterima, siapa yang pasang, dan berapa hasilnya.

---

## 5. Panduan untuk Supervisor

### Perangkat

Handphone (aplikasi mobile)

### Navigasi Utama

Supervisor memiliki 5 tab navigasi di bagian bawah layar:

| Tab | Fungsi |
|---|---|
| **Beranda** | Dashboard ringkasan proyek, prioritas hari ini |
| **Permintaan** | Ajukan permintaan material |
| **Terima** | Konfirmasi penerimaan barang dari PO |
| **Progres** | Catat progres pemasangan, cacat, VO, rework, absensi, perubahan lokasi |
| **Laporan** | Lihat laporan dan export PDF/Excel |

### Beranda (Home)

Halaman pertama yang dilihat setelah login. Menampilkan:

- **Progress keseluruhan proyek** — persentase dan bar visual
- **Pengiriman menunggu konfirmasi** — jumlah PO yang belum diterima
- **Cacat terbuka** — jumlah cacat yang belum diselesaikan
- **Milestone berikutnya** — jadwal dan status target terdekat
- **Log aktivitas terbaru** — rekaman aktivitas tim dalam 7 hari terakhir
- **Shortcut** ke Permintaan, Terima, dan Progres

### Cara Mengajukan Permintaan Material

1. Buka tab **Permintaan**
2. Pilih item BoQ yang membutuhkan material
3. Sistem menampilkan daftar material yang disarankan berdasarkan AHS
4. Isi kuantitas, tanggal kebutuhan, dan urgensi
5. Bisa menambahkan beberapa baris material dalam satu permintaan
6. Untuk material di luar daftar, gunakan opsi "Material Custom"
7. Tambahkan catatan jika perlu
8. Tekan **Kirim**

Sistem secara otomatis mengecek apakah permintaan wajar (Gate 1). Supervisor akan melihat status sederhana: Terkirim, Sedang Ditinjau, Diblokir, atau Disetujui.

### Cara Konfirmasi Penerimaan Barang

1. Buka tab **Terima**
2. Pilih PO yang barangnya datang
3. Sistem menampilkan: sudah diterima berapa, sisa berapa
4. Masukkan kuantitas yang diterima kali ini
5. **Ambil foto bukti penerimaan** (wajib) — minimal foto kendaraan (otomatis GPS) dan foto material
6. Jika barang untuk ready mix: foto tambahan surat jalan
7. Tambahkan catatan jika ada perbedaan
8. Simpan sebagai **Terima Parsial** atau **Terima Final**

Satu PO bisa diterima dalam beberapa kali pengiriman. Sistem otomatis menghitung akumulasi.

### Cara Mencatat Progres Harian

1. Buka tab **Progres**
2. Pilih item BoQ yang dikerjakan hari ini
3. Masukkan kuantitas terpasang, lokasi, dan status pekerjaan
4. **Ambil foto** bukti pemasangan (wajib). Tidak perlu before/after. Tidak perlu GPS.
5. Jika ada cacat pada pekerjaan, tandai sebagai "Complete with Defect" — akan otomatis membuka form cacat
6. Bisa menandai entry sebagai payroll support atau client charge support
7. Tekan **Simpan**

Dari tab Progres, supervisor juga bisa:

- **Catat Perubahan (Catatan Perubahan)** — perubahan desain, VO, variasi di lapangan
- **Catat Cacat** — punch list item dengan foto, lokasi, dan tingkat keparahan
- **Catat Rework** — pekerjaan yang harus diulang
- **Isi Absensi Pekerja** — daftar hadir harian per mandor

### Laporan

Supervisor bisa melihat dan mengunduh laporan dari tab **Laporan**:
- Ringkasan Progres
- Material Balance
- Log Penerimaan
- Catatan Perubahan
- Varians Jadwal
- Rangkuman Mingguan

Setiap laporan bisa di-export ke **PDF** atau **Excel**.

### Yang Tidak Bisa Dilakukan Supervisor

- Mengubah baseline BoQ atau AHS
- Mengubah harga baseline
- Menyetujui atau menolak persetujuan
- Melihat proyek yang tidak ditugaskan

---

## 6. Panduan untuk Estimator

### Perangkat

Komputer (utama), handphone (untuk review cepat)

### Navigasi Utama

Estimator menggunakan tampilan Office dengan tab berikut:

| Tab | Fungsi |
|---|---|
| **Home** | Manajemen proyek, tim, undangan user |
| **Approval** | Review perubahan, permintaan material, MTN |
| **Harga** | Validasi harga vendor (Gate 2) |
| **Katalog** | Kelola katalog material: kode, kategori, tier, spesifikasi, harga supplier |
| **Laporan** | Laporan lengkap dengan export PDF/Excel |

Menu tersembunyi (diakses dari Home atau Progres workflow):

| Menu | Fungsi |
|---|---|
| **Baseline** | Upload dan kelola BoQ, AHS, material mapping |
| **Mandor** | Setup kontrak mandor, kategori pekerjaan, rate per BoQ |
| **Opname** | Opname mingguan mandor, waterfall pembayaran, kasbon |

### Tugas Utama Estimator

#### Setup Baseline Proyek

1. **Upload file Excel BoQ dan AHS** — sistem memproses dan mapping otomatis
2. **Review mapping** — periksa hasil deteksi material, perbaiki yang salah atau ambigu
3. **Publish baseline** — setelah review, baseline di-freeze sebagai acuan proyek
4. Baseline bisa di-versioning ulang jika ada revisi

#### Setup Mandor

1. **Buat kontrak mandor** — tentukan nama mandor, kategori pekerjaan, retensi
2. **Atur rate** — tentukan harga borongan per item BoQ untuk setiap mandor
3. **Review kategori pekerjaan** — konfirmasi deteksi otomatis trade category dari AHS
4. **Daftarkan pekerja** — input atau import daftar pekerja per mandor

#### Proses Opname Mingguan

1. **Buka Opname** dari workflow Progres
2. Sistem otomatis menghitung klaim minggu ini berdasarkan data progres yang masuk
3. Review item per item: kuantitas, rate, subtotal
4. Sistem menghitung waterfall pembayaran:
   - **Bruto** (total klaim)
   - **– Retensi** (% ditahan)
   - **– Sudah Dibayar** (minggu sebelumnya)
   - **– Kasbon** (uang muka yang belum terpotong)
   - **= Net Bayar** (yang harus dibayar minggu ini)
5. **Ajukan opname** untuk persetujuan → masuk ke approval queue

#### Kelola Kasbon

- Kasbon mandor tercatat di sistem dengan status: REQUESTED → APPROVED → SETTLED
- Kasbon otomatis dipotong dari opname berikutnya
- Aging kasbon (berapa hari dan siklus opname belum terpotong) dipantau otomatis

#### Review Exception & Approval

Dari tab **Approval**, estimator bisa:

- Review dan tindak lanjuti **catatan perubahan** dari supervisor
- Review **permintaan material** yang ditandai oleh sistem
- Review **MTN** (Material Transfer Note) — perpindahan material antar proyek

#### Validasi Harga (Gate 2)

Dari tab **Harga**, estimator melihat:

- Perbandingan harga vendor dengan baseline
- Histori harga dari pembelian sebelumnya
- Alert jika ada deviasi signifikan

#### Analisis dan Laporan

Estimator memiliki akses ke semua laporan termasuk:
- Semua laporan yang supervisor bisa lihat
- Laporan tenaga kerja dan absensi
- Aging kasbon
- Laporan audit dan anomali
- Laporan performa operasional

---

## 7. Panduan untuk Admin

### Perangkat

Komputer (utama)

### Navigasi Utama

Admin menggunakan tampilan Office yang sama dengan estimator, dengan fokus berbeda:

| Tab | Fokus Admin |
|---|---|
| **Home** | Manajemen proyek dan tim, undang user baru, atur peran |
| **Approval** | Tinjau permintaan material dan MTN |
| **Harga** | Buat PO, pilih vendor, input harga aktual |
| **Katalog** | Kelola katalog material dan harga supplier |
| **Laporan** | Laporan pengadaan dan keuangan |

### Tugas Utama Admin

#### Manajemen Proyek & Tim

1. **Buat proyek baru** dari tab Home
2. **Undang pengguna** — kirim undangan email untuk bergabung ke proyek
3. **Atur peran** — tetapkan peran (supervisor, estimator, admin, principal) untuk setiap anggota
4. **Kelola akses** — tambah atau hapus anggota dari proyek

#### Pengadaan (Procurement)

1. **Terima permintaan material** yang sudah divalidasi Gate 1
2. **Bandingkan vendor** — lihat perbandingan harga dari berbagai supplier
3. **Buat Purchase Order (PO)** — dengan detail material, kuantitas, harga, dan vendor
4. **Validasi harga** — sistem membandingkan harga input dengan baseline. Deviasi ditandai otomatis (Gate 2)
5. **Pantau status PO** — OPEN, PARTIAL RECEIVED, FULLY RECEIVED, CLOSED

#### Katalog Material

Dari tab **Katalog**, admin mengelola:
- **Daftar material** dengan kode, nama, kategori
- **Tier material:**
  - Tier 1 (Presisi) — material kritis dengan kontrol ketat (beton, besi)
  - Tier 2 (Bulk) — material umum dengan kontrol envelope (bata, pasir)
  - Tier 3 (Consumables) — material habis pakai dengan spend cap (paku, kawat)
- **Harga supplier** — catatan harga dari berbagai vendor untuk perbandingan

#### Laporan

Admin bisa mengakses laporan terkait pengadaan:
- Log Penerimaan (receipt log)
- Material Balance
- Progres dan jadwal
- Semua laporan bisa di-export ke PDF/Excel

---

## 8. Panduan untuk Prinsipal

### Perangkat

Handphone (utama), komputer (untuk review mendalam)

### Navigasi Utama

Prinsipal memiliki tampilan yang disederhanakan dengan 3 tab:

| Tab | Fungsi |
|---|---|
| **Beranda** | Dashboard eksekutif: ringkasan, keuangan, aktivitas, perubahan |
| **Approval** | Setujui atau tolak item yang membutuhkan keputusan |
| **Laporan** | Laporan lengkap dengan export PDF/Excel |

### Beranda (Dashboard Prinsipal)

Dashboard prinsipal dirancang untuk memberikan gambaran lengkap tanpa harus menggali detail:

#### Persetujuan Menunggu

Bagian paling atas menampilkan jumlah item yang menunggu keputusan:
- Catatan perubahan menunggu review
- MTN (Material Transfer) menunggu persetujuan
- Klik **Tinjau Semua** untuk langsung ke halaman approval

#### Ringkasan Hari Ini

Empat angka ringkasan aktivitas hari ini:
- Progres dicatat
- Penerimaan barang
- Kehadiran pekerja
- Catatan perubahan

#### Aktivitas Tim

Daftar aktivitas seluruh tim dalam 7 hari terakhir:
- Siapa melakukan apa dan kapan
- Jenis aktivitas ditandai dengan ikon berbeda (permintaan, penerimaan, progres, opname, perubahan)
- Bisa di-expand untuk melihat lebih banyak, dan di-collapse kembali

#### Status Keuangan

Ringkasan keuangan bulan berjalan:
- **Opname bulan ini vs bulan lalu** — dengan delta perbandingan
- **PO Outstanding** — klik untuk melihat daftar PO yang belum selesai
- **Kasbon Total** — klik untuk melihat detail kasbon per mandor

#### Progres vs Jadwal

- Bar progres keseluruhan proyek
- Status milestone: On Track, At Risk, Delayed, Ahead

#### Cacat Terbuka

Daftar cacat yang memblokir serah terima atau belum selesai:
- Ditandai dengan severity: Critical atau Major
- Klik item untuk melihat detail dan foto

#### Catatan Perubahan

Ringkasan perubahan desain dan VO:
- Berapa yang masih pending, sudah disetujui, ditolak
- Rework yang belum selesai
- Total biaya perubahan yang disetujui
- Klik item untuk melihat detail: foto, deskripsi, dampak, keputusan

#### Aktivitas AI

Ringkasan penggunaan asisten AI oleh tim — hanya statistik penggunaan, bukan isi percakapan.

### Cara Melakukan Approval

1. Buka tab **Approval** atau klik **Tinjau Semua** dari Beranda
2. Daftar item menunggu keputusan:
   - **Catatan Perubahan** — perubahan desain, VO dari lapangan
   - **Permintaan Material** — permintaan yang ditandai sistem
   - **MTN** — material transfer antar proyek
3. Klik item untuk melihat detail lengkap
4. Pilih tindakan: **Setujui**, **Tolak**, atau **Tahan** (hold)
5. Tambahkan catatan keputusan jika perlu

### Laporan

Prinsipal memiliki akses ke semua jenis laporan:
- Ringkasan Progres
- Material Balance
- Log Penerimaan
- Catatan Perubahan
- Varians Jadwal
- Rangkuman Mingguan
- Daftar Audit & Anomali
- Laporan performa operasional (SLA approval, disiplin entry, penggunaan tools)

Semua laporan bisa di-export ke **PDF** atau **Excel** untuk presentasi atau arsip.

### Ringkasan Peran Prinsipal

Prinsipal **tidak perlu** memasukkan data operasional. Peran prinsipal adalah:

- **Memantau** — melihat kondisi proyek dari dashboard
- **Memutuskan** — menyetujui, menolak, atau menahan item yang membutuhkan keputusan
- **Mengaudit** — mereview laporan dan mendeteksi potensi masalah
- **Mengekspor** — mengunduh laporan untuk dokumentasi atau presentasi

---

## Catatan Tambahan

### Cara Pindah Proyek

Setiap pengguna bisa ditugaskan ke lebih dari satu proyek. Untuk pindah proyek:
1. Klik **pemilih proyek** di bagian atas layar (header)
2. Pilih proyek yang ingin dilihat
3. Seluruh data di layar otomatis berubah sesuai proyek yang dipilih

Setiap pengguna hanya bisa melihat proyek yang ditugaskan kepadanya.

### Asisten AI

Di semua tampilan, ada tombol **AI Chat** (ikon bintang di sudut kanan bawah). Fitur ini bisa digunakan untuk:
- Bertanya tentang data proyek
- Meminta ringkasan
- Bantuan navigasi atau penggunaan aplikasi

Catatan: AI tidak bisa mengubah data atau menyetujui transaksi. AI hanya membantu membaca dan merangkum informasi.

### Keamanan & Audit

- Semua aksi terekam dengan timestamp dan identitas pengguna
- Data bersifat append-only — tidak bisa dihapus atau diubah retroaktif
- Akses dibatasi berdasarkan peran dan penugasan proyek
- Validasi dilakukan di server, bukan hanya di tampilan aplikasi

---

*Dokumen ini adalah panduan penggunaan SANO untuk seluruh tim proyek. Untuk pertanyaan teknis atau masalah akses, hubungi admin proyek.*
