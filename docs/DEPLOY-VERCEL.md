# Deploy demo OpenJob ke Vercel

Panduan ini membuat demo publik OpenJob di Vercel untuk portofolio. Arsitektur lengkap (RabbitMQ, consumer terpisah, Redis) tetap ada di repository dan dijalankan secara lokal; Vercel memakai mode ringan yang disusun oleh `api/index.js`.

## Bedanya dengan mode lokal

| Bagian | Lokal | Vercel |
| --- | --- | --- |
| API dan website | `openjob_api`, proses Node yang selalu menyala | Fungsi `api/index.js` |
| Email | Publisher → RabbitMQ → `openjob_consumer` → SMTP | API memanggil fungsi kirim milik consumer langsung setelah respons dikirim |
| Antrean email | Tabel outbox + RabbitMQ | Tabel outbox yang sama, tanpa RabbitMQ |
| Cache | Redis | Tidak ada; semua data dibaca dari PostgreSQL |
| File CV | Folder `uploads/documents` | Tabel `document_files` di PostgreSQL |
| Database | PostgreSQL lokal atau Docker | PostgreSQL terkelola, misalnya Neon |

Status, percobaan ulang, dan batas gagal email tetap dicatat dengan kode consumer yang sama. Bedanya, email yang gagal baru dicoba lagi ketika ada perubahan data berikutnya (misalnya pendaftaran atau lamaran baru), atau ketika pengguna menekan "Kirim Ulang Email Verifikasi".

## Yang perlu disiapkan

- Akun GitHub dengan repository ini.
- Akun Vercel (paket Hobby cukup).
- Database PostgreSQL. Cara termudah adalah Neon dari Marketplace Vercel.
- Opsional: akun SMTP untuk email, yaitu Brevo (disarankan untuk aplikasi) atau Gmail dengan App Password. Tanpa SMTP situs tetap jalan; lihat "Tanpa email" di bawah.

## Langkah

### 1. Import repository

Di Vercel pilih **Add New → Project**, lalu import repository ini. Biarkan **Root Directory** di folder utama. `vercel.json` sudah mengatur perintah install, build, dan routing, jadi **Framework Preset** boleh dibiarkan "Other".

Jangan klik Deploy dulu jika halaman itu meminta environment variable; isi dahulu langkah 2 dan 3. Kalau deploy pertama terlanjur gagal, tidak apa-apa: isi pengaturannya, lalu **Redeploy**.

### 2. Hubungkan database

Di project Vercel buka tab **Storage → Create Database → Neon**, lalu hubungkan ke project ini. Integrasi tersebut mengisi `DATABASE_URL` secara otomatis. Pilih region database yang dekat dengan region fungsi Vercel.

Saat build, `vercel/build.cjs` menjalankan semua migrasi. Jika `OPENJOB_PUBLIC_DEMO=1` dan database masih kosong, build juga membuat data contoh: dua akun, empat perusahaan, dan sembilan lowongan.

### 3. Isi environment variables

Buka **Settings → Environment Variables** dan isi:

| Nama | Isi |
| --- | --- |
| `ACCESS_TOKEN_KEY`, `REFRESH_TOKEN_KEY`, `PASSWORD_RESET_KEY` | Jalankan `node vercel/secrets.cjs` di komputer Anda, lalu salin ketiga baris hasilnya. Jangan dibagikan. |
| `OPENJOB_PUBLIC_DEMO` | `1` agar data contoh dibuat dan akun contoh dikunci |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD` | Opsional. Pengaturan SMTP, lihat tabel di bawah |
| `MAIL_FROM` | Opsional. Alamat pengirim, misalnya `OpenJob <alamat@domain-anda>` |
| `WEB_BASE_URL` | Opsional. Bila kosong, dipakai domain produksi Vercel (`https://nama-project.vercel.app`) |

Pengaturan SMTP:

| Layanan | `MAIL_HOST` | `MAIL_PORT` | `MAIL_USER` | `MAIL_PASSWORD` |
| --- | --- | --- | --- | --- |
| Brevo | `smtp-relay.brevo.com` | `587` | Login SMTP dari dashboard Brevo | SMTP key dari dashboard Brevo |
| Gmail | `smtp.gmail.com` | `465` | Alamat Gmail | App Password 16 karakter (butuh verifikasi 2 langkah) |

Di Brevo, alamat pada `MAIL_FROM` harus didaftarkan sebagai pengirim terverifikasi. Di Gmail, `MAIL_FROM` sebaiknya alamat Gmail yang sama.

Bila ada pengaturan wajib yang belum diisi, situs menampilkan pesan 503 yang menyebutkan nama variabel yang kurang. Pengaturan `MAIL_` dianggap satu paket: isi keempatnya, atau kosongkan semuanya.

### Tanpa email

Bila keempat pengaturan `MAIL_` dikosongkan, situs berjalan tanpa mengirim email:

- Pengunjung tetap bisa mencoba semua fitur dengan akun contoh.
- Akun baru bisa dibuat, tetapi tidak bisa diverifikasi, sehingga tidak bisa melamar atau menerbitkan lowongan. Website menjelaskan hal ini dan menyarankan akun contoh.
- Lupa password dan kirim ulang verifikasi menampilkan pesan bahwa email belum tersedia.

Email bisa ditambahkan kapan saja: isi keempat pengaturan `MAIL_` dan `MAIL_FROM`, lalu **Redeploy**.

### 4. Deploy dan coba

Klik **Deploy** (atau **Redeploy** setelah mengisi pengaturan). Setelah selesai:

1. Buka situs dan masuk dengan akun contoh `perekrut@example.com` atau `pelamar@example.com`, password `DemoOpenJob123!`.
2. Bila email sudah diatur, daftar akun baru dengan email sungguhan, lalu periksa kotak masuk (termasuk folder spam) dan buka tautan verifikasinya.

## Perilaku khusus demo publik

- Banner di atas situs memberi tahu pengunjung bahwa data bisa berubah dan meminta mereka tidak mengunggah CV asli.
- Email dan password akun contoh tidak bisa diubah, supaya pengunjung lain tetap bisa masuk. Nama dan data lain masih bisa diubah.
- Alamat contoh (`@example.com`, domain `.test`) tidak pernah dikirimi email. Email lamaran baru untuk perekrut contoh tidak dikirim ke mana pun.
- Pendaftaran dibatasi 10 kali per 15 menit per alamat IP. Penghitungnya disimpan di memori fungsi, jadi batas ini bersifat kira-kira, bukan jaminan.
- Paket Brevo gratis membatasi jumlah email harian, yang sekaligus membatasi penyalahgunaan.

## Mengatur ulang data demo

Buka SQL Editor di dashboard Neon dan jalankan:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

Lalu **Redeploy** di Vercel. Build akan membuat tabel dan data contoh dari awal. Seluruh akun, lamaran, CV, dan logo yang ada akan hilang.

## Menguji mode Vercel secara lokal

Dari folder utama, setelah `npm ci` di folder utama, `openjob_api`, dan `openjob_consumer`:

```powershell
npm run test:vercel
```

Tes ini menjalankan build, `api/index.js`, PostgreSQL (PGlite lewat protokol jaringan Postgres), dan server SMTP tiruan. Yang diperiksa: migrasi dan data contoh, pesan konfigurasi yang kurang, mode tanpa email, pendaftaran dan verifikasi lewat email, CV dan logo di database, lamaran dan email perubahan status, reset password, pembatasan pendaftaran, serta kegagalan SMTP. Tes ini tidak menghubungi Vercel, Neon, maupun layanan email sungguhan, jadi deploy pertama tetap perlu dicoba langsung.
