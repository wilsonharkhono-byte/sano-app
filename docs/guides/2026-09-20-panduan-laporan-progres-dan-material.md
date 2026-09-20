# Panduan laporan progres dan material SANO

Versi 20 Sep 2026. Untuk supervisor lapangan (HP/APK), estimator, admin, dan prinsipal (web). Pakai istilah yang sama dengan yang ada di layar.

## 1. Gambaran

Laporan harian adalah satu-satunya pintu masuk. Supervisor menulis **Laporan Progres Klien (Blueprint)** setiap hari; AI membaca tiap baris dan mengusulkan area kerja, tahap (Bekisting, Pembesian, Pengecoran) dan keadaan (Mulai, Lanjut, Selesai), lalu orang yang mengonfirmasi. Sekali seminggu papan status **Klaim Progres Mingguan** mengubah baris itu menjadi klaim per area kerja: tiap tahap ditandai **Belum**, **Berjalan** atau **Selesai**, bernilai 0, 50 atau 100 persen. Estimator memverifikasi, dan hanya verifikasi yang menulis progres proyek. Tidak ada persen yang ditaksir AI dari foto atau teks. Semua grafik di **Analitik Proyek** adalah hitungan biasa atas baris yang tercatat: permintaan material dan keputusannya, baris laporan terkonfirmasi, klaim terverifikasi, dan rencana material di BoQ.

## 2. Alur mingguan

| Peran | Kapan | Yang dikerjakan |
|---|---|---|
| Supervisor | Setiap hari kerja | Laporan harian di Laporan → Laporan Progres Klien (Blueprint), lalu **Terbitkan & Simpan** |
| Supervisor | Setiap hari / akhir minggu | Isi papan status lewat Progres → **Tambah progres**, atau Laporan → **Klaim Progres Mingguan**; akhir minggu tekan **Kirim klaim** |
| Estimator | Setiap hari | Konfirmasi baris laporan di laporan yang terbit (**Konfirmasi N saran**, **Konfirmasi**, **Tidak terkait**) |
| Estimator | Setelah klaim dikirim | Reports → **Klaim** → **Verifikasi Klaim Progres**: isi kolom **Cek**, lalu **Verifikasi** atau **Kembalikan** |
| Estimator | Sekali per proyek, lalu bila perlu | Baseline → **Bobot Tahapan Progres** |
| Admin / prinsipal | Awal proyek | Tanggal mulai dan selesai rencana di kartu **Kurva-S Progres** |
| Admin / estimator | Terus-menerus | Keputusan permintaan material (Approvals) |
| Semua peran | Kapan saja | Membaca **Analitik Proyek** di Beranda masing-masing; angkanya sama untuk semua |

## 3. Persiapan sekali per proyek

1. **Publish BoQ dengan rencana material per area kerja.** Rencana Tier 1 harus terikat ke area kerja. Kalau dilewati: kartu Material vs Progres menulis "Belum ada rencana material untuk proyek ini." dan tidak ada chip sama sekali.
2. **Isi tanggal mulai dan selesai rencana** (admin atau prinsipal, di kartu Kurva-S Progres → **Ubah tanggal proyek** → **Simpan tanggal**). Kalau dilewati: tidak ada kurva rencana, hanya peringatan "Isi tanggal selesai rencana untuk menggambar kurva rencana."
3. **Periksa Bobot Tahapan Progres** (estimator, di Baseline). Baris tanpa bobot terisi otomatis dari profil referensi kelasnya dan ditandai **Bobot referensi**; periksa dan perbaiki. Kalau dilewati: baris yang bobotnya belum diatur tidak bisa diklaim, dan verifikasi menolaknya.
4. **Tugaskan supervisor ke proyek.** Tanpa penugasan, supervisor melihat proyek tapi tidak melihat satu pun area kerja.
5. **Jalankan "Tautkan laporan lama (N)"** di Riwayat Laporan (admin atau estimator) supaya laporan yang sudah terbit ikut punya baris tertaut. Kalau dilewati: klaim pertama dan grafik laporan harian tidak punya riwayat.
6. **Alokasikan permintaan material ke area kerja.** Rencana yang tidak terikat area kerja muncul sebagai "· N kg tanpa area kerja (tidak digambar)" dan tidak masuk grafik; kalau seluruh rencana satu kelompok begitu, kelompok itu hanya tercantum di catatan "Rencana hanya di tingkat proyek". Alokasi permintaan juga yang membuat tanda **Pembesian melebihi besi yang diminta** bekerja.

