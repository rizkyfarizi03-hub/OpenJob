const { Client } = require("pg");
const { config } = require("./postgresQa.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
(async () => {
  const client = new Client(config());
  await client.connect();
  const result = { schemas: [], files: [] };
  try {
    const schemas = await client.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name ~ '^qa_[a-f0-9]{20}$' ORDER BY schema_name",
    );
    assert.ok(schemas.rowCount, "No QA schemas to check");
    for (const { schema_name: schema } of schemas.rows) {
      const entry = { schema, tables: {} };
      for (const table of [
        "users",
        "companies",
        "jobs",
        "documents",
        "applications",
      ]) {
        const rows = (
          await client.query(
            'SELECT * FROM "' + schema + '".' + table + " ORDER BY id",
          )
        ).rows;
        entry.tables[table] = {
          count: rows.length,
          hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        };
      }
      result.schemas.push(entry);
      const docs = await client.query(
        'SELECT filename FROM "' + schema + '".documents ORDER BY filename',
      );
      for (const { filename } of docs.rows) {
        if (path.basename(filename) !== filename)
          throw Error("Invalid QA document path");
        // Pagination fixtures intentionally have no uploaded PDF; record only actual files.
        for (const root of ["qa-postgres-files", ".qa-postgres"]) {
          const file = path.resolve(
            __dirname,
            "..",
            root,
            schema,
            "documents",
            filename,
          );
          let bytes;
          try {
            bytes = await fs.readFile(file);
          } catch (e) {
            if (e.code === "ENOENT") continue;
            throw e;
          }
          result.files.push({
            schema,
            filename,
            hash: createHash("sha256").update(bytes).digest("hex"),
          });
          break;
        }
      }
    }
  } finally {
    await client.end();
  }
  const manifest = path.resolve(__dirname, "../.qa-postgres/persistence.json");
  if (process.argv[2] === "--record") {
    await fs.writeFile(manifest, JSON.stringify(result));
    console.log(
      "QA_PERSISTENCE_RECORDED schemas=" +
        result.schemas.length +
        " files=" +
        result.files.length,
    );
  } else if (process.argv[2] === "--check") {
    assert.deepEqual(result, JSON.parse(await fs.readFile(manifest, "utf8")));
    console.log(
      "QA_PERSISTENCE_PASS schemas=" +
        result.schemas.length +
        " files=" +
        result.files.length,
    );
  } else throw Error("Use --record before restart and --check after restart");
})().catch((e) => {
  console.error("QA_PERSISTENCE_FAILED", e.code || e.message);
  process.exitCode = 1;
});
