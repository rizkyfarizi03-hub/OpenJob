exports.up = (pgm) =>
  pgm.sql(`
  UPDATE jobs SET location_type='on-site' WHERE lower(trim(location_type)) IN ('onsite','on_site','on-site');
  CREATE TABLE document_file_cleanup (filename text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT NOW());
  CREATE FUNCTION queue_document_file_cleanup() RETURNS trigger AS $$
  BEGIN
    INSERT INTO document_file_cleanup(filename) VALUES(OLD.filename) ON CONFLICT DO NOTHING;
    RETURN OLD;
  END; $$ LANGUAGE plpgsql;
  CREATE TRIGGER document_file_cleanup_trigger AFTER DELETE ON documents
    FOR EACH ROW EXECUTE FUNCTION queue_document_file_cleanup();
`);
// Normalized location values intentionally remain canonical on rollback.
exports.down = (pgm) =>
  pgm.sql(`DROP TRIGGER document_file_cleanup_trigger ON documents;
  DROP FUNCTION queue_document_file_cleanup(); DROP TABLE document_file_cleanup;`);
