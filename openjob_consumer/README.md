# OpenJob Consumer — RabbitMQ Email Worker

**Aplikasi kedua (independen)**: proses Node.js yang mengonsumsi queue RabbitMQ dan mengirimkan email notifikasi lamaran melalui SMTP. Proyek ini mempunyai `package.json`, `package-lock.json`, modul PostgreSQL, modul RabbitMQ, dan `.env` sendiri.

Tidak menggunakan kode, dependency, atau file environment dari `openjob_api`. Dependensi runtime hanya `amqplib`, `dotenv`, `nodemailer`, dan `pg`.

## Konfigurasi & menjalankan (PowerShell)

Panduan konfigurasi dua aplikasi dan perbedaannya dari demo: [MENJALANKAN-OPENJOB.md](../docs/MENJALANKAN-OPENJOB.md). `RABBITMQ_QUEUE_PREFIX` opsional harus sama dengan API; bawaan `openjob`. Gunakan awalan berbeda untuk lingkungan yang berbagi broker agar pesan tidak tertukar.

```powershell
Copy-Item .env.example .env
npm ci
# Ubah PostgreSQL (sama dengan API), RabbitMQ (sama dengan API), dan SMTP
npm start
```

`npm run start:dev` tersedia untuk mode watch. `npm test` menjalankan pengujian logic Consumer dengan database/broker/SMTP palsu dan tidak perlu layanan sungguhan.

## Cara kerja

Pemulihan password memakai antrean `openjob.account.password_reset` dengan payload `{ "id": "UUID permintaan" }` dan antrean gagal `openjob.account.password_reset.failed`. API/consumer harus memakai `PASSWORD_RESET_KEY` acak minimal 32 byte serta `WEB_BASE_URL` yang sama. Jalankan migrasi `1793300000000_password_resets.js` melalui API sebelum menjalankan versi ini. Consumer memeriksa masa berlaku dan pembatalan permintaan sebelum mengirim; token tidak disimpan mentah di database atau pesan RabbitMQ. Petunjuk demo email ada di `../WEBSITE.md`.

1. Consumer memakai channel confirm dan empat antrean durable: lamaran baru, perubahan status, reset password, dan verifikasi email; masing-masing memiliki antrean `.failed`, dengan prefetch 1.
2. Pesan lamaran baru berisi `{ "application_id": "..." }`. Pesan status wajib berisi `{ "id": "UUID event", "application_id": "...", "status": "interview" }` dan harus cocok dengan event database.
3. Consumer mengunci event pada database yang sama dengan API, lalu mengirim email ke pemilik lowongan atau pelamar. Event yang sudah `notified_at` tidak dikirim ulang pada pemrosesan normal. Message-ID menggunakan identitas event yang tetap.
4. Kegagalan SMTP dicatat melalui `failure_count`, `last_error`, dan `next_attempt_at`. Publisher mencoba lagi setelah 5 detik, kemudian 30 detik; jadwal tetap tersimpan setelah restart. Pesan asli di-ack hanya setelah transaksi jadwal berhasil.
5. Setelah tiga kegagalan tercatat, atau penolakan SMTP permanen 5xx, event ditandai `failed_at`. Pesan masuk antrean `.failed` masing-masing dan tidak dicoba kirim otomatis lagi. Pesan rusak juga dipisahkan. Pemindahan ke antrean gagal harus dikonfirmasi broker sebelum ack.
6. Gangguan database/broker tidak dianggap kegagalan SMTP; pesan tetap dapat dikirim ulang setelah koneksi pulih. Channel yang tertutup menyebabkan consumer menyambung ulang.

Sebelum menjalankan versi ini, hentikan API/publisher/consumer dan jalankan `npm run migrate` di `openjob_api`, termasuk migrasi `1793200000000_notification_retries.js`, kemudian jalankan kembali proses-proses tersebut. Jangan mencampur consumer lama dengan publisher baru. Mode demo menerapkan migrasi pada database sementara saat startup; publisher/consumer tetap tidak berjalan dalam demo.

Untuk memeriksa kegagalan, lihat antrean `openjob.application.created.failed` / `openjob.application.status_changed.failed` dan event dengan `failed_at IS NOT NULL` pada tabel outbox. Setelah penyebab diperbaiki, operator dapat menjadwalkan ulang **event yang dipilih dan belum notified** dengan mereset `failed_at`, `failure_count`, `last_error`, `published_at` dan mengatur `next_attempt_at=NOW()`. Pemulihan ini belum memiliki UI dan tidak dilakukan otomatis.

Pengujian lokal layanan nyata: dari `openjob_api`, jalankan `npm run test:notifications:live` setelah RabbitMQ dan Mailpit pada `compose.dev.yml` siap. Skrip memakai PGlite sementara dan antrean pengujian terpisah yang dibersihkan setelah selesai; dua email contoh masuk Mailpit lokal pada port 8025. Skrip tidak memakai `.env`, PostgreSQL asli, antrean produksi, atau SMTP eksternal. Kedua folder perlu dependency terpasang untuk menjalankan skrip gabungan ini.

Notifikasi menggunakan semantik *at-least-once*, bukan jaminan exactly-once: crash setelah SMTP menerima pesan tetapi sebelum commit database masih memungkinkan duplikasi email.

`MAIL_FROM` opsional; tanpa pengaturan ini alamat pengirim menggunakan `MAIL_USER`. Untuk pengujian lokal gunakan Mailpit di `http://localhost:8025` (setup dalam `../README.md`).

## Verifikasi email akun

Antrean tambahan `openjob.account.email_verification` dan `openjob.account.email_verification.failed` memakai payload ID permintaan saja. Jalankan migrasi API `1793400000000_email_verification.js` sebelum menjalankan API/publisher/consumer versi ini. Konfigurasi memakai `PASSWORD_RESET_KEY` dan `WEB_BASE_URL` yang sama di API dan consumer; tujuan HMAC verifikasi berbeda dari reset password. Tautan berlaku 24 jam. Consumer melewati permintaan kedaluwarsa, dibatalkan, sudah dipakai, atau alamat yang sudah diverifikasi/berubah.

Uji layanan lokal terbaru mencakup empat email contoh: lamaran, perubahan status, reset password, dan verifikasi email. Mode demo email pada `npm run demo:mail` mengirim email akun langsung ke Mailpit lokal dengan database sementara; tidak memakai antrean aplikasi asli.
