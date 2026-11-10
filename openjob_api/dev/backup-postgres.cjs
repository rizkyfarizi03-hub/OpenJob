// Local QA backup/restore drill only. Never reads application .env or connects to PostgreSQL 5432.
const fs = require("node:fs/promises");
const nativeFs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { pipeline } = require("node:stream/promises");
const { createHash, randomBytes } = require("node:crypto");
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { config } = require("./postgresQa.cjs");
const container = "openjob-qa-postgres-qa-1",
  schema = "web_qa";
const apiRoot = path.resolve(__dirname, "..");
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function docker(args, { input, output } = {}) {
  const child = spawn("docker", args, {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "",
    stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const closed = once(child, "close");
  const tasks = [];
  if (input)
    tasks.push(pipeline(nativeFs.createReadStream(input), child.stdin));
  else child.stdin.end();
  if (output)
    tasks.push(
      pipeline(
        child.stdout,
        nativeFs.createWriteStream(output, { flags: "wx", mode: 0o600 }),
      ),
    );
  else
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
  const [[code]] = await Promise.all([closed, Promise.all(tasks)]);
  // No SQL payload or credentials are printed on failure.
  if (code !== 0)
    throw Error(
      "Docker PostgreSQL command failed: " +
        args.find((a) => a === "pg_dump" || a === "pg_restore") +
        " (exit " +
        code +
        ")",
    );
  return stdout.trim();
}
async function tableState(client) {
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",
    [schema],
  );
  const result = [];
  for (const { tablename: name } of tables.rows) {
    const rows = await client.query(
      "SELECT row_to_json(t)::text AS row FROM " +
        quote(schema) +
        "." +
        quote(name) +
        ' t ORDER BY row_to_json(t)::text COLLATE "C"',
    );
    result.push({
      name,
      count: rows.rowCount,
      sha256: sha(rows.rows.map((r) => r.row).join("\n")),
    });
  }
  return result;
}
async function regularCopy(source, target) {
  assert.ok(
    (await fs.lstat(source)).isFile(),
    "Backup source must be a regular file",
  );
  await fs.copyFile(source, target, nativeFs.constants.COPYFILE_EXCL);
  const bytes = await fs.readFile(target);
  return { sha256: sha(bytes), size: bytes.length };
}
async function backup() {
  const id =
    new Date().toISOString().replace(/[:.]/g, "-") +
    "-" +
    randomBytes(4).toString("hex");
  const directory = path.join(apiRoot, ".qa-postgres", "backups", id);
  await fs.mkdir(path.join(directory, "documents"), { recursive: true });
  const client = new Client(config());
  await client.connect();
  let manifest;
  try {
    const ownership = await client.query(
      "SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()",
    );
    assert.equal(
      ownership.rows[0]?.marker,
      "OpenJob isolated local QA 20261031",
    );
    const ns = await client.query(
      "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
      [schema],
    );
    assert.equal(ns.rows[0]?.marker, "OpenJob persistent website QA");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await client.query("SET LOCAL lock_timeout='5s'");
    const tables = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",
      [schema],
    );
    assert.ok(tables.rowCount);
    // Briefly block QA writes so DB rows, referenced PDFs and pg_dump share one consistent point.
    await client.query(
      "LOCK TABLE " +
        tables.rows
          .map((t) => quote(schema) + "." + quote(t.tablename))
          .join(",") +
        " IN SHARE MODE",
    );
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS id"))
      .rows[0].id;
    const partial = path.join(directory, "database.dump.partial");
    await docker(
      [
        "exec",
        container,
        "pg_dump",
        "-U",
        "openjob_qa",
        "-d",
        config().database,
        "--format=custom",
        "--schema=" + schema,
        "--no-owner",
        "--no-privileges",
        "--snapshot=" + snapshot,
      ],
      { output: partial },
    );
    await fs.rename(partial, path.join(directory, "database.dump"));
    const files = [];
    const docs = await client.query(
      "SELECT filename FROM " + quote(schema) + ".documents ORDER BY filename",
    );
    for (const { filename } of docs.rows) {
      assert.ok(
        /^[a-f0-9-]+\.pdf$/i.test(filename),
        "Unexpected QA document filename",
      );
      const info = await regularCopy(
        path.join(apiRoot, "qa-postgres-files", schema, "documents", filename),
        path.join(directory, "documents", filename),
      );
      files.push({ path: "documents/" + filename, ...info });
    }
    const secretInfo = await regularCopy(
      path.join(apiRoot, ".qa-postgres", "web-secrets.json"),
      path.join(directory, "web-secrets.json"),
    );
    let fixture = null;
    try {
      const candidate = JSON.parse(
        await fs.readFile(
          path.join(apiRoot, ".qa-postgres", "web-smoke.json"),
          "utf8",
        ),
      );
      if (
        (
          await client.query(
            "SELECT id FROM " + quote(schema) + ".documents WHERE id=$1",
            [candidate.document],
          )
        ).rowCount
      )
        fixture = candidate;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    manifest = {
      version: 1,
      id,
      createdAt: new Date().toISOString(),
      source: { container, database: config().database, schema },
      tables: await tableState(client),
      files,
      secrets: { path: "web-secrets.json", ...secretInfo },
      dump: {
        path: "database.dump",
        sha256: sha(await fs.readFile(path.join(directory, "database.dump"))),
      },
      fixture,
    };
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
  // A manifest is written last; a partial directory is never a successful backup.
  await fs.writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "QA_BACKUP_PASS tables=" +
      manifest.tables.length +
      " PDFs=" +
      manifest.files.length,
  );
  console.log("Backup: " + directory);
  return { directory, manifest };
}
async function runNode(file, args = [], env = {}) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd: apiRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
    windowsHide: true,
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, "Fixture setup failed");
}
async function restore({ directory, manifest }) {
  // Verify bytes before creating the separate restore database.
  assert.equal(manifest.version, 1);
  assert.equal(manifest.source.database, config().database);
  assert.equal(manifest.source.schema, schema);
  assert.equal(manifest.dump.path, "database.dump");
  assert.equal(manifest.secrets.path, "web-secrets.json");
  for (const file of manifest.files)
    assert.match(file.path, /^documents\/[a-f0-9-]+\.pdf$/i);
  assert.equal(
    sha(await fs.readFile(path.join(directory, manifest.dump.path))),
    manifest.dump.sha256,
    "Database dump checksum mismatch",
  );
  for (const file of [...manifest.files, manifest.secrets])
    assert.equal(
      sha(await fs.readFile(path.join(directory, file.path))),
      file.sha256,
      "Backup file checksum mismatch",
    );
  const database = "openjob_restore_" + randomBytes(8).toString("hex");
  const admin = new Client({ ...config(), database: "postgres" });
  await admin.connect();
  try {
    await admin.query("CREATE DATABASE " + quote(database));
    await admin.query(
      "COMMENT ON DATABASE " +
        quote(database) +
        " IS 'OpenJob disposable backup restore drill'",
    );
  } finally {
    await admin.end();
  }
  await docker(
    [
      "exec",
      "-i",
      container,
      "pg_restore",
      "-U",
      "openjob_qa",
      "-d",
      database,
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
    ],
    { input: path.join(directory, "database.dump") },
  );
  const target = path.join(apiRoot, "qa-postgres-files", "restored", database);
  await fs.mkdir(path.join(target, "documents"), { recursive: true });
  for (const file of manifest.files) {
    await regularCopy(
      path.join(directory, file.path),
      path.join(target, file.path),
    );
    assert.equal(
      sha(await fs.readFile(path.join(target, file.path))),
      file.sha256,
    );
  }
  await regularCopy(
    path.join(directory, manifest.secrets.path),
    path.join(target, "web-secrets.json"),
  );
  const client = new Client({ ...config(), database });
  await client.connect();
  try {
    assert.deepEqual(
      await tableState(client),
      manifest.tables,
      "Restored database rows differ from snapshot",
    );
  } finally {
    await client.end();
  }
  const secrets = JSON.parse(
    await fs.readFile(path.join(target, "web-secrets.json"), "utf8"),
  );
  for (const key of [
    "ACCESS_TOKEN_KEY",
    "REFRESH_TOKEN_KEY",
    "PASSWORD_RESET_KEY",
  ])
    assert.match(secrets[key], /^[a-f0-9]{64}$/);
  const authSecrets = Object.fromEntries(
    ["ACCESS_TOKEN_KEY", "REFRESH_TOKEN_KEY", "PASSWORD_RESET_KEY"].map(
      (key) => [key, secrets[key]],
    ),
  );
  const dbConfig = config(),
    prefix = "openjob.qa.restore." + database;
  const env = {
    ...process.env,
    ...authSecrets,
    HOST: "127.0.0.1",
    PORT: "3103",
    PGHOST: dbConfig.host,
    PGPORT: String(dbConfig.port),
    PGUSER: dbConfig.user,
    PGPASSWORD: dbConfig.password,
    PGDATABASE: database,
    PGOPTIONS: "-c search_path=" + schema,
    WEB_BASE_URL: "http://127.0.0.1:3103",
    OPENJOB_UPLOAD_DIRECTORY: path.join(target, "documents"),
    OPENJOB_DEMO: "0",
    OPENJOB_DEMO_MAIL: "0",
    OPENJOB_LOCAL_QA: "0",
    RABBITMQ_QUEUE_PREFIX: prefix,
    AMQP_URL: "amqp://openjob:openjob_local_2026@127.0.0.1:5672",
  };
  delete env.NODE_OPTIONS;
  const child = spawn(process.execPath, [path.join(apiRoot, "src/server.js")], {
    cwd: target,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.resume();
  child.stderr.resume();
  try {
    const base = "http://127.0.0.1:3103";
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error("Restored API exited");
      try {
        if ((await fetch(base + "/api/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(ready, "Restored API unavailable");
    if (manifest.fixture) {
      const login = await fetch(base + "/api/authentications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: manifest.fixture.email,
          password: "PersistentQa123!",
        }),
      });
      assert.equal(login.status, 200, "Restored account login failed");
      const token = (await login.json()).data.accessToken,
        headers = { Authorization: "Bearer " + token };
      const applications = await fetch(base + "/api/applications", {
        headers,
      }).then((r) => r.json());
      assert.ok(
        applications.data.applications.some(
          (a) =>
            a.id === manifest.fixture.application && a.status === "reviewing",
        ),
      );
      const pdf = await fetch(
        base + "/api/documents/" + manifest.fixture.document,
        { headers },
      );
      assert.equal(pdf.status, 200);
      const bytes = Buffer.from(await pdf.arrayBuffer());
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      const docsClient = new Client({ ...config(), database });
      await docsClient.connect();
      try {
        const filename = (
          await docsClient.query(
            "SELECT filename FROM " + quote(schema) + ".documents WHERE id=$1",
            [manifest.fixture.document],
          )
        ).rows[0].filename;
        assert.equal(
          sha(bytes),
          manifest.files.find((f) => f.path === "documents/" + filename).sha256,
        );
      } finally {
        await docsClient.end();
      }
    }
    const resultDirectory = path.join(directory, "restore-results");
    await fs.mkdir(resultDirectory, { recursive: true });
    await fs.writeFile(
      path.join(resultDirectory, database + ".json"),
      JSON.stringify(
        {
          result: "PASS",
          restoredDatabase: database,
          restoredFiles: target,
          tables: manifest.tables.length,
          pdfs: manifest.files.length,
          login: manifest.fixture ? true : null,
          applicationStatus: manifest.fixture ? true : null,
          downloadedCv: manifest.fixture ? true : null,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      manifest.fixture
        ? "QA_RESTORE_PASS: exact table rows + PDF checksums + account login + application status + CV download"
        : "QA_RESTORE_DATA_PASS: exact table rows + PDF checksums; no fictional account fixture available for login test",
    );
    console.log("Restored database retained: " + database);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
  // There is deliberately no consumer for the restored copy: no replay of historical emails.
  const broker = await require("amqplib").connect(env.AMQP_URL);
  try {
    const channel = await broker.createChannel();
    for (const suffix of [
      "application.created",
      "application.status_changed",
      "account.password_reset",
      "account.email_verification",
    ]) {
      const name = prefix + "." + suffix;
      await channel.assertQueue(name, { durable: true });
      await channel.deleteQueue(name);
    }
  } finally {
    await broker.close();
  }
}
(async () => {
  if (
    process.argv[2] &&
    !["--backup-only", "--restore"].includes(process.argv[2])
  )
    throw Error(
      "Use --backup-only, --restore BACKUP_ID, or no arguments for a full drill",
    );
  const only = process.argv[2] === "--backup-only";
  if (!only) {
    const probe = require("node:net").createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(3103, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
    if (process.argv[2] === "--restore") {
      const id = process.argv[3];
      assert.ok(
        id && /^[A-Za-z0-9-]+$/.test(id),
        "Provide a backup ID, without a path",
      );
      const directory = path.join(apiRoot, ".qa-postgres", "backups", id);
      const manifest = JSON.parse(
        await fs.readFile(path.join(directory, "manifest.json"), "utf8"),
      );
      await restore({ directory, manifest });
      return;
    }
    // Ensure a known fictional login/application/CV exists for the restore drill.
    await runNode(path.join(__dirname, "test-postgres-web.cjs"));
  }
  const saved = await backup();
  if (!only) await restore(saved);
})().catch((e) => {
  console.error("QA_BACKUP_RESTORE_FAILED", e.code || e.message);
  process.exitCode = 1;
});
