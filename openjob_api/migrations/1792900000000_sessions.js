exports.up = pgm => {
  pgm.sql(`CREATE UNIQUE INDEX users_email_normalized ON users (lower(trim(email)));
    UPDATE users SET email=lower(trim(email));
    CREATE TABLE auth_sessions (
      id uuid PRIMARY KEY, user_id varchar(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_hash text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
    DELETE FROM authentications;`);
};
exports.down = pgm => pgm.sql('DROP TABLE auth_sessions; DROP INDEX users_email_normalized;');
