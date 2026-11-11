// Logo disimpan di database agar ikut backup dan tidak bergantung pada disk server.
exports.up = (pgm) =>
  pgm.sql(`ALTER TABLE companies ADD COLUMN logo_updated_at timestamptz;
  CREATE TABLE company_logos (
    company_id varchar(50) PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    mime_type varchar(30) NOT NULL,
    data bytea NOT NULL
  );`);
exports.down = (pgm) =>
  pgm.sql(
    "DROP TABLE company_logos; ALTER TABLE companies DROP COLUMN logo_updated_at;",
  );
