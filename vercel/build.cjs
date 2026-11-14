// Dijalankan Vercel saat build: menjalankan migrasi, lalu mengisi data contoh bila
// OPENJOB_PUBLIC_DEMO=1 dan database masih kosong.
const fs = require("fs");
const path = require("path");

// Folder keluaran sengaja kosong: semua halaman dilayani oleh fungsi api/index.js,
// sehingga berkas sumber di repository tidak ikut tersaji.
fs.mkdirSync(path.join(__dirname, "public"), { recursive: true });

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL belum diatur. Hubungkan database Postgres (misalnya Neon) ke project Vercel, lalu deploy ulang.",
  );
  process.exit(1);
}
// Dependency diambil dari openjob_api, sama seperti saat aplikasi berjalan biasa.
const apiRequire = require("module").createRequire(
  path.resolve(__dirname, "../openjob_api/package.json"),
);
const { runner } = apiRequire("node-pg-migrate");
const { Pool } = apiRequire("pg");

(async () => {
  await runner({
    databaseUrl: process.env.DATABASE_URL,
    dir: path.resolve(__dirname, "../openjob_api/migrations"),
    direction: "up",
    migrationsTable: "pgmigrations",
    log: (message) => console.log(message),
  });
  if (process.env.OPENJOB_PUBLIC_DEMO !== "1") return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('openjob_demo_seed'))",
    );
    const { rows } = await client.query("SELECT count(*)::int AS n FROM users");
    if (rows[0].n === 0) {
      await require("../openjob_api/dev/demoSeed.cjs")(client);
      console.log("Data contoh dibuat.");
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error("Build OpenJob gagal:", e.message);
  process.exit(1);
});
