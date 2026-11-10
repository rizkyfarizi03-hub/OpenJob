exports.up = (pgm) => {
  // Tabel Users
  pgm.createTable("users", {
    id: { type: "varchar(50)", primaryKey: true },
    name: { type: "varchar(255)", notNull: true },
    email: { type: "varchar(255)", notNull: true, unique: true },
    password_hash: { type: "text", notNull: true },
    role: { type: "varchar(30)", notNull: true, default: "user" },
    created_at: { type: "timestamptz", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  // Tabel Companies
  pgm.createTable("companies", {
    id: { type: "varchar(50)", primaryKey: true },
    name: { type: "varchar(255)", notNull: true },
    location: { type: "varchar(255)", notNull: true },
    description: { type: "text" },
    created_at: { type: "timestamptz", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  // Tabel Categories
  pgm.createTable("categories", {
    id: { type: "varchar(50)", primaryKey: true },
    name: { type: "varchar(255)", notNull: true },
    created_at: { type: "timestamptz", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  // Tabel Jobs
  pgm.createTable("jobs", {
    id: { type: "varchar(50)", primaryKey: true },
    company_id: {
      type: "varchar(50)",
      notNull: true,
      references: "companies(id)",
      onDelete: "CASCADE",
    },
    category_id: {
      type: "varchar(50)",
      notNull: true,
      references: "categories(id)",
      onDelete: "CASCADE",
    },
    title: { type: "varchar(255)", notNull: true },
    description: { type: "text", notNull: true },
    job_type: { type: "varchar(50)", notNull: true },
    experience_level: { type: "varchar(50)", notNull: true },
    location_type: { type: "varchar(50)", notNull: true },
    location_city: { type: "varchar(255)" },
    salary_min: { type: "integer" },
    salary_max: { type: "integer" },
    is_salary_visible: { type: "boolean", default: false },
    status: { type: "varchar(50)", notNull: true, default: "open" },
    created_at: { type: "timestamptz", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  // Tabel Applications
  pgm.createTable("applications", {
    id: { type: "varchar(50)", primaryKey: true },
    user_id: {
      type: "varchar(50)",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    job_id: {
      type: "varchar(50)",
      notNull: true,
      references: "jobs(id)",
      onDelete: "CASCADE",
    },
    status: { type: "varchar(50)", notNull: true, default: "pending" },
    created_at: { type: "timestamptz", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  // Tabel Bookmarks
  pgm.createTable("bookmarks", {
    id: { type: "varchar(50)", primaryKey: true },
    user_id: {
      type: "varchar(50)",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    job_id: {
      type: "varchar(50)",
      notNull: true,
      references: "jobs(id)",
      onDelete: "CASCADE",
    },
    created_at: { type: "timestamptz", default: pgm.func("CURRENT_TIMESTAMP") },
  });

  pgm.addConstraint("bookmarks", "unique_user_job", {
    unique: ["user_id", "job_id"],
  });

  // Tabel Authentications
  pgm.createTable("authentications", {
    token: { type: "text", primaryKey: true },
    user_id: {
      type: "varchar(50)",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("authentications");
  pgm.dropTable("bookmarks");
  pgm.dropTable("applications");
  pgm.dropTable("jobs");
  pgm.dropTable("categories");
  pgm.dropTable("companies");
  pgm.dropTable("users");
};
