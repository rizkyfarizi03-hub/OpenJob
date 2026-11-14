const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { randomUUID } = require("crypto");
const pool = require("./database");

// CV disimpan di folder (bawaan) atau di tabel document_files. Mode database dipakai
// pada hosting tanpa disk permanen seperti Vercel.
const inDatabase = process.env.OPENJOB_DOCUMENT_STORAGE === "database";
const directory =
  process.env.OPENJOB_UPLOAD_DIRECTORY ||
  path.resolve(__dirname, "../uploads/documents");
if (!inDatabase) fs.mkdirSync(directory, { recursive: true });

const fileName = () => `${randomUUID()}.pdf`;
const storage = inDatabase
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, callback) => callback(null, directory),
      filename: (req, file, callback) => callback(null, fileName()),
    });

module.exports = {
  inDatabase,
  directory,
  storage,
  // memoryStorage tidak memberi nama berkas, jadi nama dibuat di sini.
  prepare(file) {
    if (inDatabase) file.filename = fileName();
  },
  read: (file) =>
    inDatabase ? Promise.resolve(file.buffer) : fs.promises.readFile(file.path),
  discard: (file) =>
    inDatabase ? Promise.resolve() : fs.promises.unlink(file.path),
  // Dipanggil di dalam transaksi yang sama dengan pembuatan baris documents.
  async save(db, file) {
    if (inDatabase)
      await db.query(
        "INSERT INTO document_files(filename,data) VALUES($1,$2)",
        [file.filename, file.buffer],
      );
  },
  async send(res, filename, missing) {
    if (!inDatabase)
      return res.sendFile(path.join(directory, filename), (error) => {
        if (error && !res.headersSent) missing();
      });
    const { rows } = await pool.query(
      "SELECT data FROM document_files WHERE filename=$1",
      [filename],
    );
    if (!rows.length) return missing();
    res.send(Buffer.from(rows[0].data));
  },
};
