# Menjalankan kode utama OpenJob

Panduan backup dan uji pemulihan QA: [BACKUP-PEMULIHAN.md](BACKUP-PEMULIHAN.md).

Website, API, dan consumer yang digunakan demo adalah kode utama yang sama. Jalur biasa menjalankan `openjob_api/src/server.js` dan `openjob_consumer/src/consumer.js` sebagai dua proses terpisah. Tidak perlu menjalankan launcher demo untuk mendapatkan fitur website.

## Pilih cara menjalankan

| Cara | Alamat | Data | Perintah |
| --- | --- | --- | --- |
| Demo sementara | 3100 | Hilang setelah restart | `Buka-Demo.cmd` atau `Buka-Demo-Email.cmd` |
| Pengujian persisten | 3101 | PostgreSQL Docker QA, akun contoh | `Buka-Pengujian-Postgres.cmd` |
| Aplikasi biasa | Mengikuti `HOST` / `PORT` API, contoh 3000 | Database pilihan pada konfigurasi | `npm start` di API dan consumer, masing-masing terminal |

Port 5432/5433 adalah PostgreSQL, bukan website. Mode aplikasi biasa tidak membuat akun atau lowongan contoh secara otomatis. Kategori bawaan disiapkan oleh migrasi.

## Persiapan aplikasi biasa

1. Pasang dependency dengan `npm ci` pada masing-masing folder API dan consumer.
2. Jika `.env` belum ada, buat dari `.env.example` pada masing-masing folder. Jangan menimpa `.env` yang sudah berisi pengaturan.
3. Isi koneksi PostgreSQL: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`. Kedua aplikasi harus menunjuk database yang sama. Untuk instalasi pertama gunakan database kosong khusus, bukan database asli yang berisi data.
4. Pada API, tentukan `HOST` / `PORT` dan dua secret acak berbeda `ACCESS_TOKEN_KEY` / `REFRESH_TOKEN_KEY`. Tentukan direktori CV persisten melalui `OPENJOB_UPLOAD_DIRECTORY` (disarankan path absolut). Jika kosong, lokasi bawaan adalah `openjob_api/uploads/documents`.
5. Pada kedua aplikasi, isi `PASSWORD_RESET_KEY` acak minimal 32 byte yang SAMA dan `WEB_BASE_URL` yang SAMA. Contoh lokal: `http://127.0.0.1:3000`. Ini menentukan tautan verifikasi/reset di email. Pada server publik gunakan origin HTTPS, tanpa path tambahan.
6. Hubungkan keduanya ke RabbitMQ yang sama. Jika memakai `RABBITMQ_QUEUE_PREFIX`, nilainya wajib sama di API dan consumer. Awalan bawaan `openjob` mempertahankan nama antrean lama. Lingkungan terpisah harus memakai awalan berbeda atau broker/vhost terpisah agar pesan tidak diproses consumer lingkungan lain.
7. Pada consumer, isi SMTP melalui `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, dan opsional `MAIL_FROM`. Untuk uji lokal gunakan Mailpit 127.0.0.1:1025, inbox 8025. Mailpit tidak mengirim email ke inbox asli.

`compose.dev.yml` menyediakan RabbitMQ, Redis, dan Mailpit lokal. Redis dipakai sebagai cache untuk detail perusahaan, profil akun, detail dan daftar lamaran, serta bookmark; sumber data terlihat pada header `X-Data-Source` (`cache` atau `database`). Cache hanya optimasi: jika Redis mati atau lambat, API tetap melayani dari PostgreSQL, sehingga keberhasilan website saja bukan bukti Redis aktif.

## Migrasi dan menjalankan

Migrasi tidak otomatis berjalan saat `npm start`. Pastikan `PGDATABASE` sudah benar sebelum memulai. Jika database sudah berisi data, siapkan backup dan rencana pemulihan dahulu. Jangan menjalankan migrasi versi baru sementara API/consumer versi lama masih melayani pengguna.

Terminal API, dari `openjob_api`:

```powershell
npm run migrate
npm start
```

Terminal consumer, dari `openjob_consumer`:

```powershell
npm start
```

Buka alamat API, misalnya `http://127.0.0.1:3000/`: halaman website dilayani oleh API. Frontend tidak memerlukan server terpisah. `GET /api/health` memberi informasi mode/fitur, tetapi bukan pemeriksaan lengkap kesiapan semua layanan. Publisher notifikasi sudah berjalan bersama API; jangan menyalakan publisher tambahan untuk instalasi biasa.

Daftar akun pelamar/perekrut lewat website, verifikasi email, lalu coba alur yang sesuai. Di aplikasi biasa tidak ada password atau akun demo bawaan. Jalankan kembali kedua proses setelah kode atau konfigurasi berubah.

## Bukti jalur biasa sudah diuji

Dari `openjob_api`, `npm run test:normal-start` menjalankan berkas entrypoint persis yang dituju kedua script `npm start`, tanpa preload/mock/penggantian modul pada proses aplikasi. Pengujian memakai schema kosong yang baru pada PostgreSQL Docker QA port 5433; proses API dan consumer berdiri sendiri, dengan antrean berawalan unik serta CV buatan. Konfigurasi diberikan melalui environment proses di direktori kerja tanpa `.env`, sehingga `.env` asli tidak dipakai atau diubah.

Port 3102 hanya dipakai sementara selama tes, lalu dihentikan. Demo 3100 dan QA 3101 tidak direstart. Fixture database/file dipertahankan untuk pemeriksaan; antrean milik tes dibersihkan jika tes selesai sukses. Pengujian berulang menambah schema/file QA.

Hasil validasi: daftar dua akun tanpa seed, email verifikasi, perusahaan/lowongan, upload dan unduh PDF, lamaran, perubahan status dan email, restart kedua proses, login/riwayat/CV setelah restart, serta reset password lewat email consumer dan login dengan password baru: PASS. Regresi: 25 tes API dan 12 tes consumer lulus.

Hasil ini membuktikan fitur berjalan pada kode utama dengan PostgreSQL/RabbitMQ/SMTP lokal. Pengaturan hosting, email produksi, backup–restore, dan audit keamanan penuh tetap merupakan tahap terpisah. Database asli belum dimigrasikan.
