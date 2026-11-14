// Isi CV untuk mode penyimpanan database; kosong bila CV disimpan di folder.
exports.up = (pgm) =>
  pgm.sql(`CREATE TABLE document_files (
    filename text PRIMARY KEY REFERENCES documents(filename) ON DELETE CASCADE,
    data bytea NOT NULL
  );`);
exports.down = (pgm) => pgm.sql("DROP TABLE document_files;");
