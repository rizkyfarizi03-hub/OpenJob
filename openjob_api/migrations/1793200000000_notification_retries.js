exports.up=pgm=>{
 for(const table of ['application_outbox','application_status_outbox']){
  pgm.sql(`ALTER TABLE ${table}
   ADD COLUMN failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count>=0),
   ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
   ADD COLUMN failed_at timestamptz,
   ADD COLUMN last_error varchar(100);
   CREATE INDEX ${table}_retry_ready ON ${table}(next_attempt_at)
   WHERE published_at IS NULL AND notified_at IS NULL AND failed_at IS NULL;`);
 }
};
exports.down=pgm=>{
 for(const table of ['application_outbox','application_status_outbox'])pgm.sql(`DROP INDEX ${table}_retry_ready;
  ALTER TABLE ${table} DROP COLUMN failure_count,DROP COLUMN next_attempt_at,DROP COLUMN failed_at,DROP COLUMN last_error;`);
};