## 4. Cara supervisor

**Laporan harian.** Tulis satu baris per kegiatan dan sebutkan tiga hal: area kerjanya (nama yang sama dengan di BoQ), pekerjaannya (bekisting, pembesian, pengecoran, galian, bongkar bekisting), dan keadaannya (mulai, lanjut, selesai). Contoh: "Lt. 2 ; Kolom — pembesian kolom K1–K8 selesai, bekisting mulai dipasang." Lampirkan foto. Setelah **Terbitkan & Simpan**, AI menautkan barisnya; kalau belum jalan, tekan **Jalankan AI**.

**Klaim mingguan.** Buka Progres → **Tambah progres** (atau **Tambah progres untuk item ini** dari sebuah baris). Untuk tiap tahap pilih salah satu chip: **Belum**, **Berjalan** (50 %) atau **Selesai** (100 %). Di sebelahnya tertulis **Terverifikasi X %**, yaitu angka terakhir yang sudah disetujui estimator. Kalau laporan harian sudah bercerita, formulirnya terbuka sudah terisi dan memberi tahu asalnya; periksa lalu **Simpan**. **Angka persis (opsional)** dipakai hanya kalau Anda tahu angkanya, misalnya 35 %.

- **Bukti wajib:** setiap kenaikan butuh minimal satu foto **atau** satu baris laporan harian terkonfirmasi untuk area kerja itu. Kalau belum ada, aplikasi menolak dengan pesan "Tambahkan minimal satu foto atau konfirmasi baris laporan harian sebagai bukti."
- **Turun** dari angka terverifikasi wajib disertai alasan.
- Akhir minggu tekan **Kirim klaim**; setelah itu baris terkunci sampai estimator memutuskan.
- **Dikembalikan** berarti estimator belum menerima angkanya dan menulis alasan. Klaim kembali bisa diedit: perbaiki angka atau tambah foto, lalu **Kirim klaim** lagi. Tidak ada yang hilang.

## 5. Cara estimator

**Konfirmasi baris laporan.** Buka laporan yang terbit di Laporan Progres Klien (Blueprint). Tiap baris punya chip saran: area kerja, tahap, keadaan. Tekan **Konfirmasi N saran** untuk menerima semua, **Konfirmasi** per baris, atau **Tidak terkait** untuk baris yang bukan pekerjaan BoQ. Hanya baris **Terkonfirmasi** yang dipakai papan status.

**Verifikasi klaim.** Reports → **Klaim**. Tiap baris menampilkan tabel **Tahap / Lalu / Klaim / Cek** (Lalu = terverifikasi sebelumnya, Klaim = angka supervisor, Cek = angka yang Anda verifikasi), lalu bukti: baris laporan harian sejak verifikasi terakhir, catatan supervisor, dan foto. Tanda peringatan bersifat saran, tidak memblokir:

| Tanda | Artinya | Tindakan |
|---|---|---|
| Naik tanpa foto atau laporan | Kenaikan tanpa bukti apa pun | **Kembalikan** dan minta foto |
| Pengecoran mendahului besi/bekisting | Urutan pekerjaan tidak masuk akal | Cek laporan; sering salah tahap, bukan salah angka |
| Berbeda dari laporan harian | Klaim dan laporan tidak sepakat | Turunkan angka **Cek**, atau terima kalau laporan yang tertinggal |
| Pembesian melebihi besi yang diminta | Klaim pembesian jauh di atas besi yang pernah diminta untuk area itu | Cek apakah besi memang sudah di lokasi atau permintaannya belum masuk |
| Bobot referensi | Bobot baris masih profil bawaan | Perbaiki di Baseline → Bobot Tahapan Progres |

Selesai memeriksa, isi **Catatan verifikasi (opsional)** lalu **Verifikasi**. Aplikasi mencatat entri progres dan memberi tahu pengirimnya. Anda tidak boleh memverifikasi klaim yang Anda kirim atau Anda isi sendiri.

## 6. Membaca Analitik Proyek

**Kurva-S Progres.** Tiga garis: **Rencana (asumsi kurva-S)** antara tanggal mulai dan selesai, **Terverifikasi** dari klaim yang sudah diverifikasi, dan **Proyeksi laju sekarang**. Empat ubin: Terverifikasi, Rencana hari ini, Laju, Proyeksi selesai. Tanpa progres terverifikasi di dua minggu berbeda muncul "Belum cukup data: proyeksi butuh progres terverifikasi di dua minggu berbeda."

