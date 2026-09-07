# Panduan Estimator SANO — Katalog Material, Permintaan Supervisor, dan Perubahan Rencana

Versi 2026-09-07. Panduan ini untuk tim estimator. Aturannya singkat dan mengikat. Kalau ragu, tanya sebelum publish.

Catatan versi: fitur **Tambah material proyek** (bagian 4A) tersedia mulai rilis aplikasi berikutnya. Sampai rilis itu, semua penambahan lewat re-publish (bagian 4B).

## 1. Prinsip dasar

1. Angka yang salah lebih buruk daripada angka yang kosong. Jangan pernah mengarang jumlah agar sistem "terlihat lengkap".
2. Satu proyek, satu file master SANO Input. Semua perubahan rencana berasal dari file itu, termasuk material yang ditambah lewat aplikasi.
3. Supervisor tidak boleh diminta mengulang input. Kalau ada yang kurang, estimator yang membereskan.
4. Semua permintaan supervisor dicatat lewat aplikasi. WhatsApp hanya untuk mengingatkan, bukan sebagai catatan resmi.

## 2. Katalog material

**Dua layar, dua fungsi.**

| Layar | Siapa | Bisa apa |
|---|---|---|
| Office → Materials | Estimator, admin | Menambah item katalog baru |
| Laporan → Katalog | Estimator, admin | Menambah dan menghapus alias |

Principal dan supervisor tidak bisa mengubah katalog.

**Sebelum menambah, cari dulu.** Ketik nama, kode, atau alias. Banyak "material tidak ada" sebenarnya soal bahasa: "knee" sudah ada sebagai "Elbow", "sok" sebagai "Socket". Kalau ketemu, jangan buat item baru. Tambahkan alias dengan bahasa supervisor di Laporan → Katalog supaya lain kali langsung ketemu.

**Aturan membuat item baru di Office → Materials.**

| Kolom | Aturan |
|---|---|
| Kode | Huruf besar, unik, pola KATEGORI-NAMA, contoh PIP-PVC-6IN. Kode ganda ditolak database. Pesan yang muncul masih bahasa Inggris: "duplicate key value violates unique constraint". Artinya kode sudah dipakai, ganti kodenya. |
| Nama | Nama umum + spesifikasi penentu harga: bahan, ukuran, mutu. Contoh: "Elbow PVC 6 inch". Tanpa merek kecuali merek memang disyaratkan. |
| Kategori | Wajib diisi. Pakai kategori yang sudah ada. |
| Tier | **Formulir membuka dengan Tier 1.** Ganti dulu sebelum simpan. Fitting atau habis pakai yang tersimpan sebagai Tier 1 tidak bisa diminta di luar area kerja BoQ. Lihat tabel Tier. |
| Satuan | Satuan dasar yang dipakai di lapangan: pcs, m, kg, ltr, sak, m3. Tulis huruf kecil, konsisten. |
| Satuan supplier + faktor | Kosongkan jika sama dengan satuan dasar. Jika berbeda, faktor wajib. Contoh besi: 1 batang = 7.4 kg. Perbandingannya peka huruf besar-kecil: "Kg" dianggap berbeda dari "kg". |

**Tabel Tier.**

| Tier | Arti | Contoh | Kontrol sistem |
|---|---|---|---|
| 1 | Presisi, terikat satu item BoQ dan area kerja | Beton readymix, besi beton | Kuantitas per area kerja. Hanya lewat file SANO Input. |
| 2 | Bulk, dijumlah lintas BoQ | Semen, pasir, bata | Envelope kuantitas per proyek. |
| 3 | Anggaran Rupiah | Cat, keramik, allowance fitting | Anggaran = volume × harga acuan. Wajib ada harga. |
| 4 | Habis pakai, tidak dilacak | Paku, kawat, amplas, fitting kecil | Tidak ada gate. Hanya tercatat. |

Satu material satu tier. Jangan ubah tier item yang sudah dipakai proyek berjalan tanpa bicara dengan tim; envelope dan anggaran ikut berubah.

**Menghapus item katalog.** Tidak ada tombolnya, dan database menolak penghapusan item yang pernah dipakai. Item yang tidak dipakai lagi cukup didiamkan.

