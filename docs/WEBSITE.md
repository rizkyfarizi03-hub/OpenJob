# OpenJob Website — versi lokal

> Catatan arsip: file `Buka-Demo.cmd`, `Buka-Demo-Email.cmd`, dan `Buka-Pengujian-Postgres.cmd` yang disebut di bawah sudah dihapus. Gantinya `npm run demo`, `npm run demo:mail`, dan `npm run qa:web`, dari folder utama atau dari `openjob_api`.

Frontend berada di `openjob_web/`. Express menyajikan HTML, CSS, JavaScript, dan API pada origin yang sama, sehingga tidak perlu server frontend, build, atau konfigurasi CORS tambahan. PostgreSQL, Redis, publisher RabbitMQ, dan consumer email tetap menggunakan arsitektur proyek awal.

## Coba dengan data demo

Dari folder proyek:

```powershell
cd openjob_api
npm ci # hanya bila dependency belum terpasang
npm run demo
```

Buka **http://127.0.0.1:3100**. Di Windows, bisa juga klik dua kali `Buka-Demo.cmd` dari folder utama. Biarkan terminal tetap terbuka selama menggunakan demo. Hentikan dengan Ctrl+C.

| Akun | Email | Password |
| --- | --- | --- |
| Pelamar | pelamar@example.com | DemoOpenJob123! |
| Perekrut | perekrut@example.com | DemoOpenJob123! |

Alamat tersebut hanya fixture lokal, bukan tujuan pengiriman email. Demo menggunakan PGlite dalam memori, cache dalam memori, dan direktori upload sementara. Data, akun baru, dan perubahan demo tidak disimpan setelah proses berhenti. Tidak menjalankan publisher/consumer atau mengirim email. PostgreSQL asli tidak dihubungi. Setiap startup membuat kunci JWT acak baru; login ulang setelah restart.

Jika port terpakai:

```powershell
$env:DEMO_PORT = '3101'
npm run demo
```

## Fitur yang sudah tersedia

- Beranda, kategori, daftar lowongan, detail pekerjaan, direktori dan profil perusahaan.
- Filter judul, kota, kategori, tipe pekerjaan, sistem kerja, pengalaman; pagination.
- Registrasi pelamar/perekrut, login, refresh sesi, logout, edit profil/password.
- Pelamar: bookmark, upload/unduh/hapus PDF, memilih CV saat melamar, pesan ke perekrut, daftar status lamaran, menarik lamaran.
- Perekrut: profil perusahaan, membuat/mengedit lowongan, buka/tutup lowongan, daftar pelamar, unduh CV yang berhak diakses, ubah tahap seleksi.
- Layout responsif, navigasi keyboard, dialog, pesan error, keadaan kosong dan loading.

Satu akun memakai satu peran: `user` untuk pelamar atau `employer` untuk perekrut. `admin` tidak dapat dipilih lewat registrasi publik. Pengelolaan kategori tetap melalui API khusus admin; belum ada dashboard admin.

## Menggunakan PostgreSQL dan layanan proyek asli

Gunakan database pengembangan yang sesuai dan backup data sebelum menerapkan migrasi. `.env` yang sudah ada tidak ditimpa oleh pengembangan website ini.

```powershell
# Folder utama: jalankan RabbitMQ, Redis, dan Mailpit sesuai README awal
docker compose -f compose.dev.yml up -d

# Terminal API; PostgreSQL harus sudah tersedia sesuai .env
cd openjob_api
npm run migrate
npm start
```