**Material vs Progres.** Pilih kelompok lewat chip ("Besi (kg) → Pembesian", "Semen (zak) → Pengecoran", dan seterusnya). Semua dalam persen dari rencana BoQ per area kerja.

- Cincin luar **Disetujui**, dengan warna lebih muda untuk **Diminta** yang belum diputuskan. Cincin tengah **Terpasang (terverifikasi)**. Cincin dalam **Menurut laporan harian (belum diverifikasi)**, yaitu papan status Berjalan 50 / Selesai 100 yang belum lewat estimator. Angka besar di tengah adalah terpasang terverifikasi.
- Tiga ubin: **Stok teoretis** (disetujui − terpasang, dalam satuan material dan dalam poin), **Jeda material → pekerjaan** (berapa minggu material disetujui lebih dulu), **Cukup untuk** (stok dibagi laju). Tanda "—" selalu disertai alasan: "belum ada progres terverifikasi", "belum bisa dihitung", "belum ada laju", "tidak ada stok tersisa".
- **Lihat tren mingguan** membuka grafik kumulatif: pita antara Disetujui dan Terpasang adalah **stok teoretis**, kurung mendatar adalah jeda, garis titik-titik mendatar adalah **cukup ~N minggu**.
- Catatan kaki: "Rencana ... per area kerja", ditambah "tanpa area kerja (tidak digambar)" bila ada; "Belum pernah diminta: ..."; "Rencana hanya di tingkat proyek: ..."; "Diminta tanpa rencana di BoQ terbit: ...".

*Contoh:* besi rencana 4.000 kg. Disetujui 2.500 kg → cincin luar 62,5 %. Terpasang terverifikasi 1.750 kg → cincin tengah 43,8 %. Stok teoretis 750 kg, yaitu 18,8 poin. Pada laju 2 poin per minggu, "Cukup untuk ~9 minggu".

**Aktivitas Lapangan.** Jenis pekerjaan per minggu, rata-rata tukang per hari, hari kerja tanpa laporan, dan tukang-hari per 1 % progres terverifikasi.

**Alur Persetujuan Material.** Median hari sampai keputusan, jumlah menunggu, umur permintaan tertua, dan persen yang ditolak.

## 7. Batasan yang harus dipahami

1. Grafik tahu apa yang **disetujui**, bukan apa yang **diterima di lokasi**. Belum ada pencatatan penerimaan barang, jadi "stok teoretis" adalah batas atas, bukan stok sebenarnya.
2. Angka dari laporan harian **belum diverifikasi** sampai estimator memverifikasi klaimnya. Itu sebabnya cincin dalam selalu diberi label.
3. Kurva rencana adalah **asumsi kurva-S** antara dua tanggal, bukan jadwal rinci.
4. Proyeksi butuh progres terverifikasi di **dua minggu berbeda**; sebelum itu tidak ada proyeksi.
5. Angka di atas 100 % bisa terjadi kalau persetujuan mencakup material yang tidak terikat area kerja; angkanya dicetak apa adanya.

## 8. Masalah umum

| Gejala | Penyebab | Tindakan |
|---|---|---|
| "Laporan harian belum bisa dibaca." | Baris laporan tidak terbaca | Cincin dalam hilang, sisanya tetap benar; laporkan ke admin |
| "Tanggal proyek belum diisi." | Tanggal mulai/selesai kosong | Minta admin atau prinsipal mengisi di kartu Kurva-S Progres |
| "Belum ada rencana material untuk proyek ini." | BoQ belum dipublish, atau rencana tanpa area kerja | Estimator publish ulang dengan rencana per area kerja |
| Chip Belum/Berjalan/Selesai tidak muncul | Bobot baris belum diatur, atau klaim sudah dikirim | Estimator atur di Bobot Tahapan Progres; klaim terkirim memang terkunci |
| "Bobot baris ini berubah setelah diklaim." | Bobot diubah setelah klaim dibuat | Isi ulang persentase lalu Simpan; kalau sudah dikirim, estimator mengembalikan klaim |
| **Jalankan AI** gagal | Kunci API atau kuota harian | Minta admin memeriksa kunci di pengaturan fungsi; laporan tetap terbit, baris bisa dikonfirmasi manual |
| Supervisor tidak melihat area kerja | Belum ditugaskan ke proyek | Admin menambahkan penugasan |
| "Belum cukup data" pada proyeksi | Progres terverifikasi baru ada di satu minggu | Verifikasi klaim minggu berikutnya |

---

*Diperbarui 20 Sep 2026.*