## 3. Supervisor minta material yang tidak ada di katalog

Yang terjadi di aplikasi hari ini: supervisor memakai "Tidak ada di katalog? Input manual" di menu Material Umum / Lainnya. Barisnya masuk sebagai teks bebas, Tier 3, tanpa tautan katalog. Di layar Approvals estimator melihat catatan "Tidak ada alokasi pembanding — material bebas-teks belum terhubung ke katalog. Tambahkan di Material Catalog untuk tracking envelope." Permintaan itu tetap bisa disetujui.

Langkah estimator, dalam urutan ini:

1. Cari di katalog. Kalau sebenarnya sudah ada → tambah alias dengan kata yang dipakai supervisor. Selesai.
2. Kalau benar-benar baru → buat item katalog (bagian 2). Ingat ganti Tier.
3. Masukkan ke rencana proyek: **Tambah material proyek** (bagian 4A) setelah rilis; sebelum rilis, tambah baris di file master dan re-publish (bagian 4B).
4. Setujui permintaannya. Jangan tolak permintaan hanya karena materialnya belum ada di katalog.
5. Target: baris teks bebas selesai di hari yang sama.

Catatan penting: baris teks bebas yang sudah masuk **tidak bisa** ditautkan ke item katalog yang baru dibuat. Tautan hanya berlaku untuk permintaan berikutnya. Untuk permintaan yang sedang berjalan, pastikan admin membuat PO dengan memilih item katalog, bukan nama bebas.

## 4. Menambah informasi ke rencana yang sudah dipublish

Ada dua jalan. Pilih yang benar.

### 4A. Tambah material proyek — untuk satu material baru (rilis berikutnya)

Dipakai jika: material Tier 2, 3, atau 4; belum ada di rencana proyek; tidak terikat area kerja.

Tempat: Baseline → kartu "Tambah material proyek". Isi material, jumlah rencana, harga satuan (wajib untuk Tier 3), catatan.

Yang dilakukan sistem: menambah satu baris ke rencana yang berjalan, mencatat harga acuan, mencatat revisi rencana, dan mengirim notifikasi "Baseline diperbarui" ke supervisor. Tidak ada re-publish, baris lain tidak tersentuh.

Ditolak jika: material sudah ada di rencana (ubah jumlah lewat re-publish), material Tier 1, material adalah alat/aset, proyek belum pernah publish, atau ada publish lain yang sedang berjalan (coba lagi).

**Kewajiban setelahnya:** tambahkan baris yang sama ke sheet Others di file master proyek. Re-publish hanya membaca file. Kalau barisnya tidak ada di file, publish berikutnya menghapusnya dari rencana. Aplikasi akan memperingatkan sebelum itu terjadi, tetapi tanggung jawabnya tetap di estimator.

### 4B. Re-publish — untuk semua perubahan lain

Dipakai jika: mengubah jumlah material yang sudah ada, menghapus material, menambah area kerja atau material Tier 1, mengubah mutu beton, memperbaiki satuan atau harga acuan.

**Aturan re-publish. Semua wajib.**

