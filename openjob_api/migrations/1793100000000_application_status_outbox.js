exports.up = (pgm) => {
  pgm.createTable("application_status_outbox", {
    id: { type: "uuid", primaryKey: true },
    application_id: {
      type: "varchar(50)",
      notNull: true,
      references: "applications(id)",
      onDelete: "CASCADE",
    },
    status: { type: "varchar(20)", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    published_at: { type: "timestamptz" },
    notified_at: { type: "timestamptz" },
  });
  pgm.createIndex("application_status_outbox", ["published_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("application_status_outbox");
};
