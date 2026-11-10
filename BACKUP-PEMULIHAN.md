# Backup dan pemulihan pengujian OpenJob

Prosedur ini khusus website QA port 3101. Sumbernya adalah schema `web_qa` dalam database Docker `openjob_qa_20261031` pada port 5433. Tidak membaca `.env` asli, tidak mengakses PostgreSQL Windows 5432, dan tidak mencadangkan schema pengujian lain.

## Isi backup

- Dump PostgreSQL format custom untuk seluruh schema website, termasuk tabel, relasi, indeks, trigger, migrasi, dan data.
- Semua file CV yang dirujuk tabel dokumen. Jika sebuah CV hilang, backup gagal dan tidak ditandai berhasil.
- Salinan kunci khusus QA `web-secrets.json`, agar sesi dan token yang dicadangkan memakai kunci yang cocok.
- `manifest.json` berisi jumlah baris dan checksum isi setiap tabel, checksum PDF/dump/kunci, serta metadata akun buatan untuk pengujian login jika tersedia. Nilai kunci dan isi akun tidak dicetak ke terminal.

Backup disimpan di `openjob_api/.qa-postgres/backups/<ID>`, diabaikan Git. Folder mengandung data dan kunci autentikasi QA; jangan dibagikan atau dimasukkan ke repository. Backup ini berada pada mesin yang sama: belum merupakan backup produksi yang terenkripsi, terjadwal, atau berada di lokasi lain.

## Membuat backup

Pastikan PostgreSQL Docker QA sudah sehat. Dari `openjob_api`:

```powershell
npm run qa:backup
```

Perintah memeriksa penanda kepemilikan database/schema QA sebelum berjalan. Selama pengambilan snapshot dan penyalinan CV, perubahan pada tabel QA ditahan sebentar; pembacaan tetap diperbolehkan. Jika kunci tabel tidak diperoleh dalam lima detik, proses gagal tanpa menimpa data sumber. Dump menggunakan snapshot PostgreSQL yang sama dengan pemeriksaan baris dan dokumen.

`manifest.json` ditulis terakhir. Folder tanpa manifest menandakan percobaan backup belum berhasil dan tidak boleh dianggap cadangan yang siap dipulihkan.

## Uji lengkap backup–restore

Dengan website QA 3101, RabbitMQ, dan Mailpit lokal menyala:

```powershell
npm run test:restore
```

Tes membuat akun, perusahaan, lowongan, lamaran, dan CV buatan melalui website QA, lalu membuat backup. Setelah itu tes membuat database baru bernama `openjob_restore_<acak>`, memulihkan dump, dan menyalin PDF serta kunci ke `openjob_api/qa-postgres-files/restored/<database>`.

Semua tabel hasil restore harus memiliki jumlah baris dan checksum yang sama dengan snapshot; file PDF juga harus identik. API utama kemudian dijalankan sementara pada 3103 untuk menguji login, status lamaran, dan unduhan CV. Port 3103 harus kosong dan dihentikan lagi setelah tes. Website 3100/3101 tidak direstart.

Consumer tidak dijalankan untuk salinan restore, sehingga riwayat email tidak diputar ulang. Publisher API memakai antrean khusus salinan ini; antreannya dibersihkan setelah uji sukses. Database dan direktori hasil restore dipertahankan untuk pemeriksaan; menjalankan tes lagi menambah salinan, tidak menimpa database yang ada.

## Memulihkan backup yang sudah ada

Tidak perlu website sumber menyala atau membuat backup baru. PostgreSQL Docker QA dan RabbitMQ lokal perlu tersedia. Gunakan ID folder yang dicetak saat backup, bukan path file:

```powershell
node dev/backup-postgres.cjs --restore ID_BACKUP
```

Setiap pemulihan membuat database baru. Proses memeriksa checksum dump, PDF, dan kunci sebelum membuat database tujuan. Tidak memakai `--clean`, tidak menghapus database, dan tidak menimpa sumber.

Hasil tiap pemulihan baru tersimpan dalam `restore-results/<database>.json` di folder backup. Bila backup memiliki metadata akun buatan yang cocok, hasil mencakup login, status, dan unduhan CV. Bila tidak tersedia, tes hanya membuktikan kecocokan data/file dan mencatat pemeriksaan login sebagai `null`, bukan sukses palsu. Password akun buatan yang telah diubah setelah fixture dibuat perlu diperhitungkan saat membaca kegagalan tes login.

## Hasil pemeriksaan

Pada uji 31 Oktober 2026, backup mencakup 16 tabel dan 2 PDF. Restore ke database baru berhasil, semua checksum cocok, login akun buatan berhasil, status lamaran `reviewing` tetap ada, dan CV berhasil diunduh dengan isi identik. Backup yang sama juga berhasil dipulihkan kedua kalinya ke database baru lainnya tanpa membuat ulang backup.

Ini membuktikan pemulihan lingkungan QA. Untuk penggunaan publik masih diperlukan pengaturan penyimpanan backup di lokasi lain, perlindungan kunci, jadwal/retensi, dan uji pemulihan pada infrastruktur produksi yang dipilih.
