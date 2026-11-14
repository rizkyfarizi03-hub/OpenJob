require("dotenv").config();

const { Pool } = require("pg");

// DATABASE_URL (misalnya dari Neon) didahulukan; selain itu memakai variabel PG*.
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.PG_POOL_MAX) || 5,
      }
    : {
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT),
        database: process.env.PGDATABASE,
      },
);

module.exports = pool;
