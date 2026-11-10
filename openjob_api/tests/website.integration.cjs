const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("../dev/sandbox.cjs");

test("OpenJob website: authentication, privacy, search and recruitment lifecycle", async (t) => {
  const sandbox = await createSandbox();
  const app = require("../src/server");
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await sandbox.close();
  });
  // Keep HTTP status distinct from the API status field.
  async function call(path, method = "GET", body, token) {
    const headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    if (body && !(body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const r = await fetch(base + "/api" + path, {
      method,
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    return { code: r.status, body: await r.json() };
  }
  async function user(name, role = "user") {
    const email = name.toLowerCase() + "@example.com",
      password = "TestOpenJob123!";
    const r = await call("/users", "POST", { name, email, password, role });
    assert.equal(r.code, 201);
    // These fixtures exercise recruitment after verification; unverified access has a dedicated suite.
    await sandbox.pool.query(
      "UPDATE users SET email_verified_at=NOW() WHERE id=$1",
      [r.body.data.id],
    );
    const login = await call("/authentications", "POST", { email, password });
    assert.equal(login.code, 200);
    return {
      id: r.body.data.id,
      token: login.body.data.accessToken,
      refresh: login.body.data.refreshToken,
      email,
      password,
    };
  }
  const owner = await user("Owner", "employer"),
    other = await user("Other", "employer"),
    candidate = await user("Candidate"),
    stranger = await user("Stranger");
  let company, job, document, application;
  const category = "category-technology";
  await t.test(
    "serves frontend, CSS, JS and health without exposing implementation files",
    async () => {
      const r = await fetch(base);
      assert.equal(r.status, 200);
      assert.match(await r.text(), /OpenJob/);
      assert.ok(
        r.headers.get("content-security-policy").includes("script-src 'self'"),
      );
      assert.equal(r.headers.get("cache-control"), "no-store");
      for (const asset of ["app.js", "styles.css", "favicon.svg"]) {
        const response = await fetch(base + "/assets/" + asset);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-cache");
      }
      assert.equal((await call("/health")).code, 200);
      assert.equal((await fetch(base + "/.env")).status, 404);
      assert.equal((await call("/does-not-exist")).code, 404);
    },
  );
  await t.test(
    "registration cannot create admin and user identity is private",
    async () => {
      assert.equal(
        (
          await call("/users", "POST", {
            name: "Bad",
            email: "bad@example.com",
            password: "TestOpenJob123!",
            role: "admin",
          })
        ).code,
        400,
      );
      assert.equal((await call("/users/" + candidate.id)).code, 401);
      assert.equal(
        (await call("/users/" + candidate.id, "GET", null, stranger.token))
          .code,
        403,
      );
      assert.equal(
        (await call("/profile", "GET", null, candidate.token)).body.data.email,
        candidate.email,
      );
      assert.equal(
        (
          await call(
            "/categories",
            "POST",
            { name: "Unauthorized" },
            candidate.token,
          )
        ).code,
        403,
      );
    },
  );
  await t.test(
    "company creation is restricted to recruiters and edits to owner",
    async () => {
      assert.equal(
        (
          await call(
            "/companies",
            "POST",
            { name: "No", location: "Jakarta" },
            candidate.token,
          )
        ).code,
        403,
      );
      const c = await call(
        "/companies",
        "POST",
        { name: "Acme", location: "Jakarta", description: "Testing company" },
        owner.token,
      );
      assert.equal(c.code, 201);
      company = c.body.data.id;
      assert.equal(
        (
          await call(
            "/companies/" + company,
            "PUT",
            { name: "Stolen" },
            other.token,
          )
        ).code,
        404,
      );
      assert.equal(
        (await call("/companies/mine", "GET", null, other.token)).body.data
          .companies.length,
        0,
      );
      const compSearch = await call("/companies?name=Acme&location=Jakarta");
      assert.equal(compSearch.code, 200);
      assert.equal(compSearch.body.data.companies.length, 1);
      assert.equal(compSearch.body.data.pagination.total, 1);
      const compEmpty = await call("/companies?name=NonExistent");
      assert.equal(compEmpty.code, 200);
      assert.equal(compEmpty.body.data.companies.length, 0);
      assert.equal(compEmpty.body.data.pagination.total, 0);
    },
  );
  const jobBody = {
    company_id: null,
    category_id: category,
    title: "Frontend Developer",
    description: "Build accessible interfaces",
    job_type: "full-time",
    experience_level: "junior",
    location_type: "hybrid",
    location_city: "Jakarta",
    salary_min: 6000000,
    salary_max: 10000000,
    is_salary_visible: false,
  };
  await t.test(
    "job creation validates company ownership, role and salary range",
    async () => {
      jobBody.company_id = company;
      assert.equal(
        (await call("/jobs", "POST", jobBody, candidate.token)).code,
        403,
      );
      assert.equal(
        (await call("/jobs", "POST", jobBody, other.token)).code,
        403,
      );
      assert.equal(
        (
          await call(
            "/jobs",
            "POST",
            { ...jobBody, salary_min: 12000000 },
            owner.token,
          )
        ).code,
        400,
      );
      const r = await call("/jobs", "POST", jobBody, owner.token);
      assert.equal(r.code, 201);
      job = r.body.data.id;
      assert.equal(
        (await call("/jobs/" + job, "PUT", { title: "Stolen" }, other.token))
          .code,
        404,
      );
      assert.equal(
        (await call("/jobs/" + job, "DELETE", null, other.token)).code,
        404,
      );
    },
  );
  await t.test(
    "search combines filters, paginates and hides salary in all public job routes",
    async () => {
      const r = await call(
        "/jobs?title=Frontend&location=Jakarta&location_type=hybrid&category=" +
          category +
          "&limit=1",
      );
      assert.equal(r.code, 200);
      assert.equal(r.body.data.pagination.total, 1);
      assert.equal(r.body.data.jobs[0].salary_min, null);
      assert.equal((await call("/jobs?page=0")).code, 400);
      assert.equal(
        (await call("/jobs?location_type=remote")).body.data.pagination.total,
        0,
      );
      assert.equal(
        (await call("/jobs?page=2&limit=1")).body.data.jobs.length,
        0,
      );
      for (const p of [
        "/jobs/" + job,
        "/jobs/company/" + company,
        "/jobs/category/" + category,
      ]) {
        const x = (await call(p)).body.data;
        assert.equal((x.jobs ? x.jobs[0] : x).salary_max, null);
      }
      assert.equal(
        (await call("/jobs/mine", "GET", null, owner.token)).body.data.jobs[0]
          .salary_min,
        6000000,
      );
    },
  );
  await t.test(
    "bookmarks reflect updated salary visibility immediately",
    async () => {
      assert.equal(
        (await call("/jobs/" + job + "/bookmark", "POST", null, owner.token))
          .code,
        403,
      );
      assert.equal(
        (await call("/bookmarks", "GET", null, owner.token)).code,
        403,
      );
      assert.equal(
        (
          await call(
            "/jobs/" + job + "/bookmark",
            "POST",
            null,
            candidate.token,
          )
        ).code,
        201,
      );
      assert.equal(
        (
          await call(
            "/jobs/" + job + "/bookmark",
            "POST",
            null,
            candidate.token,
          )
        ).code,
        400,
      );
      assert.equal(
        (await call("/bookmarks", "GET", null, candidate.token)).body.data
          .bookmarks[0].salary_min,
        null,
      );
      assert.equal(
        (await call("/profile/bookmarks", "GET", null, candidate.token)).body
          .data.bookmarks[0].salary_min,
        null,
      );
      await call(
        "/jobs/" + job,
        "PUT",
        { is_salary_visible: true },
        owner.token,
      );
      assert.equal(
        (await call("/bookmarks", "GET", null, candidate.token)).body.data
          .bookmarks[0].salary_min,
        6000000,
      );
      assert.equal(
        (await call("/profile/bookmarks", "GET", null, candidate.token)).body
          .data.bookmarks[0].salary_min,
        6000000,
      );
      await call(
        "/jobs/" + job,
        "PUT",
        { is_salary_visible: false },
        owner.token,
      );
      assert.equal(
        (await call("/bookmarks", "GET", null, candidate.token)).body.data
          .bookmarks[0].salary_min,
        null,
      );
      assert.equal(
        (await call("/profile/bookmarks", "GET", null, candidate.token)).body
          .data.bookmarks[0].salary_min,
        null,
      );
      assert.equal(
        (await call("/bookmarks", "GET", null, stranger.token)).body.data
          .bookmarks.length,
        0,
      );
    },
  );
  const fixture = await require("pdf-lib").PDFDocument.create();
  fixture.addPage().drawText("OpenJob test CV");
  const validPdf = await fixture.save();
  const upload = async (
    content,
    name = "cv.pdf",
    mime = "application/pdf",
    token = candidate.token,
  ) => {
    const form = new FormData();
    form.append("document", new Blob([content], { type: mime }), name);
    return call("/documents", "POST", form, token);
  };
  await t.test(
    "PDF uploads enforce login, content, MIME and size; documents are private",
    async () => {
      assert.equal(
        (await upload(validPdf, "cv.pdf", "application/pdf", owner.token)).code,
        403,
      );
      assert.equal(
        (await call("/documents", "GET", null, owner.token)).code,
        403,
      );
      assert.equal(
        (await upload("%PDF-1.4", "cv.pdf", "application/pdf", null)).code,
        401,
      );
      assert.equal((await upload("fake pdf")).code, 400);
      assert.equal((await upload("hello", "note.txt", "text/plain")).code, 400);
      assert.equal(
        (await upload("%PDF-" + "x".repeat(5 * 1024 * 1024))).code,
        400,
      );
      assert.deepEqual(
        await require("fs/promises").readdir(sandbox.uploadDirectory),
        [],
      );
      const d = await upload(validPdf);
      assert.equal(d.code, 201);
      document = d.body.data.documentId;
      assert.equal((await call("/documents")).code, 401);
      assert.equal(
        (await call("/documents", "GET", null, stranger.token)).body.data
          .documents.length,
        0,
      );
      assert.equal(
        (await call("/documents/" + document, "GET", null, owner.token)).code,
        404,
      );
      assert.equal(
        (await call("/documents/" + document, "DELETE", null, stranger.token))
          .code,
        404,
      );
    },
  );

  await t.test(
    "upload failures leave no rows or files, and PDF structure is required",
    async () => {
      const fs = require("fs/promises");
      const before = (await fs.readdir(sandbox.uploadDirectory)).sort();
      const count = (
        await sandbox.pool.query("SELECT count(*)::int AS n FROM documents")
      ).rows[0].n;
      const validator = require.cache[require.resolve("../src/validatePdf")];
      const validate = validator.exports;
      validator.exports = async () => {
        throw Object.assign(Error("Timed out"), {
          code: "PDF_VALIDATION_TIMEOUT",
        });
      };
      try {
        const response = await upload(validPdf);
        assert.equal(response.code, 503);
        assert.match(response.body.message, /Coba unggah kembali/);
      } finally {
        validator.exports = validate;
      }
      for (const data of [
        "%PDF-not a document",
        "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF",
        validPdf.subarray(0, validPdf.length - 30),
      ]) {
        assert.equal((await upload(data)).code, 400);
      }
      const empty = await require("pdf-lib").PDFDocument.create();
      assert.equal(
        (await upload(await empty.save({ addDefaultPage: false }))).code,
        400,
      );
      const encrypted = await require("pdf-lib").PDFDocument.load(validPdf);
      encrypted.context.trailerInfo.Encrypt = encrypted.context.register(
        encrypted.context.obj({ Filter: "Standard" }),
      );
      assert.equal((await upload(await encrypted.save())).code, 400);
      const original = sandbox.pool.query;
      sandbox.pool.query = async (sql, ...args) => {
        if (sql.startsWith("INSERT INTO documents"))
          throw Error("Simulated database failure");
        return original(sql, ...args);
      };
      try {
        assert.equal((await upload(validPdf)).code, 500);
      } finally {
        sandbox.pool.query = original;
      }
      assert.deepEqual(
        (await fs.readdir(sandbox.uploadDirectory)).sort(),
        before,
      );
      assert.equal(
        (await sandbox.pool.query("SELECT count(*)::int AS n FROM documents"))
          .rows[0].n,
        count,
      );
    },
  );
  await t.test(
    "failed file deletion stays queued and retries successfully",
    async () => {
      const fs = require("fs/promises"),
        path = require("path");
      const uploaded = await upload(validPdf);
      assert.equal(uploaded.code, 201);
      const filename = uploaded.body.data.filename;
      const target = path.join(sandbox.uploadDirectory, filename);
      const unlink = fs.unlink;
      fs.unlink = async (p) => {
        if (p === target)
          throw Object.assign(Error("Simulated locked file"), {
            code: "EACCES",
          });
        return unlink(p);
      };
      try {
        assert.equal(
          (
            await call(
              "/documents/" + uploaded.body.data.documentId,
              "DELETE",
              null,
              candidate.token,
            )
          ).code,
          200,
        );
      } finally {
        fs.unlink = unlink;
      }
      assert.equal(
        (
          await sandbox.pool.query(
            "SELECT filename FROM document_file_cleanup WHERE filename=$1",
            [filename],
          )
        ).rowCount,
        1,
      );
      await fs.access(target);
      await require("../src/documentCleanup").cleanup();
      await assert.rejects(fs.access(target), (e) => e.code === "ENOENT");
      assert.equal(
        (
          await sandbox.pool.query(
            "SELECT filename FROM document_file_cleanup WHERE filename=$1",
            [filename],
          )
        ).rowCount,
        0,
      );
    },
  );
  await t.test(
    "legacy onsite data migration preserves jobs and enables canonical filtering",
    async () => {
      await sandbox.pool.query(
        "UPDATE jobs SET location_type='onsite' WHERE id=$1",
        [job],
      );
      const migration = require("../migrations/1793000000000_document_cleanup");
      let sql;
      migration.up({
        sql: (s) => {
          sql = s;
        },
      });
      // Replay only the data transformation against an existing legacy record.
      await sandbox.pool.query(sql.slice(0, sql.indexOf("CREATE TABLE")));
      const results = await call("/jobs?location_type=on-site");
      assert.ok(results.body.data.jobs.some((j) => j.id === job));
      await sandbox.pool.query("UPDATE jobs SET location_type=$1 WHERE id=$2", [
        "hybrid",
        job,
      ]);
    },
  );
  await t.test("application requires an owned CV and an open job", async () => {
    assert.equal(
      (await call("/applications", "POST", { job_id: job }, candidate.token))
        .code,
      400,
    );
    assert.equal(
      (
        await call(
          "/applications",
          "POST",
          { job_id: job, document_id: document },
          stranger.token,
        )
      ).code,
      403,
    );
    await call("/jobs/" + job, "PUT", { status: "close" }, owner.token);
    assert.equal(
      (
        await call(
          "/applications",
          "POST",
          { job_id: job, document_id: document },
          candidate.token,
        )
      ).code,
      409,
    );
    assert.equal((await call("/jobs")).body.data.pagination.total, 0);
    await call("/jobs/" + job, "PUT", { status: "open" }, owner.token);
    const r = await call(
      "/applications",
      "POST",
      { job_id: job, document_id: document, cover_letter: "Happy to join" },
      candidate.token,
    );
    assert.equal(r.code, 201);
    application = r.body.data.id;
    assert.equal(
      (
        await sandbox.pool.query(
          "SELECT * FROM application_outbox WHERE application_id=$1",
          [application],
        )
      ).rowCount,
      1,
    );
    assert.equal(
      (
        await call(
          "/applications",
          "POST",
          { job_id: job, document_id: document },
          candidate.token,
        )
      ).code,
      409,
    );
    assert.equal(
      (await call("/documents/" + document, "DELETE", null, candidate.token))
        .code,
      409,
    );
    assert.equal(
      (await sandbox.pool.query("SELECT * FROM document_file_cleanup"))
        .rowCount,
      0,
    );
  });
  await t.test(
    "application lists and CVs are visible only to candidate and owning recruiter",
    async () => {
      assert.equal(
        (await call("/applications", "GET", null, other.token)).body.data
          .applications.length,
        0,
      );
      assert.equal(
        (
          await call(
            "/applications/" + application,
            "GET",
            null,
            stranger.token,
          )
        ).code,
        404,
      );
      assert.equal(
        (
          await call(
            "/applications/user/" + candidate.id,
            "GET",
            null,
            stranger.token,
          )
        ).code,
        403,
      );
      assert.equal(
        (await call("/applications/job/" + job, "GET", null, other.token)).code,
        403,
      );
      assert.equal(
        (await call("/applications/job/" + job, "GET", null, owner.token)).body
          .data.applications.length,
        1,
      );
      assert.equal(
        (await call("/profile/applications", "GET", null, candidate.token)).body
          .data.applications[0].document_id,
        document,
      );
      const pdf = await fetch(base + "/api/documents/" + document, {
        headers: { Authorization: "Bearer " + owner.token },
      });
      assert.equal(pdf.status, 200);
      assert.equal(pdf.headers.get("content-type"), "application/pdf");
      assert.equal(
        pdf.headers.get("content-disposition"),
        'attachment; filename="cv.pdf"',
      );
      assert.match(await pdf.text(), /^%PDF-/);
      assert.equal(
        (await call("/jobs/" + job, "DELETE", null, owner.token)).code,
        409,
      );
      assert.equal(
        (await call("/companies/" + company, "DELETE", null, owner.token)).code,
        409,
      );
      // Database restrictions also protect history independently of route checks.
      await assert.rejects(
        sandbox.pool.query("DELETE FROM jobs WHERE id=$1", [job]),
        (e) => ["23503", "23001"].includes(e.code),
      );
      await assert.rejects(
        sandbox.pool.query("DELETE FROM companies WHERE id=$1", [company]),
        (e) => ["23503", "23001"].includes(e.code),
      );
    },
  );
  await t.test(
    "recruitment status is owner-only, validated and final states are immutable",
    async () => {
      assert.equal(
        (
          await call(
            "/applications/" + application,
            "PUT",
            { status: "accepted" },
            candidate.token,
          )
        ).code,
        403,
      );
      assert.equal(
        (
          await call(
            "/applications/" + application,
            "PUT",
            { status: "accepted" },
            other.token,
          )
        ).code,
        409,
      );
      assert.equal(
        (
          await call(
            "/applications/" + application,
            "PUT",
            { status: "whatever" },
            owner.token,
          )
        ).code,
        400,
      );
      for (const s of ["reviewing", "interview", "accepted"]) {
        const changed = await call(
          "/applications/" + application,
          "PUT",
          { status: s },
          owner.token,
        );
        assert.equal(changed.code, 200);
        assert.equal(changed.body.data.changed, true);
        const before = (
          await sandbox.pool.query(
            "SELECT updated_at FROM applications WHERE id=$1",
            [application],
          )
        ).rows[0].updated_at;
        const duplicate = await call(
          "/applications/" + application,
          "PUT",
          { status: s },
          owner.token,
        );
        assert.equal(duplicate.code, 200);
        assert.equal(duplicate.body.data.changed, false);
        assert.equal(
          String(
            (
              await sandbox.pool.query(
                "SELECT updated_at FROM applications WHERE id=$1",
                [application],
              )
            ).rows[0].updated_at,
          ),
          String(before),
        );
      }
      const statusOutbox = await sandbox.pool.query(
        "SELECT status FROM application_status_outbox WHERE application_id=$1 ORDER BY created_at",
        [application],
      );
      assert.deepEqual(
        statusOutbox.rows.map((r) => r.status),
        ["reviewing", "interview", "accepted"],
      );
      assert.equal(
        (
          await call(
            "/applications/" + application,
            "PUT",
            { status: "reviewing" },
            owner.token,
          )
        ).code,
        409,
      );
      assert.equal(
        (
          await call(
            "/applications/" + application,
            "DELETE",
            null,
            candidate.token,
          )
        ).code,
        409,
      );
    },
  );
  await t.test(
    "withdrawal retains history and removes recruiter CV access for that application",
    async () => {
      const second = await call(
        "/jobs",
        "POST",
        { ...jobBody, title: "Second Job" },
        owner.token,
      );
      const doc = await upload(
        validPdf,
        "second.pdf",
        "application/pdf",
        stranger.token,
      );
      const apply = await call(
        "/applications",
        "POST",
        { job_id: second.body.data.id, document_id: doc.body.data.documentId },
        stranger.token,
      );
      assert.equal(apply.code, 201);
      assert.equal(
        (
          await call(
            "/applications/" + apply.body.data.id,
            "DELETE",
            null,
            candidate.token,
          )
        ).code,
        409,
      );
      assert.equal(
        (
          await call(
            "/applications/" + apply.body.data.id,
            "DELETE",
            null,
            stranger.token,
          )
        ).code,
        200,
      );
      assert.equal(
        (
          await call(
            "/applications/" + apply.body.data.id,
            "GET",
            null,
            stranger.token,
          )
        ).body.data.status,
        "withdrawn",
      );
      assert.equal(
        (
          await call(
            "/documents/" + doc.body.data.documentId,
            "GET",
            null,
            owner.token,
          )
        ).code,
        404,
      );
      assert.equal(
        (
          await call(
            "/applications",
            "POST",
            {
              job_id: second.body.data.id,
              document_id: doc.body.data.documentId,
            },
            stranger.token,
          )
        ).code,
        409,
      );
    },
  );
  await t.test(
    "unused documents can be deleted and removed from disk",
    async () => {
      const d = await upload(validPdf, "unused.pdf");
      assert.equal(
        (
          await call(
            "/documents/" + d.body.data.documentId,
            "DELETE",
            null,
            candidate.token,
          )
        ).code,
        200,
      );
      assert.equal(
        (
          await call(
            "/documents/" + d.body.data.documentId,
            "GET",
            null,
            candidate.token,
          )
        ).code,
        404,
      );
    },
  );
  await t.test(
    "profile updates stay private and refresh tokens cannot be logged out by another account",
    async () => {
      assert.equal(
        (
          await call(
            "/users/" + candidate.id,
            "PUT",
            { name: "Changed" },
            stranger.token,
          )
        ).code,
        403,
      );
      assert.equal(
        (
          await call(
            "/users/" + candidate.id,
            "PUT",
            { name: "Candidate Updated" },
            candidate.token,
          )
        ).code,
        200,
      );
      assert.equal(
        (await call("/profile", "GET", null, candidate.token)).body.data.name,
        "Candidate Updated",
      );
      assert.equal(
        (
          await call(
            "/authentications",
            "DELETE",
            { refreshToken: candidate.refresh },
            stranger.token,
          )
        ).code,
        400,
      );
      const rotated = await call("/authentications", "PUT", {
        refreshToken: candidate.refresh,
      });
      assert.equal(rotated.code, 200);
      assert.equal(
        (
          await call("/authentications", "PUT", {
            refreshToken: candidate.refresh,
          })
        ).code,
        400,
      );
      candidate.refresh = rotated.body.data.refreshToken;
      assert.equal(
        (
          await call(
            "/authentications",
            "DELETE",
            { refreshToken: candidate.refresh },
            candidate.token,
          )
        ).code,
        200,
      );
      assert.equal(
        (
          await call("/authentications", "PUT", {
            refreshToken: candidate.refresh,
          })
        ).code,
        400,
      );
    },
  );
  await t.test(
    "security: password changes revoke every session and enforce byte limits",
    async () => {
      const account = await user("Security");
      const second = await call("/authentications", "POST", {
        email: account.email.toUpperCase(),
        password: account.password,
      });
      assert.equal(second.code, 200);
      assert.equal(
        (
          await call("/users", "POST", {
            name: "Duplicate",
            email: account.email.toUpperCase(),
            password: account.password,
          })
        ).code,
        400,
      );
      assert.equal(
        (
          await call("/users", "POST", {
            name: "Long",
            email: "long@example.com",
            password: "a".repeat(73),
          })
        ).code,
        400,
      );
      assert.equal(
        (
          await call("/users", "POST", {
            name: "Unicode",
            email: "unicode@example.com",
            password: "界".repeat(25),
          })
        ).code,
        400,
      );
      assert.equal(
        (
          await call(
            "/users/" + account.id,
            "PUT",
            { password: "ChangedPassword123" },
            account.token,
          )
        ).code,
        400,
      );
      assert.equal(
        (
          await call(
            "/users/" + account.id,
            "PUT",
            { password: "ChangedPassword123", current_password: "wrong" },
            account.token,
          )
        ).code,
        400,
      );
      assert.equal(
        (
          await call(
            "/users/" + account.id,
            "PUT",
            {
              password: "ChangedPassword123",
              current_password: account.password,
            },
            account.token,
          )
        ).code,
        200,
      );
      for (const token of [account.token, second.body.data.accessToken]) {
        for (const path of [
          "/profile",
          "/profile/bookmarks",
          "/users/" + account.id,
        ])
          assert.equal((await call(path, "GET", null, token)).code, 401);
      }
      for (const refreshToken of [
        account.refresh,
        second.body.data.refreshToken,
      ])
        assert.equal(
          (await call("/authentications", "PUT", { refreshToken })).code,
          400,
        );
      assert.equal(
        (
          await call("/authentications", "POST", {
            email: account.email,
            password: account.password,
          })
        ).code,
        401,
      );
      const fresh = await call("/authentications", "POST", {
        email: account.email,
        password: "ChangedPassword123",
      });
      assert.equal(fresh.code, 200);
      const jwt = require("jsonwebtoken");
      const payload = jwt.decode(fresh.body.data.accessToken);
      const expired = jwt.sign(
        { id: payload.id, sid: payload.sid },
        process.env.ACCESS_TOKEN_KEY,
        { expiresIn: -1 },
      );
      assert.ok(jwt.decode(fresh.body.data.refreshToken).exp);
      assert.equal(
        (
          await call(
            "/authentications",
            "DELETE",
            { refreshToken: fresh.body.data.refreshToken },
            expired,
          )
        ).code,
        200,
      );
      assert.equal(
        (await call("/profile", "GET", null, fresh.body.data.accessToken)).code,
        401,
      );
      const stored = await sandbox.pool.query(
        "SELECT refresh_hash FROM auth_sessions",
      );
      assert.ok(
        stored.rows.every((r) => /^[a-f0-9]{64}$/.test(r.refresh_hash)),
      );
    },
  );
  await t.test(
    "application pagination is stable, filtered, private and summaries cover all pages",
    async () => {
      const baseline = (
        await call("/applications?limit=1", "GET", null, owner.token)
      ).body.data.summary;
      for (let i = 0; i < 25; i++) {
        const id = "pagination-user-" + i,
          doc = "pagination-doc-" + i;
        await sandbox.pool.query(
          "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
          [
            id,
            "Pagination Applicant " + i,
            id + "@example.com",
            "unused-test-hash",
            "user",
          ],
        );
        await sandbox.pool.query(
          "INSERT INTO documents(id,user_id,filename,original_name,mime_type,size) VALUES($1,$2,$3,$4,$5,$6)",
          [doc, id, doc + ".pdf", "test.pdf", "application/pdf", 100],
        );
        await sandbox.pool.query(
          "INSERT INTO applications(id,user_id,job_id,document_id,status,created_at) VALUES($1,$2,$3,$4,$5,'2026-01-01T00:00:00Z')",
          [
            "pagination-application-" + String(i).padStart(2, "0"),
            id,
            job,
            doc,
            i < 22 ? "pending" : "reviewing",
          ],
        );
      }
      const url = "/applications?job_id=" + job + "&status=pending&limit=20";
      const first = await call(url, "GET", null, owner.token),
        second = await call(url + "&page=2", "GET", null, owner.token);
      assert.equal(first.code, 200);
      assert.equal(first.body.data.applications.length, 20);
      assert.equal(second.body.data.applications.length, 2);
      assert.deepEqual(first.body.data.pagination, {
        page: 1,
        limit: 20,
        total: 22,
        pages: 2,
      });
      assert.equal(first.body.data.summary.total, baseline.total + 25);
      assert.equal(first.body.data.summary.pending, baseline.pending + 22);
      const ids = [
        ...first.body.data.applications,
        ...second.body.data.applications,
      ].map((x) => x.id);
      assert.equal(new Set(ids).size, 22);
      assert.deepEqual(
        (await call(url, "GET", null, owner.token)).body.data.applications.map(
          (x) => x.id,
        ),
        first.body.data.applications.map((x) => x.id),
      );
      assert.equal(
        (await call(url + "&page=3", "GET", null, owner.token)).body.data
          .applications.length,
        0,
      );
      const outsider = await call(url, "GET", null, other.token);
      assert.equal(outsider.body.data.pagination.total, 0);
      assert.equal(outsider.body.data.summary.total, 0);
      const candidateLogin = await call("/authentications", "POST", {
        email: candidate.email,
        password: candidate.password,
      });
      assert.equal(candidateLogin.code, 200);
      const candidateList = await call(
        "/applications?limit=1",
        "GET",
        null,
        candidateLogin.body.data.accessToken,
      );
      assert.ok(
        candidateList.body.data.applications.every(
          (x) => x.user_id === candidate.id,
        ),
      );
      assert.equal(candidateList.body.data.summary.total, 1);
      for (const query of [
        "page=0",
        "limit=51",
        "page=no",
        "status=unknown",
        "job_id[x]=bad",
      ])
        assert.equal(
          (await call("/applications?" + query, "GET", null, owner.token)).code,
          400,
        );
      assert.equal(
        (
          await call(
            "/applications/job/" + job + "?limit=1",
            "GET",
            null,
            other.token,
          )
        ).code,
        403,
      );
    },
  );
});
