exports.up = (pgm) => {
  pgm.addColumns("categories", {
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });
  pgm.addColumns("jobs", {
    owner_id: {
      type: "varchar(50)",
      references: "users(id)",
      onDelete: "SET NULL",
    },
  });
  pgm.sql(
    "UPDATE jobs j SET owner_id=c.owner_id FROM companies c WHERE c.id=j.company_id",
  );
  // Historical duplicate applications stay available. New inserts cannot create another pair.
  pgm.createTable("application_pairs", {
    user_id: {
      type: "varchar(50)",
      references: "users(id)",
      onDelete: "CASCADE",
      notNull: true,
    },
    job_id: {
      type: "varchar(50)",
      references: "jobs(id)",
      onDelete: "CASCADE",
      notNull: true,
    },
  });
  pgm.addConstraint("application_pairs", "application_pairs_pk", {
    primaryKey: ["user_id", "job_id"],
  });
  pgm.sql(
    "INSERT INTO application_pairs SELECT DISTINCT user_id,job_id FROM applications",
  );
  pgm.sql(`CREATE FUNCTION guard_application_pair() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO application_pairs(user_id,job_id) VALUES(NEW.user_id,NEW.job_id); RETURN NEW; END $$;
 CREATE TRIGGER application_pair_guard BEFORE INSERT ON applications FOR EACH ROW EXECUTE FUNCTION guard_application_pair();
 CREATE FUNCTION release_application_pair() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 DELETE FROM application_pairs p WHERE p.user_id=OLD.user_id AND p.job_id=OLD.job_id AND NOT EXISTS(SELECT 1 FROM applications a WHERE a.user_id=OLD.user_id AND a.job_id=OLD.job_id); RETURN OLD; END $$;
 CREATE TRIGGER application_pair_release AFTER DELETE ON applications FOR EACH ROW EXECUTE FUNCTION release_application_pair();`);
  pgm.createTable("application_outbox", {
    application_id: {
      type: "varchar(50)",
      primaryKey: true,
      references: "applications(id)",
      onDelete: "CASCADE",
    },
    published_at: { type: "timestamptz" },
    notified_at: { type: "timestamptz" },
  });
};
exports.down = (pgm) => {
  pgm.dropTable("application_outbox");
  pgm.sql(
    "DROP TRIGGER application_pair_release ON applications; DROP TRIGGER application_pair_guard ON applications; DROP FUNCTION release_application_pair(); DROP FUNCTION guard_application_pair();",
  );
  pgm.dropTable("application_pairs");
  pgm.dropColumns("jobs", ["owner_id"]);
  pgm.dropColumns("categories", ["updated_at"]);
};
