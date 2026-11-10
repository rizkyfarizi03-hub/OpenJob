# OpenJob RESTful API V2 — API & Publisher

**Aplikasi pertama (independen)**: Express REST API, PostgreSQL, Multer, Redis, dan RabbitMQ publisher. Dibangun dari OpenJob V2 sebelumnya. File Consumer dan dependency SMTP **tidak berada di sini**.

Jalankan dengan terminal yang berada di folder `openjob_api`:

```powershell
Copy-Item .env.example .env
npm ci
# Isi .env: PostgreSQL, JWT, Redis, RabbitMQ
npm run migrate
npm run start:dev
```

`GET http://localhost:3000/` menampilkan website. JSON informasi mode/fitur tersedia pada `/api/health`. Panduan konfigurasi aplikasi biasa: [MENJALANKAN-OPENJOB.md](../MENJALANKAN-OPENJOB.md).

Saat `POST /applications` berhasil, API menyimpan record lamaran dan `application_outbox` secara transaksional. Publisher (otomatis berjalan bersama `npm start` / `npm run start:dev`) melakukan `assertQueue` durable `openjob.application.created`, memublikasikan `{ "application_id": "..." }` sebagai pesan persistent dengan publisher confirm, lalu menandai `published_at`. Jika RabbitMQ sementara offline, publisher mencoba lagi.

Consumer menjalankan proses tersendiri dari `../openjob_consumer`. **Tidak ada import source lintas project**; keduanya bertukar pesan melalui RabbitMQ dan menggunakan PostgreSQL yang sama.

## Script

- `npm start`: API + publisher background pada proses API.
- `npm run start:dev`: API + publisher dengan nodemon.
- `npm run publisher`: jalankan outbox dispatcher saja, **alternatif** untuk mode API yang tidak otomatis menyalakan publisher. Jangan jalankan publisher terpisah kecuali diperlukan.
- `npm run migrate`: jalankan migrasi PostgreSQL.
- `npm run test:unit`: pengujian publisher/queue dengan mock tanpa layanan eksternal.
- `npm test`: 25 tes API/publisher dan integrasi dengan PGlite sementara; tidak memerlukan PostgreSQL asli atau port 3000. Postman lama tersedia melalui `npm run test:legacy`.
- `npm run test:normal-start`: uji kode utama API dan consumer sebagai proses terpisah pada PostgreSQL Docker QA, tanpa mock modul; membutuhkan PostgreSQL QA, RabbitMQ, dan Mailpit lokal serta port 3102 kosong.

## Penting saat menguji

- Route website memakai PostgreSQL langsung; helper Redis belum dipakai oleh route saat ini. Untuk email gunakan `openjob_consumer`, RabbitMQ, serta SMTP seperti Mailpit.
- Untuk run penuh dari collection Postman V2, gunakan database pengujian baru (collection memakai beberapa email statis). Jangan ubah assertion agar tampak lulus.
- Folder `tests/fixtures/` berisi collection Postman yang tersedia pada ZIP semula. Pengujian upload Documents memerlukan request multipart/form-data manual.
- Tidak menyertakan `.env` sungguhan, file CV, atau `node_modules`.
- Baca `../README.md` untuk panduan Docker, konfigurasi kedua project, dan tes email end-to-end.
