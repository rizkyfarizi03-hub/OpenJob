exports.up = (pgm) => {
  pgm.createTable("documents", {
    id: {
      type: "varchar(50)",
      primaryKey: true,
    },
    user_id: {
      type: "varchar(50)",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    filename: {
      type: "text",
      notNull: true,
      unique: true,
    },
    original_name: {
      type: "text",
      notNull: true,
    },
    mime_type: {
      type: "varchar(100)",
      notNull: true,
    },
    size: {
      type: "integer",
      notNull: true,
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("documents");
};