Buka alamat server sesuai `HOST` dan `PORT` dalam `.env` (default http://localhost:3000). Jalankan consumer pada terminal lain untuk email lamaran:

```powershell
cd openjob_consumer
npm start
```

Mode PostgreSQL tidak otomatis memasukkan akun, perusahaan, dan lowongan demo. Daftar akun perekrut, buat perusahaan, lalu pasang lowongan melalui website.

Migrasi `1792800000000_website.js`:

- Menambah `document_id`, `cover_letter`, dan `updated_at` pada lamaran; lamaran lama tetap ada dan boleh memiliki `document_id` kosong.
- Mengubah akun `user` yang sudah memiliki perusahaan/lowongan menjadi `employer` agar tetap bisa mengelolanya. Review pemetaan ini jika akun lama dipakai untuk melamar sekaligus merekrut; UI versi ini memisahkan dua peran tersebut.
- Menambahkan enam kategori awal dan indeks pencarian/pemilik.
- Mengganti penghapusan cascade pada relasi lowongan/perusahaan/kategori/lamaran dengan pembatasan untuk menjaga riwayat, termasuk saat request bersamaan.
- Rollback menghapus kolom baru dan mengembalikan kebijakan foreign key lama. Peran dan kategori tambahan sengaja dipertahankan. Backup diperlukan bila ingin mengembalikan seluruh data persis ke kondisi sebelumnya.

Migrasi ini telah diuji pada database sementara; belum diterapkan pada PostgreSQL asli.

## Aturan proses dan privasi

- Lamaran baru wajib memakai CV milik pelamar dan lowongan berstatus `open`; satu pelamar hanya dapat mengirim satu lamaran per lowongan.
- PDF dibatasi 5 MB, MIME `application/pdf`, dan signature `%PDF-`. Ini pemeriksaan format awal, bukan pemindaian malware.
- Dokumen hanya dapat diakses pemiliknya atau pemilik lowongan yang menerima lamaran terkait. Lamaran ditarik mencabut akses perekrut terhadap CV tersebut, kecuali CV juga dipakai dalam lamaran lain kepada perekrut yang sama.
- CV yang sudah dipakai lamaran tidak bisa dihapus. Lowongan yang memiliki lamaran harus ditutup, bukan dihapus.
- Status: `pending` → `reviewing` / `interview` → `accepted` / `rejected`. Perekrut bisa langsung memutuskan diterima/ditolak. Status akhir tidak dapat dibuka kembali. Pelamar bisa menarik lamaran aktif menjadi `withdrawn`; tidak bisa melamar ulang ke lowongan yang sama.
- Nilai gaji tersembunyi dikembalikan sebagai `null` pada API publik dan bookmark. Perekrut tetap melihat nominal miliknya dalam dashboard.
- Lamaran dan outbox dibuat dalam satu transaksi. Worker email awal tetap mengirim notifikasi lamaran baru kepada pemilik lowongan.

## Perubahan kontrak API

Website memanggil `/api/*`. Endpoint lama seperti `/jobs`, `/applications`, dan `/documents` tetap tersedia dengan aturan akses baru yang sama. `GET /` sekarang HTML website; status JSON tersedia di `/health` atau `/api/health`.

| Endpoint | Perilaku baru |
| --- | --- |
| `POST /api/users` | Role publik hanya `user` atau `employer` |
| `GET /api/users/:id` | Harus login dan hanya akun sendiri |
| `GET /api/jobs` | Default hanya `open`; `status=all` untuk semua; default 12 item, maksimal 50; `data.pagination` tersedia |
| `GET /api/jobs/mine` | Lowongan milik perekrut, termasuk gaji privat dan jumlah pelamar |
| `GET /api/companies/mine` | Perusahaan milik perekrut |
| `POST /api/applications` | Wajib `job_id` (atau `jobId`) dan `document_id`; `cover_letter` opsional |
| `GET /api/applications` | Hanya lamaran sendiri atau ke lowongan sendiri |
| `PUT /api/applications/:id` | Hanya pemilik lowongan; status dibatasi |
| `DELETE /api/applications/:id` | Penarikan lamaran sendiri, bukan penghapusan riwayat |
| `GET /api/documents` | Daftar dokumen sendiri, wajib login |
| `GET /api/documents/:id` | Wajib Bearer token dan izin; respons attachment PDF |

Bookmark dibaca langsung dari database agar perubahan gaji/status langsung terlihat. Namespace Redis diganti untuk tidak memakai respons cache dari kontrak lama.

## Pengujian

```powershell
cd openjob_api
npm test
# Fokus integrasi website saja:
npm run test:website

# Di terminal dari folder utama:
cd openjob_consumer
npm test
```

Tes website menggunakan PGlite, port HTTP acak, serta upload sementara, tanpa PostgreSQL/Redis/RabbitMQ/SMTP sungguhan. Mencakup migrasi, autentikasi, role, kepemilikan, privasi PDF, filter, pagination, visibilitas gaji, outbox, penolakan duplikat, tahap seleksi, penarikan, dan logout lintas akun. Tes publisher dan consumer lama tetap dipertahankan.

`tests/integration.cjs` dan collection Postman awal dipertahankan sebagai referensi submission V2 (`npm run test:legacy`). Ekspektasinya belum mengikuti kontrak website: antara lain dokumen publik, pembuatan lowongan oleh akun umum, dan lamaran tanpa CV. Suite legacy tidak menjadi tes penerimaan versi website; tidak ada assertion legacy yang dilonggarkan agar terlihat lulus.

## Batas versi ini

- Belum dipublikasikan ke hosting. Domain, HTTPS, database produksi, dan SMTP produksi belum dikonfigurasi.
- Belum ada upload logo perusahaan, chat, atau penjadwalan wawancara. Verifikasi email, lupa password, dan email perubahan status tersedia dengan konfigurasi layanan email.
- Frontend memakai `sessionStorage` untuk token sesuai API Bearer yang ada. Sebelum peluncuran publik, evaluasi sesi HttpOnly, pembatasan percobaan login, expiry/revocation refresh token, penyimpanan file persisten, dan kebutuhan operasional produksi.
- Pengujian SMTP/RabbitMQ nyata serta QA visual/klik desktop dan HP perlu dilakukan pada lingkungan yang menyediakan layanan dan browser tersebut. Tes otomatis yang disediakan tidak menggantikan pemeriksaan itu.

## Perbaikan tahap 1 — akun dan sesi (26 Oktober 2026)

Arah pengembangan sekarang adalah produk OpenJob; kompatibilitas penilaian Dicoding bukan lagi batasan perubahan.

- Access token berlaku 15 menit. Sesi dan refresh token berakhir setelah 7 hari; refresh merotasi token tanpa memperpanjang batas sesi.
- Database hanya menyimpan hash refresh token. Semua endpoint privat memeriksa sesi aktif.
- Logout mencabut akses sesi langsung, termasuk ketika access token sudah kedaluwarsa.
- Mengganti email atau password memerlukan `current_password`, mencabut seluruh sesi, dan meminta login ulang. Perubahan nama tidak mencabut sesi.
- Email dinormalisasi; duplikat beda kapital ditolak. Password dibatasi 72 byte UTF-8 agar tidak terpotong oleh bcrypt.
- Login dibatasi 30 percobaan per alamat IP dalam 15 menit, di memori proses. Untuk beberapa instance produksi, limiter perlu dipindahkan ke penyimpanan bersama dan proxy tepercaya dikonfigurasi.
- Profil dibaca langsung dari database sehingga kegagalan cache tidak membuat penyimpanan profil terlihat gagal.

### Mengaktifkan pada database yang sudah ada

Hentikan API, jalankan `npm run migrate` dari folder `openjob_api`, lalu jalankan kembali API. Migrasi baru adalah `1792900000000_sessions.js`. Semua pengguna harus login ulang. Demo menerapkan migrasi otomatis pada database sementaranya.

Jika database memiliki email yang sama setelah huruf kecil/spasi dinormalisasi, migrasi sengaja gagal agar akun tidak digabung atau dihapus otomatis. Tinjau akun duplikat sebelum mengulang migrasi. Migrasi belum dijalankan terhadap database asli selama pengerjaan tahap ini.

Pengujian: 17 tes API/broker lulus, termasuk rotasi refresh, logout dengan access token kedaluwarsa, pencabutan semua sesi setelah ganti password, email beda kapital, dan password multibyte. Sintaks frontend juga diperiksa; formulir baru belum diuji melalui browser.

Tahap berikutnya masih terbuka: validasi isi PDF, kompatibilitas data lama, pagination/filter/bookmark, pengujian browser menyeluruh, lalu pemulihan akun dan notifikasi.


## Perbaikan tahap 2 — CV dan konsistensi data (26 Oktober 2026)

- Upload memakai parser pdf-lib 1.17.1 untuk memeriksa struktur dan halaman PDF. File palsu, terpotong, tanpa halaman, atau terenkripsi ditolak. Batas ukuran tetap 5 MB.
- Parsing berjalan di worker terpisah dengan batas waktu 5 detik dan heap 64 MB. Ini merupakan pemeriksaan struktur, bukan antivirus atau jaminan bahwa seluruh konten PDF dapat dirender. Referensi: https://pdf-lib.js.org/docs/api/classes/pdfdocument
- Upload yang ditolak dan kegagalan INSERT database diuji tidak meninggalkan file maupun baris dokumen.
- Penghapusan dokumen mencatat pekerjaan pembersihan file dalam transaksi database yang sama melalui trigger. Bila file terkunci, antrean tetap tersimpan dan API utama mencoba kembali saat startup dan setiap menit. File yang sudah hilang dianggap selesai. CV yang telah dipakai melamar tetap dilindungi FK.
- Migrasi baru menormalkan lokasi legacy `onsite` / `on_site` / `on-site` menjadi `on-site`. Nilai lain tidak ditebak atau dihapus.
- Dependency body-parser diperbarui; audit runtime (`npm audit --omit=dev`) menghasilkan 0 temuan pada pemeriksaan ini. Audit lengkap masih melaporkan 19 temuan pada dependency pengembangan; belum ditangani di tahap ini.

Jalankan `npm ci` dan `npm run migrate` di `openjob_api`, lalu restart API untuk mengaktifkan perubahan pada instalasi yang sudah ada. Migrasi tahap ini: `1793000000000_document_cleanup.js`. Database asli belum diubah selama pengerjaan.

Batas konsistensi: filesystem dan PostgreSQL tidak memiliki transaksi bersama. Server yang mati mendadak tepat setelah file upload ditulis tetapi sebelum INSERT dapat meninggalkan file tanpa referensi; rekonsiliasi file orphan setelah crash belum diimplementasikan. Antrean penghapusan menangani kegagalan pembersihan dokumen yang sudah terdaftar.

Pemeriksaan browser tahap 2 menunggu izin computer use. Skenario: upload PDF valid, file palsu, file terlalu besar, dan hapus CV yang belum/sudah digunakan melamar.


## Perbaikan tahap 3 — otorisasi peran, privasi bookmark, dan efisiensi antrean (26 Oktober 2026)

- Endpoint `GET /profile/bookmarks` kini memakai query canonical `bookmarkQuery` sehingga gaji tersembunyi (`is_salary_visible = false`) tetap dikembalikan `null` dan tidak bocor ke publik atau pelamar.
- Otorisasi bookmark (`POST/GET/DELETE /jobs/:jobId/bookmark` dan `GET /bookmarks`) serta dokumen (`POST /documents`, `GET /documents`, `DELETE /documents/:id`) dibatasi khusus untuk akun pelamar (`user`). Akun perekrut (`employer`) ditolak dengan HTTP 403 Forbidden.
- Unduhan CV pada `GET /documents/:id` menyertakan nama file asli yang disanitasi pada header `Content-Disposition`. Di frontend, tombol unduh otomatis memberi nama file sesuai nama dokumen asli pelamar atau `CV-<NamaPelamar>.pdf` untuk perekrut.
- UI frontend menyesuaikan tombol bookmark: disembunyikan/dinonaktifkan jika pengguna masuk sebagai perekrut, dan `loadBookmarks()` tidak memanggil API jika bukan akun pencari kerja.
- Publisher antrean outbox (`publisher.js`) dioptimalkan: loop `start()` mempertahankan koneksi dan channel confirm RabbitMQ aktif, serta memeriksa antrean outbox terlebih dahulu sebelum mencoba membuat koneksi ad-hoc.
- Seluruh 20 tes otomatis integrasi dan broker unit test lulus.


## Perbaikan tahap 4 — siklus notifikasi email status lamaran (26 Oktober 2026)

- Menambahkan tabel migrasi `application_status_outbox` (`migrations/1793100000000_application_status_outbox.js`) untuk menyimpan rekaman event perubahan status seleksi kandidat secara transaksional di database.
- Route `PUT /applications/:id` kini berjalan dalam transaksi DB (`BEGIN` / `COMMIT`), merekam status baru kandidat (`reviewing`, `interview`, `accepted`, `rejected`) sekaligus memasukkan pesan ke `application_status_outbox`.
- Queue baru RabbitMQ: `openjob.application.status_changed` (durable).
- `publisher.js` memublikasikan antrean perubahan status lamaran secara persistent ke RabbitMQ dan menandai `published_at` setelah konfirmasi broker.
- Consumer (`openjob_consumer/src/consumer.js`) kini mendengarkan antrean `openjob.application.status_changed` dan mengirimkan email notifikasi ke pelamar via Nodemailer dengan status yang ramah pembaca (misal: "Tahap Wawancara", "Diterima", "Belum Sesuai").
- Dilengkapi unit test di `openjob_consumer` (5 tes lulus) dan integrasi di `openjob_api` (21 tes lulus).




## Penyempurnaan alur pencarian dan lamaran — 27 Oktober 2026

- Mengganti kata kunci/lokasi lewat pencarian atas mempertahankan filter kategori, sistem kerja, tipe pekerjaan, dan pengalaman. Mengubah pencarian kembali ke halaman pertama.
- Profil perusahaan menampilkan lowongan aktif per 12 item dengan navigasi halaman. Diuji lewat browser pada perusahaan berisi 17 lowongan: 12 di halaman pertama dan 5 di halaman kedua.
- Login dan pendaftaran mempertahankan tujuan lowongan. Pelamar tanpa CV diarahkan ke upload dengan tujuan posisi tetap tersimpan; setelah CV tersedia muncul tombol “Lanjutkan lamaran”.
- Browser demo telah memverifikasi upload, kembali ke posisi semula, kirim lamaran, status “Terkirim”, serta tombol hapus CV yang dinonaktifkan setelah dokumen dipakai.
- Timeout pemeriksaan PDF kini menghasilkan respons 503 dan petunjuk mencoba kembali, bukan menyebut dokumen rusak. Batas waktu pemeriksaan tetap 5 detik dan file upload yang gagal dibersihkan.
- Pengujian menggunakan database sementara dan akun buatan. Docker, SMTP, dan data PostgreSQL asli tidak dipakai. Tahap berikutnya: dashboard yang lebih praktis dan keandalan email; pemulihan akun/verifikasi email masih belum tersedia.



## Dashboard yang lebih praktis — 27 Oktober 2026

- Dashboard pelamar menggunakan judul “Lamaran Saya”; dokumen, simpanan, perusahaan, dan pelamar masuk memakai judul yang langsung menjelaskan fungsinya.
- Tabel serta detail lamaran menampilkan tanggal/jam pembaruan terakhir dari updated_at, dengan created_at sebagai fallback. Waktu mengikuti zona waktu browser pengguna.
- Halaman perusahaan perekrut hanya mengambil data perusahaan. Halaman lowongan mengambil lowongan dan perusahaan untuk formulir edit. Halaman pelamar mengambil lowongan dan lamaran. Ringkasan masih mengambil seluruh data untuk hitungan.
- Filter posisi/status memakai kelas CSS yang sesuai Content Security Policy, serta menjadi satu kolom pada layar kecil.
- Diverifikasi melalui browser demo: ringkasan perekrut, filter status, waktu pembaruan tabel/detail, edit lowongan dengan pilihan perusahaan, halaman perusahaan, dan dashboard pelamar. Pemeriksaan sintaks JavaScript lulus; tidak ada error browser yang tercatat dalam sesi pemeriksaan.
- Backend/database tidak berubah pada tahap dashboard ini. Pagination server untuk daftar lamaran dan ringkasan hitungan khusus masih menjadi pekerjaan berikutnya.


## Pagination pelamar — 27 Oktober 2026

- Daftar pelamar perekrut dimuat 20 lamaran per halaman dari server. Filter posisi dan status berada di URL, dipertahankan saat pindah halaman/refresh, dan perubahan/reset filter kembali ke halaman pertama.
- GET /api/applications (serta /user/:userId dan /job/:jobId) menerima page (1..100000), limit (1..50, default 20), job_id, dan status. Status: pending, reviewing, interview, accepted, rejected, withdrawn. Parameter tidak valid menghasilkan 400.
- Respons data sekarang berisi applications, pagination {page,limit,total,pages}, dan summary {total,pending,active,accepted}. pagination.total mengikuti filter; summary menghitung semua lamaran dalam lingkup akun tanpa filter. Perekrut hanya melihat lamaran pada lowongannya; pelamar hanya melihat lamaran sendiri. Urutan memakai created_at lalu id agar timestamp yang sama tetap stabil.
- Ringkasan perekrut mengambil satu item beserta summary, sehingga total tidak lagi bergantung pada ukuran halaman. Ini perubahan kontrak daftar: pemakai integrasi yang membutuhkan semua record harus menelusuri pagination. /profile/applications masih memakai daftar pribadi lama.
- Browser demo terpisah dengan 25 lamaran buatan membuktikan: 20 item halaman pertama, filter gabungan 22 hasil, 2 item halaman kedua, batas tombol berikutnya, refresh mempertahankan filter, perubahan filter kembali halaman pertama, reset, serta ringkasan total 25/pending 22.
- 22 tes API/broker lulus, termasuk pagination tanpa duplikat, urutan stabil, batas parameter, ringkasan, dan isolasi antar akun. Sintaks frontend diperiksa; browser tidak mencatat error.
- Backend berubah: restart API/demo diperlukan. Tidak ada migrasi database baru untuk tahap ini. Restart demo menghapus data sementaranya. PostgreSQL asli belum diubah.
- Tahap keandalan email belum dikerjakan dalam tahap pagination ini.


## Perbaikan dashboard tidak terbuka di port 3100 — 27 Oktober 2026

Diagnosis dilakukan pada server nyata yang sedang melayani 3100: GET /api/applications mengembalikan hanya applications, tanpa pagination dan summary. Proses demo tersebut memuat versi backend lama sementara file frontend sudah diperbarui. Proses dev/preview.cjs yang terverifikasi dihentikan dan demo dijalankan ulang dari checkout ini di port yang sama.

- Dashboard perekrut kini memeriksa ketersediaan kontrak summary/pagination sebelum merender. Respons versi lama menampilkan petunjuk restart yang jelas, bukan TypeError “reading total”.
- HTML memakai Cache-Control: no-store; aset memakai no-cache agar browser memvalidasi ulang hasil edit.
- Pesan server demo siap sekarang ditulis hanya pada event listening, sehingga kegagalan port tidak lebih dulu menampilkan pesan siap.
- Pengujian browser langsung pada 3100 membuktikan Ringkasan Rekrutmen, angka ringkasan, Pelamar Masuk, Lamaran Saya, dan pembatasan pelamar pada area perekrut berfungsi. Tidak ada error browser yang tercatat.
- Restart demo mereset akun/data sementara dan sesi; pengguna perlu memuat ulang halaman serta login kembali. Data PostgreSQL asli tidak dipakai.


## Keandalan notifikasi email — 28 Oktober 2026

- Mengirim status yang sama kini menghasilkan HTTP 200 dengan data.changed=false, tidak mengubah updated_at, dan tidak menambah event email. Perubahan status nyata menghasilkan data.changed=true; frontend menampilkan pesan yang sesuai.
- Migrasi 1793200000000_notification_retries.js menambah failure_count, next_attempt_at, failed_at, last_error, dan indeks jadwal pada kedua tabel outbox.
- SMTP gagal sementara dijadwalkan ulang setelah 5 detik lalu 30 detik. Setelah tiga kegagalan tercatat, event dipisahkan; penolakan permanen SMTP 5xx dipisahkan langsung. Batas ini berlaku pada percobaan yang tercatat, bukan jaminan exactly-once ketika proses crash.
- Antrean durable baru: openjob.application.created.failed dan openjob.application.status_changed.failed. Consumer memakai confirm channel, validasi event terhadap database, dan Message-ID status yang tetap. Pesan rusak tidak menghambat pesan berikutnya.
- Publisher hanya mengambil event yang sudah waktunya, belum diberi notifikasi, dan belum gagal permanen. Kesalahan migrasi/query tidak lagi ditelan diam-diam. Consumer/publisher memulihkan channel yang tertutup.
- 23 tes API/publisher/pipeline dan 12 tes consumer lulus (35 total). Tes pipeline menggunakan database sementara untuk memverifikasi retry yang bertahan setelah modul consumer dimuat ulang, batas kegagalan, pemulihan SMTP, deduplikasi, serta rollback ketika broker tidak mengonfirmasi.
- Uji Docker lokal melalui npm run test:notifications:live juga PASS: dua email buatan terverifikasi di Mailpit, retry pulih, pesan duplikat ditekan, batas tiga kegagalan diterapkan, pesan gagal/rusak dipisahkan. Antrean pengujian dibersihkan; PostgreSQL dan antrean aplikasi asli tidak dipakai.
- Penerapan ke database asli belum dilakukan. Hentikan API/publisher/consumer, backup data, jalankan migrasi di openjob_api, lalu jalankan ulang versi kode yang sama. Demo harus direstart untuk memuat backend dan migrasi terbaru; sesi/data demo akan direset.
- Semantik email tetap at-least-once: crash setelah SMTP menerima email tetapi sebelum commit database masih berpotensi menyebabkan email ganda. Message-ID tetap membantu penelusuran, bukan jaminan deduplikasi dari semua penyedia email.


## Lupa password — 28 Oktober 2026

- Tautan “Lupa password?” tersedia pada login. POST /api/password-resets menerima {email}, dengan HTTP 202 dan pesan yang sama untuk akun yang ada/tidak ada. Request dibatasi 10 per IP/15 menit, dan pengiriman per akun dijeda minimal satu menit. Respons sukses memiliki waktu minimum 250 ms untuk mengurangi perbedaan waktu respons.
- Email reset berlaku 30 menit sejak permintaan. Token memiliki ID acak dan komponen HMAC-SHA256 dari PASSWORD_RESET_KEY; hanya SHA256 token yang disimpan. Broker membawa ID event, bukan token mentah. Consumer merekonstruksi token dan memeriksa hash-nya sebelum mengirim.
- POST /api/password-resets/confirm menerima {token,password}. Token hanya sekali pakai; dua permintaan bersamaan tidak bisa sama-sama berhasil. Reset mengubah hash password, menghapus semua auth_sessions, dan membatalkan permintaan reset lain dalam transaksi. Password mengikuti aturan minimal 8 karakter/maksimal 72 byte. Konfirmasi dibatasi 20 per IP/15 menit.
- Permintaan baru membatalkan tautan sebelumnya. Perubahan email/password melalui profil juga membatalkan token reset. Token kedaluwarsa, dipakai, atau dibatalkan tidak dikirim lagi oleh consumer.
- Queue: openjob.account.password_reset dan openjob.account.password_reset.failed, dengan retry yang sama seperti notifikasi lain. Token dari fragmen URL disimpan di memori halaman lalu dihapus dari address bar; jika halaman reset direfresh, buka ulang tautan email.
- API dan consumer memerlukan PASSWORD_RESET_KEY yang SAMA, acak minimal 32 byte, serta WEB_BASE_URL yang SAMA (origin HTTPS tanpa path/query/fragment; HTTP hanya untuk localhost). Jangan menyalin secret contoh. File .env asli tidak diubah.
- Migrasi baru: 1793300000000_password_resets.js. Versi asli memerlukan migrasi dan restart API/publisher/consumer bersama. PostgreSQL asli belum dimigrasikan.
- Batas rate limit saat ini tersimpan di proses; instalasi beberapa instance memerlukan limiter bersama. Email tetap at-least-once pada kasus crash setelah SMTP menerima pesan sebelum commit.

### Mencoba email reset pada demo lokal

1. Pastikan Docker RabbitMQ/Mailpit tersedia sesuai compose.dev.yml. Mode demo email hanya perlu SMTP Mailpit pada 1025 dan inbox 8025; pengiriman reset demo tidak memakai antrean aplikasi asli.
2. Hentikan demo lama di terminal dengan Ctrl+C. Jalankan Buka-Demo-Email.cmd dari folder utama, atau npm run demo:mail dari openjob_api. Jangan menjalankan dua demo pada port 3100 sekaligus.
3. Buka http://127.0.0.1:3100/#/login → Lupa password? → isi pelamar@example.com atau perekrut@example.com.
4. Buka http://127.0.0.1:8025, pilih email reset paling baru, lalu ikuti tautannya. Setelah password diganti, masuk dengan password baru.
5. Restart demo menghapus semua perubahan dan mengembalikan akun contoh. Buka-Demo.cmd biasa tetap menonaktifkan email; permintaan reset di mode itu memberi pesan bahwa email demo belum tersedia.

Mode demo email memakai secret acak per proses, database serta file sementara, dan SMTP yang dibatasi ke 127.0.0.1:1025. Tidak memakai password/email produksi. Kedua folder API dan consumer harus memiliki dependency yang terpasang.

Pengujian: 24 tes API/publisher/pipeline/reset dan 12 tes consumer (36 total), ditambah uji layanan RabbitMQ/Mailpit lokal dengan tiga email contoh. Uji tersebut mencakup permintaan reset, link dari isi email, konfirmasi sekali pakai, login password baru, dan penolakan refresh token sesi lama. Browser memverifikasi halaman permintaan, pesan generik, penerimaan email, formulir reset, dan pembersihan token dari URL; konfirmasi password diuji melalui HTTP otomatis.


## Verifikasi email

- Akun baru boleh login, menyiapkan profil/CV, dan membuat perusahaan atau draft lowongan sebelum verifikasi. Melamar, menerbitkan lowongan, dan membuka kembali lowongan memerlukan alamat email terverifikasi. Pemeriksaan dilakukan di server.
- Pendaftaran menjadwalkan email verifikasi jika layanan email tersedia. Halaman #/verify-email menyediakan kirim ulang. Tautan berlaku 24 jam, sekali pakai; kirim ulang membatalkan tautan sebelumnya. Jeda pengiriman minimal satu menit, maksimal 20 permintaan per pengguna/15 menit. Konfirmasi dibatasi 20 per IP/15 menit.
- Perubahan alamat email menghapus status verifikasi dan membatalkan tautan lama. Alamat baru perlu diverifikasi. Akun contoh demo terverifikasi; akun baru tetap memerlukan verifikasi.
- Migrasi 1793400000000_email_verification.js menambahkan email_verified_at dan email_verification_requests. Akun lama pada database asli tidak otomatis dianggap terverifikasi; lowongan dan riwayatnya tetap tersimpan.
- Antrean openjob.account.email_verification membawa ID permintaan saja; kegagalan dipisahkan ke openjob.account.email_verification.failed. API dan consumer memakai PASSWORD_RESET_KEY dan WEB_BASE_URL yang sama seperti reset password, dengan tujuan HMAC berbeda agar token kedua fitur tidak saling dapat dipakai.
- Demo email: jalankan Buka-Demo-Email.cmd, daftar akun buatan di port 3100, buka email terbaru di Mailpit port 8025, lalu konfirmasi tautannya. Buka-Demo.cmd biasa menonaktifkan email. Restart menghapus data sementara.
- PostgreSQL asli belum dimigrasikan. Penerapan asli memerlukan migrasi dan restart API/publisher/consumer dengan versi yang sama. Jangan mencampur proses backend lama dengan frontend baru.

Validasi lanjutan 31 Oktober 2026: 25 tes API dan 12 tes consumer lulus. Uji RabbitMQ/Mailpit lokal PASS untuk empat email buatan, termasuk konfirmasi verifikasi dan reset password, retry, deduplikasi normal, serta pemisahan pesan gagal/rusak. Browser demo port 3100 membuktikan akun baru dapat masuk sebelum verifikasi, email diterima di Mailpit, dan konfirmasi menampilkan status berhasil. Semua memakai data sementara; database asli tidak dimigrasikan.

## PostgreSQL Docker untuk pengujian — 31 Oktober 2026

Pengujian tambahan kini memakai PostgreSQL 14 asli dalam Docker pada `127.0.0.1:5433`, database `openjob_qa_20261031`. Ini terpisah dari layanan PostgreSQL Windows pada 5432. Website demo pada 3100 tetap memakai database sementara; tahap ini tidak mengganti server demo dengan server PostgreSQL.

Dari folder `openjob_api`, jalankan:

```powershell
npm run qa:postgres:up
npm run test:postgres
npm run test:postgres:mail
```

Perintah pertama membuat layanan dari `compose.qa.yml`, menunggu sehat, lalu menjalankan migrasi hanya pada database QA dengan penanda kepemilikan yang cocok. Password QA dibuat acak sekali dan disimpan di `.qa-postgres/docker.env` yang diabaikan Git; jangan membagikan atau menghapus file ini selama volume QA masih dipakai. Konfigurasi QA tidak mengambil kredensial PostgreSQL dari `.env` asli.

Setiap pengujian mendapat schema `qa_...` baru. Data contoh dipertahankan di volume Docker, file CV di `openjob_api/qa-postgres-files` yang juga diabaikan Git. Pengujian berulang menambah schema/file; belum ada pembersihan otomatis. Jangan memakai `docker compose down -v` jika ingin mempertahankan data QA. Untuk menghentikan layanan tanpa menghapus data, dari folder utama jalankan `docker compose -p openjob-qa -f compose.qa.yml stop`; menjalankan `qa:postgres:up` kembali memakai volume yang sama.

Hasil: 22 tes integrasi lulus pada PostgreSQL, mencakup akun, profil, CV, lowongan, lamaran, hak akses, reset password, verifikasi email, dan notifikasi. Uji gabungan PostgreSQL/RabbitMQ/Mailpit PASS dengan empat email buatan; antrean khusus pengujian dibersihkan. Cache pada suite ini tetap diganti cache memori; hasil ini belum membuktikan integrasi Redis atau kesiapan produksi.

Uji persistensi mencatat sidik seluruh baris akun/perusahaan/lowongan/dokumen/lamaran pada sembilan schema QA serta enam file PDF, menutup koneksi, merestart container QA, lalu membandingkannya dengan koneksi baru: PASS. Data asli tidak dimigrasikan. Untuk mengulang pemeriksaan tanpa menjalankan tes lain di antaranya:

```powershell
# Dari openjob_api
node dev/postgresPersistence.cjs --record
# Dari folder utama
docker compose -p openjob-qa -f compose.qa.yml restart postgres-qa
# Kembali ke openjob_api setelah PostgreSQL siap
node dev/postgresPersistence.cjs --check
```

## Website pengujian dengan data persisten — port 3101

Jalankan `Buka-Pengujian-Postgres.cmd` dari folder utama, atau `npm run qa:web` dari `openjob_api`. Buka `http://127.0.0.1:3101`. Port 3100 tetap merupakan demo sementara; port 5433 adalah database, bukan alamat website.

Prasyarat: dependency API dan consumer terpasang; Docker PostgreSQL QA, RabbitMQ, Redis, dan Mailpit menyala. Untuk PostgreSQL gunakan `npm run qa:postgres:up`. Layanan lainnya memakai `compose.dev.yml`. Jika 3101 sudah dipakai, launcher berhenti dengan error dan tidak berpindah port otomatis.

Launcher menghubungkan API, publisher, consumer, Redis, dan Mailpit lokal. Database memakai schema tetap `web_qa` pada `openjob_qa_20261031`, dengan penanda kepemilikan yang diperiksa sebelum migrasi. Antrean memakai awalan `openjob.qa.web_qa.`; cache Redis memakai `openjob:qa:web_qa:v1:`. Pengaturan `.env` asli tidak dimuat oleh launcher ini. Semua layanan tetap lokal dan email hanya masuk Mailpit pada `http://127.0.0.1:8025`.

Akun awal: `pelamar@example.com` dan `perekrut@example.com`, password keduanya `DemoOpenJob123!`. Data contoh hanya dibuat ketika schema website belum berisi pengguna. Akun baru perlu verifikasi lewat Mailpit. Gunakan hanya akun dan CV buatan.

Data tetap ada setelah restart aplikasi maupun container PostgreSQL selama volume dipertahankan. File CV website disimpan di `openjob_api/qa-postgres-files/web_qa/documents`; secret sesi/link disimpan di `openjob_api/.qa-postgres/web-secrets.json`. Kedua lokasi diabaikan Git. Pertahankan keduanya bersama database saat memindahkan lingkungan pengujian; jangan membagikan secret. Ctrl+C menghentikan website; menjalankan launcher lagi memakai data yang sama.

Validasi: `node dev/test-postgres-web.cjs` menguji website 3101 lewat HTTP dengan dua akun buatan, verifikasi dari email Mailpit, perusahaan, lowongan, unggah CV, lamaran, status reviewing, dan email status. Sesudah restart aplikasi, `node dev/test-postgres-web.cjs --check` membuktikan login ulang, status lamaran, dan unduhan PDF tetap berhasil. Browser juga membuktikan perubahan nama profil contoh tetap tersimpan setelah restart tanpa error konsol. Pengujian ini belum merupakan deployment publik atau pemindahan data produksi.

## Cache Redis — 11 November 2026

Enam endpoint memakai Redis kembali, dengan header `X-Data-Source: cache` atau `database`: `GET /companies/:id`, `GET /users/:id`, `GET /applications/:id`, `GET /applications/user/:userId`, `GET /applications/job/:jobId` (termasuk `GET /applications`), dan `GET /bookmarks`. Berlaku sama untuk awalan `/api`.

- Data pribadi disimpan per akun, sehingga satu akun tidak pernah menerima cache akun lain. Pemeriksaan sesi, peran, dan kepemilikan tetap dijalankan sebelum cache dibaca.
- Setiap akun dan perusahaan mempunyai versi cache (`src/cacheScope.js`). Perubahan menghapus versi itu, sehingga semua halaman dan filter ikut tidak terpakai. Masa simpan tetap satu jam.
- Invalidasi mencakup data gabungan: perubahan lowongan atau perusahaan menyegarkan cache pemilik, pelamar, dan penyimpan bookmark; perubahan profil atau verifikasi email menyegarkan cache akun itu dan perekrut yang menerima lamarannya. Gaji yang disembunyikan langsung hilang dari bookmark.
- Redis hanya optimasi. Jika Redis mati atau tidak menjawab dalam 500 ms, cache dilewati selama 10 detik dan data diambil dari PostgreSQL. Penghapusan yang belum sampai ke Redis dicatat di memori proses dan kuncinya tidak dilayani dari cache sampai berhasil dihapus; catatan ini hilang jika proses API direstart saat Redis mati.
- `GET /profile/*`, daftar lowongan, dan dashboard perekrut tetap membaca PostgreSQL langsung.

Pengujian: `npm run test:cache` (PGlite dan cache memori) mencakup miss, hit, invalidasi, isolasi antar akun, dan kegagalan cache. Pengujian terhadap layanan Redis sungguhan dan collection Postman belum dijalankan pada perubahan ini.

## Perbaikan alur frontend — 11 November 2026

- Perekrut baru melihat tiga langkah awal (verifikasi email, profil perusahaan, lowongan pertama) sebagai ganti deretan angka nol dan tombol yang mati. Langkah itu hilang setelah lowongan pertama terpasang.
- Tombol "Pasang Lowongan" selalu bisa diklik. Tanpa verifikasi muncul penjelasan; tanpa perusahaan, form perusahaan terbuka lalu berlanjut ke form lowongan.
- Pemberitahuan verifikasi memakai kalimat sesuai peran. Pada demo tanpa Mailpit, pemberitahuan menjelaskan bahwa akun baru tidak bisa diverifikasi dan menyarankan akun contoh.
- Kolom gaji memakai pemisah ribuan, menampilkan rentang yang terbaca, dan memperingatkan angka yang janggal.
- Semua kolom password punya tombol tampilkan/sembunyikan dan peringatan Caps Lock.
- Font Inter disertakan di `openjob_web/assets/fonts` (lisensi OFL) sehingga tampilan sama di semua perangkat; teks sekunder dibuat lebih gelap dan kartu statistik lebih ringkas.

Pengujian: `npm run test:ui` dari folder utama menjalankan `openjob_web/tests/ui.test.cjs` terhadap server demo dalam memori. Pemeriksaan visual di browser baru dilakukan pada halaman daftar dan ringkasan perekrut.

## Fitur tambahan — 11 November 2026

- **Umur lowongan.** Kartu dan detail menampilkan waktu sejak publikasi; lowongan di bawah tiga hari diberi tanda "Baru".
- **Pencarian.** `GET /jobs` menerima `posted=1|7|30` (hari), `min_salary`, dan `sort=newest|salary`. Lowongan bergaji tersembunyi tidak cocok dengan `min_salary` dan selalu berada di akhir urutan gaji, agar nominalnya tidak bisa ditebak.
- **Jumlah pelamar.** `GET /jobs/:id` menyertakan `applicant_count` (tanpa lamaran yang ditarik). Tampilan membulatkan jumlah di bawah lima; API tetap mengirim angka persisnya.
- **Riwayat tahap lamaran.** `GET /applications/:id` menyertakan `history`, disusun dari waktu lamaran dikirim, baris `application_status_outbox`, dan waktu penarikan.
- **Logo perusahaan.** Migrasi `1793500000000_company_logos.js` menambah `companies.logo_updated_at` dan tabel `company_logos` (gambar disimpan sebagai `bytea`). `PUT` dan `DELETE /companies/:id/logo` hanya untuk pemilik; `GET /companies/:id/logo` publik. Hanya PNG, JPG, dan WebP hingga 512 KB, dikenali dari isi berkas. Gambar tidak diproses ulang, jadi ukuran piksel tidak dibatasi.
- **Halaman lowongan.** Form pasang/edit lowongan pindah dari dialog ke `#/employer/jobs/new` dan `#/employer/jobs/:id/edit`, dengan pratinjau kartu yang mengikuti isian.

Database yang sudah ada perlu `npm run migrate` untuk fitur logo. Pengujian: `tests/features.integration.cjs` dan `npm run test:ui`, keduanya memakai PGlite; penyimpanan `bytea` belum diuji pada PostgreSQL sungguhan.

## Mode Vercel — 14 November 2026

- `api/index.js` menyusun API dan fungsi kirim email consumer dalam satu fungsi tanpa RabbitMQ dan Redis. Email dikirim setelah respons lewat `waitUntil`, dengan tabel outbox dan aturan retry yang sama. Panduan: [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md).
- `OPENJOB_DOCUMENT_STORAGE=database` menyimpan CV di tabel `document_files` (migrasi `1793600000000_document_files.js`). Bawaannya tetap folder.
- `DATABASE_URL` (opsional) didukung oleh API dan consumer; tanpa itu tetap memakai variabel `PG*`.
- `OPENJOB_PUBLIC_DEMO=1` mengunci email dan password akun contoh serta menampilkan banner demo.
- Pendaftaran dibatasi 10 kali per 15 menit per IP di semua mode.
- Data contoh dipindah ke `openjob_api/dev/demoSeed.cjs` agar bisa dipakai saat build tanpa PGlite.
