
# OpenJob RESTful API V2 + Consumer App (dokumentasi submission)

> Dokumen ini adalah README submission Dicoding yang asli, disimpan sebagai arsip. Ringkasan proyek terbaru ada di [README utama](../README.md). Collection Postman V2 mengikuti kontrak lama dan tidak lagi lulus penuh pada kode website saat ini.

**Panduan menjalankan kode utama saat ini: [MENJALANKAN-OPENJOB.md](MENJALANKAN-OPENJOB.md).** Panduan ini membedakan demo, pengujian persisten, dan aplikasi biasa.

Backup dan uji pemulihan QA tersedia melalui [BACKUP-PEMULIHAN.md](BACKUP-PEMULIHAN.md).

> **Pengembangan website:** frontend lokal sekarang tersedia di `openjob_web/`.
> Baca [WEBSITE.md](WEBSITE.md) untuk fitur, perubahan kontrak API, migrasi, dan pengujian terbaru.
> Coba dengan `npm run demo` dari folder utama atau dari `openjob_api`.
> Untuk website pengujian dengan data tersimpan, jalankan `npm run qa:web` lalu buka `http://127.0.0.1:3101`. Memerlukan layanan Docker lokal; petunjuk lengkap ada di WEBSITE.md. Demo sementara tetap di port 3100.
> Bagian di bawah merupakan dokumentasi submission API V2 awal; beberapa aturan akses telah diperketat untuk website.

Submission proyek OpenJob RESTful API Versi 2 untuk kelas
Belajar Fundamental Back-End dengan JavaScript.

Proyek terdiri dari dua aplikasi Node.js independen:

1. OpenJob API - REST API, PostgreSQL, Redis, dan RabbitMQ Publisher.
2. OpenJob Consumer - RabbitMQ Consumer dan pengiriman email melalui SMTP.

Kedua aplikasi mempunyai package.json, package-lock.json,
dependency, dan konfigurasi environment masing-masing.

Komunikasi asynchronous dilakukan melalui RabbitMQ dengan
nama queue `openjob.application.created`.

---

## 1. Struktur Project

```text
Submission/
│
├── openjob_api/
│   ├── migrations/
│   ├── src/
│   │   ├── server.js
│   │   ├── publisher.js
│   │   ├── rabbit.js
│   │   ├── database.js
│   │   └── routes/
│   ├── tests/
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   └── README.md
│
├── openjob_consumer/
│   ├── src/
│   │   ├── consumer.js
│   │   ├── rabbit.js
│   │   └── database.js
│   ├── tests/
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   └── README.md
│
├── compose.dev.yml
└── README.md
```

Kedua aplikasi dapat diinstal dan dijalankan secara terpisah.

Tidak ada import kode lintas aplikasi. API dan Consumer
menggunakan RabbitMQ yang sama dan terhubung ke database
PostgreSQL yang sama.

## 2. Teknologi yang Digunakan

### OpenJob API
- Node.js
- Express.js
- PostgreSQL
- node-pg-migrate
- JSON Web Token
- Joi
- Multer
- Redis
- RabbitMQ (amqplib)

### OpenJob Consumer
- Node.js
- RabbitMQ (amqplib)
- PostgreSQL
- Nodemailer
- SMTP

### Infrastruktur Pengujian
- Docker Desktop
- RabbitMQ Management
- Redis
- Mailpit
- Postman

## 3. Persiapan Environment

Pastikan perangkat sudah memiliki:

- Node.js versi 20 atau lebih baru
- npm
- PostgreSQL
- Docker Desktop

Docker Compose digunakan untuk menjalankan RabbitMQ,
Redis, dan Mailpit pada lingkungan pengembangan lokal.

### Menjalankan Docker

Buka terminal pada folder Submission.

```powershell
docker compose -f compose.dev.yml up -d
```

Periksa container:

```powershell
docker compose -f compose.dev.yml ps
```

Layanan yang tersedia:

| Service | Alamat |
|---------|--------|
| RabbitMQ | localhost:5672 |
| RabbitMQ Management | http://localhost:15672 |
| Redis | localhost:6379 |
| Mailpit SMTP | localhost:1025 |
| Mailpit Web | http://localhost:8025 |

Kredensial RabbitMQ untuk pengujian lokal:

- Username: openjob
- Password: openjob_local_2026

Kredensial tersebut hanya digunakan dalam konfigurasi
Docker lokal dan tidak ditujukan untuk deployment produksi.

PostgreSQL dijalankan secara terpisah pada komputer lokal.

## 4. Konfigurasi PostgreSQL

Siapkan database PostgreSQL, misalnya:

```text
Database : openjob_v2_test
Host     : localhost
Port     : 5432
```

Buat database dan user sesuai konfigurasi PostgreSQL
masing-masing.

Pastikan user mempunyai hak akses yang diperlukan untuk
menjalankan migrasi dan mengakses tabel.