1. Selalu mulai dari file master proyek yang terakhir dipublish. Jangan pernah mengunggah file sebagian atau file baru dari nol.
2. **Sheet Tier 1 dibaca berdasarkan posisi kolom A sampai H, dan area kerja diberi kode berdasarkan urutan baris.** Menyisipkan baris di tengah menggeser identitas semua area kerja di bawahnya. Menyisipkan kolom membuat angka terbaca dari kolom yang salah. Di sheet ini: tambah baris hanya di paling bawah, jangan sisipkan kolom.
3. Sheet Others dibaca berdasarkan judul kolom, jadi urutan kolom boleh berbeda, tetapi judulnya tidak boleh diubah. Kalau judul hilang, sistem kembali ke posisi tetap dan angka bisa bergeser. Insiden 15 Agustus: satu kolom disisipkan tanpa judul yang dikenali, semua volume terbaca 0, tiga belas material hilang dari rencana, dan publish tetap "berhasil".
4. Angka harus tersimpan sebagai angka, bukan teks. Sel angka yang berformat teks dibaca 0 dan barisnya dibuang.
5. Nama material di sheet Others harus sama dengan nama katalog atau aliasnya. Baris yang namanya tidak dikenali **dibuang seluruhnya**: tidak masuk rencana, tidak masuk harga acuan. Peringatannya muncul sebagai notifikasi singkat beberapa detik, maksimal tiga baris, sebagian berbahasa Inggris. Hitung sendiri: jumlah baris di file harus sama dengan jumlah material di hasil publish.
6. Sistem juga mencocokkan nama yang mirip secara otomatis (kemiripan tinggi). Ini bisa salah sasaran tanpa pesan. Periksa hasil pencocokan di layar review sebelum publish.
7. Kolom Mutu Beton: tulis lengkap, "K-350" atau "fc' 30". Angka polos seperti "30" ditandai perlu review. Jangan diterima apa adanya: beton tanpa mutu tidak tertaut katalog dan tidak dikontrol.
8. Kolom Tier di Others wajib diisi. Tier kosong: baris masuk rencana tetapi tanpa anggaran Rupiah.
9. Baris yang hilang dari file = hilang dari rencana. Kalau material itu sudah punya permintaan atau PO, sistem memberi peringatan "dihapus dengan aktivitas" yang harus dicentang. Kalau belum ada aktivitas, hilang tanpa peringatan. Cek sendiri.
10. Menaikkan jumlah material yang sedang kelebihan pesan (PO melebihi rencana lama) memerlukan persetujuan principal. Sistem memblokir publish sampai disetujui. Jangan menaikkan rencana untuk "menutup" pesanan yang sudah lewat tanpa alasan tertulis.
11. Ringkasan perubahan hanya muncul jika ada peringatan. Kalau tidak ada, publish langsung jalan. Jadi periksa file sebelum menekan tombol, bukan sesudahnya.
12. Publish berjalan bertahap dan tidak bisa dibatalkan di tengah. Kalau gagal di tengah (misalnya koneksi putus), versi baru bisa tercatat tanpa isi dan semua rencana terbaca 0. Kalau itu terjadi, ulangi publish dari file yang sama segera. Jangan biarkan.
13. Supervisor menerima notifikasi "Baseline diperbarui" hanya jika ada material yang berubah dan sudah punya aktivitas. Publish pertama dan penambahan murni tidak mengirim notifikasi. Beri tahu supervisor secara langsung jika perlu.

**Yang tidak berubah saat re-publish:** semua permintaan supervisor, semua PO, semua penerimaan barang, semua jumlah yang sudah dipesan. Yang diganti hanya sisi rencana.

## 5. Fitting, aksesoris, dan pekerjaan yang jumlahnya tidak dihitung

Kasus: RAB hanya menyebut panjang pipa atau hanya anggaran plumbing, tanpa jumlah elbow, tee, reducer.

Aturan:

1. Jangan mengarang jumlah fitting. Angka karangan merusak semua kontrol di bawahnya.
2. Buat satu baris Tier 3 di sheet Others: "Fitting dan aksesoris pipa", volume 1, satuan paket, harga satuan = nilai allowance. Nilai allowance = persentase dari harga material pipa yang disepakati tim, atau nilai lump sum RAB jika hanya itu yang ada. Tulis dasar perhitungannya di kolom keterangan file.
3. Fitting yang sering dipakai didaftarkan di katalog sebagai Tier 4 supaya supervisor memilih namanya, bukan mengetik bebas.
4. Batas hari ini: allowance adalah angka acuan. Permintaan "Elbow 6 inch" tidak otomatis mengurangi allowance, karena sistem menghitung anggaran per material, bukan per kelompok. Fitur "bebankan ke allowance" sedang direncanakan.
5. Karena itu, admin dan estimator meninjau belanja fitting dari PO setiap bulan dan membandingkannya dengan allowance. Kalau melewati allowance, itu dibahas, bukan disembunyikan dengan menaikkan rencana.

## 6. Harga

