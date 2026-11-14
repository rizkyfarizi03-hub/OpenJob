# OpenJob frontend

Antarmuka HTML/CSS/JavaScript tanpa build tambahan, disajikan oleh Express dari `openjob_api`.

- `index.html`: dokumen utama, landmark, dialog dan live status.
- `assets/styles.css`: desain responsif beranda, daftar/detail lowongan, akun dan dashboard.
- `assets/app.js`: routing hash, klien API same-origin, sesi, formulir dan interaksi.
- `assets/favicon.svg`: ikon aplikasi lokal.

Jangan membuka `index.html` langsung melalui `file://`, karena API dan aset membutuhkan server.
Dari `openjob_api`, jalankan `npm run demo` dan buka http://127.0.0.1:3100.
Untuk PostgreSQL, jalankan migrasi lalu `npm start` sebagaimana dijelaskan pada [panduan website](../docs/WEBSITE.md).