Gunakan database pengujian terpisah agar tidak mengubah
data aplikasi lain.

## 5. Menjalankan OpenJob API

Buka terminal pertama, kemudian masuk ke folder:

```powershell
cd openjob_api
```

Jika file .env belum tersedia, salin dari contoh:

```powershell
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
}
```

Buka file `.env` dan sesuaikan:

- HOST dan PORT
- PGUSER
- PGPASSWORD
- PGDATABASE
- PGHOST dan PGPORT
- ACCESS_TOKEN_KEY
- REFRESH_TOKEN_KEY
- REDIS_HOST dan REDIS_PORT
- Konfigurasi RabbitMQ

ACCESS_TOKEN_KEY dan REFRESH_TOKEN_KEY harus menggunakan
dua secret berbeda.

Setelah konfigurasi selesai, instal dependency:

```powershell
npm ci
```

Jalankan migrasi PostgreSQL:

```powershell
npm run migrate
```

Jalankan API:

```powershell
npm run start:dev
```

Server dapat diakses melalui:

http://localhost:3000

Publisher RabbitMQ otomatis berjalan ketika server
OpenJob API dijalankan.

Tidak perlu menjalankan publisher secara terpisah
bersamaan dengan API.

## 6. Menjalankan OpenJob Consumer

Buka terminal VS Code kedua.

Dari folder Submission, masuk ke:

```powershell
cd openjob_consumer
```

Jika .env belum tersedia:

```powershell
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
}
```

Sebelum menjalankan Consumer, buka file `.env`.

Pastikan konfigurasi PostgreSQL sama dengan OpenJob API:

- PGUSER
- PGPASSWORD
- PGDATABASE
- PGHOST
- PGPORT

Pastikan konfigurasi RabbitMQ juga menggunakan broker
yang sama dengan API:

- RABBITMQ_HOST
- RABBITMQ_PORT
- RABBITMQ_USER
- RABBITMQ_PASSWORD

Untuk pengiriman email melalui Mailpit, gunakan
konfigurasi SMTP lokal yang tersedia pada .env.example.

Consumer tidak membutuhkan JWT maupun Redis.

Setelah .env dikonfigurasi:

```powershell
npm ci
npm start
```

Jika berhasil, terminal akan menampilkan:

```text
Consumer menunggu lamaran...
```

Biarkan terminal Consumer tetap berjalan selama
pengujian Message Queue.

## 7. Mekanisme Message Queue

OpenJob menggunakan RabbitMQ untuk memproses notifikasi
lamaran pekerjaan secara asynchronous.

Alur proses:

1. Pelamar mengirim lamaran melalui POST /applications.
2. API menyimpan lamaran ke PostgreSQL.
3. API mencatat application_id ke tabel application_outbox.
4. Publisher membaca data Outbox yang belum dipublikasikan.
5. Publisher mengirim pesan ke RabbitMQ.
6. Consumer menerima pesan RabbitMQ.
7. Consumer mengambil detail lamaran dan pemilik lowongan.
8. Consumer mengirim email melalui Nodemailer.
9. Setelah berhasil, Consumer memperbarui notified_at
   dan memberikan acknowledgment ke RabbitMQ.

Queue yang digunakan:

```text
openjob.application.created
```

Contoh payload pesan:

```json
{
  "application_id": "application-uuid"
}
```

Publisher menggunakan durable queue, persistent message,
dan publisher confirm.

Penggunaan Transactional Outbox membantu memastikan
lamaran yang telah disimpan tetap tercatat untuk
dipublikasikan apabila RabbitMQ sementara tidak tersedia.

Consumer menggunakan acknowledgment dan retry ketika
pemrosesan gagal.

Sistem menggunakan pola pengiriman at-least-once.
Duplikasi notifikasi masih mungkin terjadi dalam
kondisi kegagalan tertentu, misalnya proses berhenti
setelah SMTP menerima email tetapi sebelum transaksi
database berhasil di-commit.

## 8. Pengujian Message Queue

Pastikan OpenJob API, Consumer, RabbitMQ, PostgreSQL,
dan Mailpit sudah berjalan.

Gunakan Postman Collection OpenJob RESTful API V2.

Langkah pengujian:

1. Registrasikan dan login akun pemilik lowongan.
2. Buat perusahaan dan kategori.
3. Buat lowongan pekerjaan.
4. Registrasikan dan login akun pelamar.
5. Kirim lamaran melalui POST /applications.
6. Pastikan respons HTTP 201 Created.
7. Periksa terminal Consumer.
8. Buka http://localhost:8025.
9. Pastikan email notifikasi diterima oleh Mailpit.

Pengujian tambahan:

- Lamaran duplikat ditolak.
- Lamaran tanpa autentikasi ditolak.
- Lamaran untuk lowongan yang tidak tersedia ditolak.
- Pesan yang gagal diproses dapat dicoba kembali.