1. Untuk proyek dengan format SANO Input, **satu-satunya** harga acuan adalah kolom Harga Satuan di sheet Others. Material Tier 1 (beton, besi) tidak punya harga acuan di sistem. Katalog tidak menyimpan harga.
2. Admin mengetik harga di setiap baris PO. Harga wajib diisi. Tidak ada harga yang terisi otomatis.
3. Ada pemeriksaan harga, tetapi terbatas: berjalan **setelah** PO dibuat, membandingkan dengan median harga analisa RAB (+5% peringatan, +15% tinggi, +30% kritis), dan hanya memberi peringatan. Untuk proyek SANO Input, harga analisa itu tidak ada, sehingga pemeriksaan ini tidak pernah berbunyi. Anggap saja tidak ada pemeriksaan harga otomatis.
4. Anggaran Tier 3 dihitung dari harga acuan × jumlah yang diminta supervisor, bukan dari harga beli PO. Membeli lebih mahal tidak terlihat di anggaran.
5. Aturan tim sebagai pengganti pemeriksaan otomatis: harga PO lebih dari 15% di atas harga acuan → admin konfirmasi ke estimator sebelum PO dibuat. Estimator mencatatnya.
6. Kalau harga pasar memang berubah, perbaiki harga acuan di file master dan re-publish.

## 7. Kasus tepi yang sering menjebak

| Situasi | Yang terjadi | Yang harus dilakukan |
|---|---|---|
| Menyisipkan baris di tengah sheet Tier 1 | Kode area kerja bergeser, area kerja bertukar identitas, permintaan lama menunjuk area yang salah | Tambah area kerja hanya di baris paling bawah |
| Mengganti nama area kerja di sheet Tier 1 | Hanya label yang berubah, identitas tetap | Aman |
| Mengganti nama material di sheet Others | Kalau nama baru masih dikenali (alias), tidak ada perubahan. Kalau tidak dikenali, baris dibuang | Pakai nama katalog atau alias yang ada |
| Mengubah mutu beton area kerja yang sudah berjalan | Material beton berganti item; item lama terbaca "dihapus", item baru "ditambah" | Sengaja? Lanjutkan dan baca checklist. Tidak sengaja? Kembalikan |
| Dua baris Others untuk material yang sama | Volume dijumlah menjadi satu rencana, tetapi harga acuan tercatat dua dan sistem memilih salah satu secara acak | Satu material satu baris |
| Material Tier 1 juga ditulis di Others | Dua rencana untuk satu material | Pilih satu tempat, biasanya Tier 1 |
| Alat atau aset (perancah, molen) ditulis di Others | Masuk rencana tetapi tidak pernah bisa diminta atau di-PO | Alat dicatat di tab Alat, bukan di Others |
| Satuan di file berbeda dari satuan katalog | Tidak ada pengecekan dan tidak ada konversi. Angka masuk apa adanya | Samakan satuan dengan katalog sebelum publish |
| Volume 0 atau kosong di Others | Baris dibuang dengan peringatan singkat | Isi volume atau hapus barisnya |
| Menambah material yang sudah ada lewat Tambah material proyek | Ditolak | Ubah jumlah lewat re-publish |
| Item katalog dibuat tapi belum masuk rencana | Permintaan supervisor lolos dengan peringatan "belum ada rencana", tanpa envelope dan anggaran | Segera masukkan ke rencana |
| Permintaan dikembalikan admin setelah disetujui (status RETURNED) | Supervisor menerima notifikasi berisi alasan, tetapi tidak bisa memperbaiki di aplikasi | Estimator atau principal yang mengembalikan ke PENDING setelah supervisor menjelaskan |

## 8. Ringkasan cepat

| Situasi | Tindakan |
|---|---|
| Supervisor minta material yang ternyata sudah ada | Tambah alias di Laporan → Katalog |
| Material benar-benar baru, Tier 2/3/4 | Buat item katalog (ganti Tier!) → Tambah material proyek → tambah baris ke file master → setujui permintaan |
| Material baru Tier 1 atau area kerja baru | Tambah baris di paling bawah sheet Tier 1 → re-publish |
| Ubah jumlah atau hapus material | Ubah di file master → re-publish, baca checklist |
| Jumlah fitting tidak diketahui | Allowance Tier 3 + fitting Tier 4 di katalog, tinjau PO bulanan |
| Harga PO jauh di atas acuan | Konfirmasi estimator sebelum PO; kalau pasar berubah, perbaiki acuan dan re-publish |
| Publish gagal di tengah | Ulangi publish dari file yang sama segera |
