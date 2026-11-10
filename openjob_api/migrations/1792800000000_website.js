exports.up = (pgm) => {
  pgm.addColumns("applications", {
    document_id: {
      type: "varchar(50)",
      references: "documents(id)",
      onDelete: "RESTRICT",
    },
    cover_letter: { type: "text", notNull: true, default: "" },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });
  // Existing owners retain access to their recruitment workspace.
  pgm.sql(
    "UPDATE users SET role='employer' WHERE role='user' AND (id IN (SELECT owner_id FROM companies) OR id IN (SELECT owner_id FROM jobs))",
  );
  pgm.createIndex("jobs", ["owner_id"]);
  pgm.createIndex("jobs", ["status", "created_at"]);
  pgm.createIndex("applications", ["document_id"]);
  // Enforce history preservation even when delete and application requests race.
  for (const [table, column, target] of [
    ["applications", "job_id", "jobs"],
    ["jobs", "company_id", "companies"],
    ["jobs", "category_id", "categories"],
  ]) {
    pgm.dropConstraint(table, `${table}_${column}_fkey`);
    pgm.addConstraint(table, `${table}_${column}_fkey`, {
      foreignKeys: {
        columns: column,
        references: `${target}(id)`,
        onDelete: "RESTRICT",
      },
    });
  }
  pgm.sql(`INSERT INTO categories(id,name) VALUES
    ('category-technology','Teknologi'), ('category-design','Desain'),
    ('category-marketing','Marketing'), ('category-business','Bisnis & Operasional'),
    ('category-finance','Keuangan'), ('category-customer','Customer Service')
    ON CONFLICT (id) DO NOTHING`);
};
exports.down = (pgm) => {
  for (const [table, column, target] of [
    ["applications", "job_id", "jobs"],
    ["jobs", "company_id", "companies"],
    ["jobs", "category_id", "categories"],
  ]) {
    pgm.dropConstraint(table, `${table}_${column}_fkey`);
    pgm.addConstraint(table, `${table}_${column}_fkey`, {
      foreignKeys: {
        columns: column,
        references: `${target}(id)`,
        onDelete: "CASCADE",
      },
    });
  }
  pgm.dropIndex("applications", ["document_id"]);
  pgm.dropIndex("jobs", ["status", "created_at"]);
  pgm.dropIndex("jobs", ["owner_id"]);
  pgm.dropColumns("applications", [
    "document_id",
    "cover_letter",
    "updated_at",
  ]);
  // Roles and category rows are intentionally retained to avoid losing user data.
};
