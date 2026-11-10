exports.up=pgm=>pgm.sql(`ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
 CREATE TABLE email_verification_requests (
 id uuid PRIMARY KEY,user_id varchar(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 email varchar(255) NOT NULL,token_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT NOW(),
 expires_at timestamptz NOT NULL,used_at timestamptz,invalidated_at timestamptz,
 published_at timestamptz,notified_at timestamptz,failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT NOW(),failed_at timestamptz,last_error varchar(100));
 CREATE INDEX email_verification_user ON email_verification_requests(user_id);
 CREATE INDEX email_verification_ready ON email_verification_requests(next_attempt_at)
 WHERE published_at IS NULL AND notified_at IS NULL AND failed_at IS NULL AND used_at IS NULL AND invalidated_at IS NULL;`);
exports.down=pgm=>pgm.sql('DROP TABLE email_verification_requests; ALTER TABLE users DROP COLUMN email_verified_at;');
