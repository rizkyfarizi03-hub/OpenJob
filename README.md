# OpenJob

Platform lowongan kerja dengan dua peran: pelamar mencari lowongan dan melamar dengan CV, perekrut memasang lowongan dan mengelola proses seleksi. Proyek ini berawal dari submission kelas Belajar Fundamental Back-End dengan JavaScript (Dicoding), lalu dikembangkan menjadi website lengkap.

Status: berjalan dan teruji di lingkungan lokal. Belum di-hosting.

## Fitur

**Pelamar**

- Mencari lowongan dengan filter judul, kota, kategori, tipe, sistem kerja, dan pengalaman.
- Menyimpan lowongan (bookmark) dan mengelola CV berformat PDF.
- Melamar dengan CV dan pesan, memantau status, dan menarik lamaran.

**Perekrut**

- Mengelola profil perusahaan dan lowongan (buat, ubah, buka, tutup).
- Melihat pelamar, mengunduh CV yang berhak diakses, dan mengubah tahap seleksi.

**Akun**

- Registrasi, login dengan sesi yang bisa dicabut, verifikasi email, dan lupa password.
- Email notifikasi untuk lamaran baru dan perubahan status.

## Arsitektur

```text
Browser ──► openjob_api (Express) ──► PostgreSQL
                │   │                     ▲
                │   └──► Redis (cache)    │
                ▼                         │
            RabbitMQ ──► openjob_consumer ┘──► SMTP
```

| Folder | Peran |
| --- | --- |
| `openjob_api` | REST API, publisher RabbitMQ, dan penyaji frontend |
| `openjob_consumer` | Worker terpisah yang mengirim email dari antrean |
| `openjob_web` | Frontend HTML, CSS, dan JavaScript tanpa proses build |

API dan consumer adalah dua aplikasi Node.js independen. Keduanya tidak saling mengimpor kode dan hanya berbagi database serta broker.

Beberapa keputusan teknis:

- **Transactional outbox.** Lamaran dan catatan notifikasinya disimpan dalam satu transaksi, lalu publisher mengirimkannya ke RabbitMQ. Lamaran tidak hilang ketika broker sedang mati.
- **Pengiriman at-least-once.** Consumer memakai acknowledgment, mencoba ulang hingga tiga kali, dan memisahkan pesan gagal ke antrean tersendiri. Email ganda masih mungkin terjadi pada kegagalan tertentu.
- **Cache per akun.** Enam endpoint memakai Redis dengan header `X-Data-Source`. Data pribadi di-cache per akun dan dihapus saat data terkait berubah. Tanpa Redis, API tetap melayani dari PostgreSQL.
- **Riwayat dijaga di database.** Lamaran ganda dicegah lewat trigger, dan lowongan yang sudah punya lamaran hanya bisa ditutup, tidak dihapus.
- **Akses dokumen terbatas.** CV hanya bisa dibuka pemiliknya dan perekrut yang menerima lamaran terkait.

## Teknologi

Node.js 20+, Express 5, PostgreSQL, node-pg-migrate, Redis, RabbitMQ (amqplib), Nodemailer, JWT, Joi, Multer, dan pdf-lib. Pengujian memakai `node:test` dan PGlite.

## Mencoba secara lokal

Cara tercepat tidak membutuhkan PostgreSQL, Redis, atau RabbitMQ:

```powershell
cd openjob_api
npm ci
npm run demo
```

Buka http://127.0.0.1:3100 lalu masuk dengan akun contoh:

| Peran | Email | Password |
| --- | --- | --- |
| Pelamar | pelamar@example.com | DemoOpenJob123! |
| Perekrut | perekrut@example.com | DemoOpenJob123! |

Data demo disimpan di memori dan hilang ketika proses berhenti. Untuk menjalankan dengan PostgreSQL, RabbitMQ, Redis, dan email, ikuti [MENJALANKAN-OPENJOB.md](MENJALANKAN-OPENJOB.md).

## Pengujian

```powershell
cd openjob_api
npm test        # 37 tes: API, cache, fitur pencarian, notifikasi, reset password, verifikasi email

cd ../openjob_consumer
npm test        # 12 tes consumer
```

Kedua perintah berjalan tanpa layanan eksternal. Pengujian terhadap PostgreSQL, RabbitMQ, dan Mailpit sungguhan dijelaskan di [WEBSITE.md](WEBSITE.md).

Format, lint, dan uji alur frontend dijalankan dari folder utama:

```powershell
npm install
npm run format
npm run lint
npm run test:ui   # alur pelamar dan perekrut di jsdom, butuh npm ci di openjob_api
```

## Batasan

- Belum ada hosting, domain, HTTPS, atau SMTP produksi.
- Token sesi disimpan di `sessionStorage`; cookie HttpOnly perlu dipertimbangkan sebelum dipublikasikan.
- Pembatasan percobaan login dan reset password disimpan di memori proses, sehingga belum cocok untuk lebih dari satu instance API.
- Belum ada dashboard admin, unggah logo perusahaan, atau penjadwalan wawancara.

## Dokumentasi lain

- [MENJALANKAN-OPENJOB.md](MENJALANKAN-OPENJOB.md): konfigurasi dan cara menjalankan tiap mode.
- [WEBSITE.md](WEBSITE.md): catatan pengembangan website, kontrak API, dan hasil pengujian.
- [BACKUP-PEMULIHAN.md](BACKUP-PEMULIHAN.md): backup dan uji pemulihan lingkungan QA.
- [docs/SUBMISSION-V2.md](docs/SUBMISSION-V2.md): dokumentasi submission Dicoding yang asli.
