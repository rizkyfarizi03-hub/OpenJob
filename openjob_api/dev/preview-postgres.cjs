// Persistent local QA only. No application .env or production queues are used.
const path = require("node:path");
const fs = require("node:fs/promises");
const { randomBytes } = require("node:crypto");
const { createRequire } = require("node:module");
const { Pool, Client } = require("pg");
const { config, migrate, setup } = require("./postgresQa.cjs");
const consumerRequire = createRequire(
  path.resolve(__dirname, "../../openjob_consumer/package.json"),
);
const schema = "web_qa",
  schemaMarker = "OpenJob persistent website QA";
const origin = "http://127.0.0.1:3101";
let server,
  pool,
  redis,
  cleanupTimer,
  stopping = false;
const connections = new Set();
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(code), 5000);
  deadline.unref();
  if (cleanupTimer) clearInterval(cleanupTimer);
  if (server) await new Promise((resolve) => server.close(resolve));
  await Promise.allSettled([...connections].map((c) => c.close()));
  await Promise.allSettled([
    pool?.end(),
    redis?.isOpen ? redis.quit() : undefined,
  ]);
  process.exit(code);
}
(async () => {
  // Prevent normal modules from loading unrelated .env settings in this dedicated launcher.
  require("dotenv").config = () => ({ parsed: {} });
  consumerRequire("dotenv").config = () => ({ parsed: {} });
  await setup();
  const admin = new Client(config());
  await admin.connect();
  try {
    const existing = await admin.query(
      "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
      [schema],
    );
    if (existing.rowCount && existing.rows[0].marker !== schemaMarker)
      throw Error("Website QA schema has no ownership marker");
    if (!existing.rowCount) {
      await admin.query("CREATE SCHEMA " + schema);
      await admin.query(
        "COMMENT ON SCHEMA " + schema + " IS '" + schemaMarker + "'",
      );
    }
    await migrate(admin, schema);
  } finally {
    await admin.end();
  }
  const secretPath = path.resolve(
    __dirname,
    "../.qa-postgres/web-secrets.json",
  );
  const keys = ["ACCESS_TOKEN_KEY", "REFRESH_TOKEN_KEY", "PASSWORD_RESET_KEY"];
  try {
    await fs.writeFile(
      secretPath,
      JSON.stringify(
        Object.fromEntries(
          keys.map((k) => [k, randomBytes(32).toString("hex")]),
        ),
      ),
      { flag: "wx", mode: 0o600 },
    );
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const secrets = JSON.parse(await fs.readFile(secretPath, "utf8"));
  for (const key of keys) {
    if (!/^[a-f0-9]{64}$/.test(secrets[key]))
      throw Error("Invalid QA secret file");
    process.env[key] = secrets[key];
  }
  Object.assign(process.env, {
    OPENJOB_DEMO: "0",
    OPENJOB_DEMO_MAIL: "0",
    OPENJOB_LOCAL_QA: "1",
    WEB_BASE_URL: origin,
    AMQP_URL: "amqp://openjob:openjob_local_2026@127.0.0.1:5672",
    MAIL_HOST: "127.0.0.1",
    MAIL_PORT: "1025",
    MAIL_USER: "openjob-qa@example.test",
    MAIL_PASSWORD: "local-only",
    MAIL_FROM: "openjob-qa@example.test",
    OPENJOB_UPLOAD_DIRECTORY: path.resolve(
      __dirname,
      "../qa-postgres-files/web_qa/documents",
    ),
  });
  await fs.mkdir(process.env.OPENJOB_UPLOAD_DIRECTORY, { recursive: true });
  pool = new Pool({ ...config(), options: "-c search_path=" + schema });
  require.cache[require.resolve("../src/database")] = { exports: pool };
  require.cache[consumerRequire.resolve("./src/database")] = { exports: pool };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('openjob_web_qa_seed'))",
    );
    const count = await client.query("SELECT count(*)::int AS n FROM users");
    if (count.rows[0].n === 0) await require("./sandbox.cjs").seed(client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  // Use the actual Redis service, with a namespace dedicated to this persistent website.
  redis = require("redis").createClient({ url: "redis://127.0.0.1:6379" });
  redis.on("error", (e) => console.error("QA Redis:", e.code || e.name));
  await redis.connect();
  const cachePrefix = "openjob:qa:web_qa:v1:";
  require.cache[require.resolve("../src/cache")] = {
    exports: {
      get: async (k) => {
        const v = await redis.get(cachePrefix + k);
        return v === null ? null : JSON.parse(v);
      },
      set: async (k, v) =>
        redis.set(cachePrefix + k, JSON.stringify(v), { EX: 3600 }),
      delete: async (...keys) => {
        if (keys.length) await redis.del(keys.map((k) => cachePrefix + k));
      },
    },
  };
  const rabbit = require("../src/rabbit");
  for (const key of ["QUEUE", "STATUS_QUEUE", "RESET_QUEUE", "VERIFY_QUEUE"])
    rabbit[key] = "openjob.qa.web_qa." + rabbit[key];
  const connect = rabbit.connect;
  rabbit.connect = async () => {
    const c = await connect();
    connections.add(c);
    c.once("close", () => connections.delete(c));
    return c;
  };
  require.cache[consumerRequire.resolve("./src/rabbit")] = { exports: rabbit };
  const probe = await rabbit.connect();
  await probe.close();
  const smtp = consumerRequire("nodemailer").createTransport({
    host: "127.0.0.1",
    port: 1025,
    secure: false,
    auth: { user: "openjob-qa@example.test", pass: "local-only" },
    connectionTimeout: 5000,
  });
  try {
    await smtp.verify();
  } finally {
    smtp.close();
  }
  const app = require("../src/server");
  server = await new Promise((resolve, reject) => {
    const s = app.listen(3101, "127.0.0.1", () => resolve(s));
    s.once("error", reject);
  });
  cleanupTimer = require("../src/documentCleanup").start();
  require("../src/publisher")
    .start()
    .catch(() => stop(1));
  consumerRequire("./src/consumer")
    .start()
    .catch(() => stop(1));
  console.log(
    "OpenJob PostgreSQL QA: " +
      origin +
      " (persistent test data; Mailpit localhost:8025)",
  );
  process.on("SIGINT", () => stop());
  process.on("SIGTERM", () => stop());
})().catch((e) => {
  console.error("POSTGRES_WEBSITE_QA_FAILED", e.code || e.message);
  stop(1);
});