Pada negative testing, status HTTP 400, 401, atau 404
dapat menjadi hasil yang benar sesuai skenario pengujian.

## 9. Pengujian Upload Dokumen PDF

OpenJob menyediakan endpoint untuk mengelola dokumen PDF.

Fitur yang diuji:

- Upload tanpa autentikasi ditolak.
- Upload tanpa file ditolak.
- Upload file non-PDF ditolak.
- Upload PDF valid berhasil.
- File berukuran lebih dari 5 MB ditolak.
- Mengambil daftar dokumen.
- Melihat atau mengunduh dokumen.
- Menghapus dokumen sesuai autentikasi dan otorisasi.

Untuk request upload melalui Postman, gunakan Body
bertipe form-data dan pilih file PDF dari komputer lokal.

Pastikan file pengujian sesuai batas ukuran.

## 10. Pengujian Redis Caching

OpenJob menggunakan Redis untuk caching sejumlah
endpoint API.

Pengujian dilakukan menggunakan Postman Collection V2.

### Cache Miss

Ketika data belum tersedia di Redis, API mengambil
data dari PostgreSQL.

Header yang diharapkan:

```text
X-Data-Source: database
```

### Cache Hit

Ketika data sudah tersedia di Redis, request berikutnya
mengambil data dari cache.

Header yang diharapkan:

```text
X-Data-Source: cache
```

### Cache Invalidation

Ketika data diperbarui, cache terkait dihapus agar
request berikutnya mengambil data terbaru.

Pengujian mencakup:

- Company
- User
- Application Detail
- Applications by User
- Applications by Job
- Bookmarks by User
- Perubahan data perusahaan
- Pembuatan dan perubahan lamaran

Pastikan seluruh Test Results pada Postman menunjukkan
PASS sesuai skenario pengujian.

## 11. Pengujian Otomatis

Kedua aplikasi mempunyai pengujian masing-masing.

### Unit Test API

Masuk ke folder openjob_api:

```powershell
npm run test:unit
```

Script ini menjalankan:

```text
tests/broker.unit.test.cjs
```

### Integration Test API

Dari folder openjob_api:

```powershell
npm test
```

Pengujian ini menggunakan PGlite dan mock untuk
sejumlah dependency eksternal.

Pastikan port 3000 tidak sedang digunakan server API
sebelum menjalankan integration test.

### Unit Test Consumer

Masuk ke folder openjob_consumer:

```powershell
npm test
```

Script ini menjalankan:

```text
tests/consumer.unit.test.cjs
```

Unit test Consumer menggunakan dependency mock dan
tidak membutuhkan koneksi SMTP atau RabbitMQ sungguhan.

Pengujian otomatis tidak menggantikan pengujian
end-to-end melalui Postman, RabbitMQ, dan Mailpit.

## 12. Menghentikan Aplikasi

Untuk menghentikan API dan Consumer, tekan:

```text
Ctrl + C
```

Pada masing-masing terminal.

Untuk menghentikan container Docker, jalankan dari
folder Submission:

```powershell
docker compose -f compose.dev.yml down
```

Perintah tersebut tidak menghapus database PostgreSQL
lokal dan tidak menghapus source code aplikasi.

## 13. Checklist Sebelum Submission

Pastikan hal berikut sudah diperiksa:

- [ ] OpenJob API mempunyai package.json sendiri.
- [ ] OpenJob Consumer mempunyai package.json sendiri.
- [ ] Kedua aplikasi mempunyai package-lock.json.
- [ ] Dependency dapat diinstal dengan npm ci.
- [ ] .env.example tersedia untuk kedua aplikasi.
- [ ] Migrasi database berhasil.
- [ ] OpenJob API berjalan.
- [ ] OpenJob Consumer berjalan secara terpisah.
- [ ] RabbitMQ berhasil mengirim dan menerima pesan.
- [ ] Email notifikasi berhasil masuk ke Mailpit.
- [ ] Upload dan pengelolaan dokumen PDF berfungsi.
- [ ] Cache Miss dan Cache Hit berhasil diuji.
- [ ] Cache Invalidation berhasil diuji.
- [ ] Unit test dan pengujian Postman berhasil.
- [ ] ZIP berisi kedua folder project.
- [ ] ZIP tidak mengandung .env asli.
- [ ] ZIP tidak mengandung node_modules.
- [ ] ZIP tidak mengandung file pribadi hasil upload.

## 14. Catatan Submission

Struktur dua aplikasi independen dibuat untuk memenuhi
feedback reviewer mengenai pemisahan OpenJob API V2 dan
Consumer App.

File .env.example disediakan sebagai referensi konfigurasi.

Password database dan secret JWT asli tidak disertakan
dalam submission.

Penerimaan submission tetap mengikuti evaluasi dan
persyaratan resmi reviewer Dicoding.
