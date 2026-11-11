const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("../dev/sandbox.cjs");

// Fitur pencarian dan riwayat lamaran yang ditambahkan setelah versi website awal.
test("OpenJob fitur: filter gaji, urutan, dan riwayat lamaran", async (t) => {
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
    const email = name.toLowerCase() + "@example.com";
    const password = "TestOpenJob123!";
    const r = await call("/users", "POST", { name, email, password, role });
    assert.equal(r.code, 201);
    await sandbox.pool.query(
      "UPDATE users SET email_verified_at=NOW() WHERE id=$1",
      [r.body.data.id],
    );
    const login = await call("/authentications", "POST", { email, password });
    return { id: r.body.data.id, token: login.body.data.accessToken };
  }
  const owner = await user("Owner", "employer");
  const candidate = await user("Candidate");
  const company = (
    await call(
      "/companies",
      "POST",
      { name: "PT Uji", location: "Depok" },
      owner.token,
    )
  ).body.data.id;
  const job = async (title, min, max, visible) =>
    (
      await call(
        "/jobs",
        "POST",
        {
          company_id: company,
          category_id: "category-technology",
          title,
          description: "Deskripsi",
          job_type: "full-time",
          experience_level: "junior",
          location_type: "remote",
          salary_min: min,
          salary_max: max,
          is_salary_visible: visible,
        },
        owner.token,
      )
    ).body.data.id;
  const low = await job("Rendah", 3000000, 4000000, true);
  const high = await job("Tinggi", 9000000, 12000000, true);
  const hidden = await job("Rahasia", 20000000, 30000000, false);
  const ids = async (query) =>
    (await call("/jobs?" + query)).body.data.jobs.map((j) => j.id);

  await t.test(
    "filter gaji minimum hanya mencocokkan gaji yang ditampilkan",
    async () => {
      assert.deepEqual(await ids("min_salary=5000000"), [high]);
      assert.deepEqual(
        (await ids("min_salary=4000000")).sort(),
        [low, high].sort(),
      );
      // Lowongan bergaji tersembunyi tidak boleh bisa ditebak lewat filter.
      assert.deepEqual(await ids("min_salary=15000000"), []);
      assert.equal((await ids("")).length, 3);
    },
  );

  await t.test(
    "urutan gaji tertinggi menaruh gaji tersembunyi di akhir",
    async () => {
      assert.deepEqual(await ids("sort=salary"), [high, low, hidden]);
      const rows = (await call("/jobs?sort=salary")).body.data.jobs;
      assert.equal(rows[2].salary_max, null);
      assert.deepEqual(await ids("sort=newest"), [hidden, high, low]);
    },
  );

  await t.test(
    "detail lamaran memuat riwayat tahap secara berurutan",
    async () => {
      const pdf = await require("pdf-lib").PDFDocument.create();
      pdf.addPage().drawText("CV");
      const form = new FormData();
      form.append(
        "document",
        new Blob([await pdf.save()], { type: "application/pdf" }),
        "cv.pdf",
      );
      const upload = await call("/documents", "POST", form, candidate.token);
      assert.equal(upload.code, 201);
      const document = upload.body.data.id || upload.body.data.documentId;
      const created = await call(
        "/applications",
        "POST",
        { job_id: high, document_id: document },
        candidate.token,
      );
      assert.equal(created.code, 201);
      const id = created.body.data.id;
      const history = async (token) =>
        (
          await call("/applications/" + id, "GET", null, token)
        ).body.data.history.map((h) => h.status);
      assert.deepEqual(await history(candidate.token), ["pending"]);
      await call(
        "/applications/" + id,
        "PUT",
        { status: "reviewing" },
        owner.token,
      );
      await call(
        "/applications/" + id,
        "PUT",
        { status: "interview" },
        owner.token,
      );
      assert.deepEqual(await history(candidate.token), [
        "pending",
        "reviewing",
        "interview",
      ]);
      assert.deepEqual(await history(owner.token), [
        "pending",
        "reviewing",
        "interview",
      ]);
      await call("/applications/" + id, "DELETE", null, candidate.token);
      const detail = (
        await call("/applications/" + id, "GET", null, owner.token)
      ).body.data;
      assert.deepEqual(
        detail.history.map((h) => h.status),
        ["pending", "reviewing", "interview", "withdrawn"],
      );
      assert.ok(detail.history.every((h) => !Number.isNaN(Date.parse(h.at))));
      assert.equal((await call("/jobs/" + high)).body.data.applicant_count, 0);
    },
  );

  await t.test(
    "logo perusahaan: hanya pemilik, hanya gambar, tersaji publik",
    async () => {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      );
      const send = (bytes, token, type = "image/png", name = "logo.png") => {
        const form = new FormData();
        form.append("logo", new Blob([bytes], { type }), name);
        return call("/companies/" + company + "/logo", "PUT", form, token);
      };
      const logo = () => fetch(base + "/api/companies/" + company + "/logo");
      assert.equal((await logo()).status, 404);
      assert.equal(
        (await call("/companies/" + company)).body.data.logo_updated_at,
        null,
      );
      assert.equal((await send(png)).code, 401);
      assert.equal((await send(png, candidate.token)).code, 403);
      const stranger = await user("Stranger", "employer");
      assert.equal((await send(png, stranger.token)).code, 404);
      // Isi berkas yang menentukan, bukan nama atau tipe yang dikirim.
      assert.equal(
        (await send(Buffer.from("<svg onload=alert(1)>"), owner.token)).code,
        400,
      );
      assert.equal(
        (await send(Buffer.from("%PDF-1.4 bukan gambar"), owner.token)).code,
        400,
      );
      assert.equal(
        (
          await send(
            Buffer.concat([png, Buffer.alloc(600 * 1024)]),
            owner.token,
          )
        ).code,
        400,
      );
      assert.equal((await logo()).status, 404);
      const saved = await send(
        png,
        owner.token,
        "application/octet-stream",
        "apa-saja.bin",
      );
      assert.equal(saved.code, 200);
      const served = await logo();
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), "image/png");
      assert.equal(served.headers.get("x-content-type-options"), "nosniff");
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
      // Profil perusahaan yang ter-cache dan daftar lowongan ikut diperbarui.
      assert.ok(
        (await call("/companies/" + company)).body.data.logo_updated_at,
      );
      assert.ok(
        (await call("/jobs")).body.data.jobs[0].company_logo_updated_at,
      );
      assert.equal(
        (
          await call(
            "/companies/" + company + "/logo",
            "DELETE",
            null,
            stranger.token,
          )
        ).code,
        404,
      );
      assert.equal(
        (
          await call(
            "/companies/" + company + "/logo",
            "DELETE",
            null,
            owner.token,
          )
        ).code,
        200,
      );
      assert.equal((await logo()).status, 404);
      assert.equal(
        (await call("/companies/" + company)).body.data.logo_updated_at,
        null,
      );
    },
  );
});
