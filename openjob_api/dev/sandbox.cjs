// Isolated PGlite database for tests and local demo. Never connects to PostgreSQL.
const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const { PGlite } = require("@electric-sql/pglite");
const { runner } = require("node-pg-migrate");
const { randomBytes } = require("crypto");
async function createSandbox() {
  const pg = new PGlite();
  await pg.waitReady;
  const uploadDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "openjob-sandbox-"),
  );
  process.env.OPENJOB_UPLOAD_DIRECTORY = uploadDirectory;
  process.env.ACCESS_TOKEN_KEY = randomBytes(32).toString("hex");
  process.env.REFRESH_TOKEN_KEY = randomBytes(32).toString("hex");
  process.env.PASSWORD_RESET_KEY = randomBytes(32).toString("hex");
  process.env.WEB_BASE_URL = "http://127.0.0.1:3100";
  const raw = async (sql, params) => {
    if (typeof sql === "object") {
      params = sql.values;
      sql = sql.text;
    }
    const results =
      !params?.length && sql.includes(";")
        ? await pg.exec(sql)
        : [await pg.query(sql, params)];
    const r = results.at(-1) || {};
    return { ...r, rowCount: r.affectedRows || r.rows?.length || 0 };
  };
  // Serialize entire transactions: PGlite owns one connection.
  let tail = Promise.resolve();
  async function acquire() {
    let release;
    const previous = tail;
    tail = new Promise((r) => {
      release = r;
    });
    await previous;
    return release;
  }
  const pool = {
    query: async (...args) => {
      const release = await acquire();
      try {
        return await raw(...args);
      } finally {
        release();
      }
    },
    connect: async () => {
      const release = await acquire();
      return { query: raw, release };
    },
    end: async () => {},
  };
  await runner({
    dbClient: { query: raw, connect: async () => {}, end: async () => {} },
    dir: path.resolve(__dirname, "../migrations"),
    direction: "up",
    migrationsTable: "pgmigrations",
    noLock: true,
    log: () => {},
  });
  require.cache[require.resolve("../src/database")] = { exports: pool };
  const cache = new Map();
  require.cache[require.resolve("../src/cache")] = {
    exports: {
      get: async (k) => (cache.has(k) ? JSON.parse(cache.get(k)) : null),
      set: async (k, v) => cache.set(k, JSON.stringify(v)),
      delete: async (...keys) => keys.forEach((k) => cache.delete(k)),
    },
  };
  return {
    pool,
    uploadDirectory,
    close: async () => {
      await pg.close();
      // Only the exact directory created by mkdtemp is ever removed.
      await fs.rm(uploadDirectory, { recursive: true, force: true });
    },
  };
}
const seed = require("./demoSeed.cjs");
module.exports = { createSandbox, seed };
