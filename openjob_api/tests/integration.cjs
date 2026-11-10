const path = require("path");
const root = path.resolve(__dirname, "..");
const { PGlite } = require("@electric-sql/pglite");
const { runner } = require("node-pg-migrate");
(async () => {
  const pg = new PGlite();
  await pg.waitReady;
  const query = async (sql, params) => {
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
  const pool = {
    query,
    connect: async () => ({ query, release() {} }),
    end: async () => {},
  };
  await runner({
    dbClient: { query, connect: async () => {}, end: async () => {} },
    dir: root + "/migrations",
    direction: "up",
    migrationsTable: "pgmigrations",
    noLock: true,
    log: () => {},
  });
  console.log("MIGRATIONS PASS");
  require.cache[require.resolve(root + "/src/database.js")] = { exports: pool };
  const data = new Map();
  require.cache[require.resolve(root + "/src/cache.js")] = {
    exports: {
      get: async (k) => (data.has(k) ? JSON.parse(data.get(k)) : null),
      set: async (k, v) => {
        data.set(k, JSON.stringify(v));
      },
      delete: async (...ks) => {
        ks.forEach((k) => data.delete(k));
      },
    },
  };
  process.env.ACCESS_TOKEN_KEY = "integration-test-access-key";
  process.env.REFRESH_TOKEN_KEY = "integration-test-refresh-key";
  const app = require(root + "/src/server");
  const server = app.listen(3000, "localhost", () =>
    console.log("TEST SERVER READY"),
  );
  const fs = require("fs");
  let collection = JSON.parse(
    fs.readFileSync(root + "/tests/fixtures/collection.json"),
  );
  collection.item = collection.item.filter(
    (x) => x.name !== "[Mandatory] Documents",
  );
  const newman = require(root + "/node_modules/newman");
  await new Promise((resolve, reject) =>
    newman.run(
      {
        collection,
        environment: root + "/tests/fixtures/environment.json",
        reporters: [],
      },
      (err, summary) => {
        if (err) return reject(err);
        fs.writeFileSync(
          root + "/tests/last-result.json",
          JSON.stringify(
            {
              stats: summary.run.stats,
              failures: summary.run.failures.map((x) => ({
                name: x.source.name,
                error: x.error.message,
                test: x.error.test,
              })),
            },
            null,
            2,
          ),
        );
        console.log(JSON.stringify(summary.run.stats.assertions));
        console.log(
          summary.run.failures
            .map((x) => x.source.name + ": " + x.error.message)
            .join("\n"),
        );
        if (summary.run.failures.length) process.exitCode = 1;
        resolve();
      },
    ),
  );
  const assert = require("node:assert/strict");
  const { randomUUID } = require("crypto");
  const jwt = require(root + "/node_modules/jsonwebtoken");
  const owner = randomUUID(),
    applicant = randomUUID(),
    company = randomUUID(),
    category = randomUUID(),
    job = randomUUID();
  await query(
    "INSERT INTO users(id,name,email,password_hash) VALUES($1,'Job Owner','owner@test.local','x'),($2,'Applicant Name','candidate@test.local','x')",
    [owner, applicant],
  );
  await query(
    "INSERT INTO companies(id,name,location,owner_id) VALUES($1,'Test','Test',$2)",
    [company, owner],
  );
  await query("INSERT INTO categories(id,name) VALUES($1,'Test')", [category]);
  await query(
    "INSERT INTO jobs(id,company_id,category_id,title,description,job_type,experience_level,location_type,owner_id) VALUES($1,$2,$3,'Test Job','Test','full-time','mid','remote',$4)",
    [job, company, category, owner],
  );
  const token = jwt.sign({ id: applicant }, process.env.ACCESS_TOKEN_KEY);
  const auth = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const base = "http://localhost:3000";
  let response = await fetch(base + "/applications", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ job_id: job }),
  });
  assert.equal(response.status, 201);
  const application = (await response.json()).data;
  response = await fetch(base + "/applications", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ job_id: job }),
  });
  assert.equal(response.status, 400);
  assert.equal(
    (
      await query("SELECT * FROM application_outbox WHERE application_id=$1", [
        application.id,
      ])
    ).rowCount,
    1,
  );
  const rabbitPath = require.resolve(root + "/src/rabbit");
  const sent = [];
  require.cache[rabbitPath] = {
    exports: {
      QUEUE: "openjob.application.created",
      connect: async () => ({
        createConfirmChannel: async () => ({
          on() {},
          assertQueue: async () => {},
          sendToQueue(queue, body, opts, cb) {
            sent.push({ queue, body, opts });
            cb();
          },
        }),
        close: async () => {},
      }),
    },
  };
  const { dispatch } = require(root + "/src/publisher");
  await dispatch();
  await dispatch();
  const relevant = sent.filter(
    (x) => JSON.parse(x.body).application_id === application.id,
  );
  assert.equal(relevant.length, 1);
  assert.deepEqual(JSON.parse(relevant[0].body), {
    application_id: application.id,
  });
  assert.equal(relevant[0].opts.persistent, true);
  // Notifikasi email diuji dalam test project Consumer yang independen.
  // API test tidak mengimpor source code dari project Consumer.
  // Real multipart requests exercise Multer, size/MIME validation, download and ownership.
  const upload = async (blob) => {
    const form = new FormData();
    if (blob) form.set("document", blob, "resume.pdf");
    return fetch(base + "/documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  };
  response = await upload(
    new Blob(["%PDF-1.4\nfixture\n%%EOF"], { type: "application/pdf" }),
  );
  assert.equal(response.status, 201);
  const doc = (await response.json()).data;
  response = await fetch(base + "/documents/" + doc.documentId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.equal(
    (await upload(new Blob(["not PDF"], { type: "text/plain" }))).status,
    400,
  );
  assert.equal(
    (
      await upload(
        new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], {
          type: "application/pdf",
        }),
      )
    ).status,
    400,
  );
  assert.equal((await upload()).status, 400);
  const ownerToken = jwt.sign({ id: owner }, process.env.ACCESS_TOKEN_KEY);
  response = await fetch(base + "/documents/" + doc.documentId, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(response.status, 403);
  response = await fetch(base + "/documents/" + doc.documentId, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await fetch(base + "/documents/" + doc.documentId)).status,
    404,
  );
  console.log(
    "PASS: outbox, duplicate rejection, publisher payload, PDF upload/download/size/MIME/ownership/delete",
  );
  // Verify the actual Redis adapter configuration and 3600-second expiry with a client double.
  delete require.cache[require.resolve(root + "/src/cache")];
  let options, expiry;
  const redisData = new Map();
  require.cache[require.resolve(root + "/node_modules/redis")] = {
    exports: {
      createClient: (o) => {
        options = o;
        return {
          on() {},
          connect: async () => {},
          get: async (k) => redisData.get(k) ?? null,
          set: async (k, v, o) => {
            expiry = o.EX;
            redisData.set(k, v);
          },
          del: async (ks) => ks.forEach((k) => redisData.delete(k)),
        };
      },
    },
  };
  const cache = require(root + "/src/cache");
  await cache.set("probe", { ok: true });
  assert.equal(expiry, 3600);
  assert.equal(options.socket.host, process.env.REDIS_HOST || "127.0.0.1");
  assert.deepEqual(await cache.get("probe"), { ok: true });
  await cache.delete("probe");
  assert.equal(await cache.get("probe"), null);
  console.log(
    "PASS: Redis adapter TTL, JSON round trip and invalidation (client double)",
  );
  await new Promise((resolve) => server.close(resolve));
  await pg.close();
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
