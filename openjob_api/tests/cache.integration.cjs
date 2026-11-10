const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("../dev/sandbox.cjs");

// Cache miss/hit dan invalidasi untuk enam endpoint yang di-cache, tanpa Redis sungguhan.
test("OpenJob cache: X-Data-Source, invalidasi, dan isolasi antar akun", async (t) => {
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
    const r = await fetch(base + path, {
      method,
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    return { code: r.status, source: r.headers.get("x-data-source"), body: await r.json() };
  }
  async function user(name, role = "user") {
    const email = name.toLowerCase() + "@example.com";
    const password = "TestOpenJob123!";
    const r = await call("/users", "POST", { name, email, password, role });
    assert.equal(r.code, 201);
    await sandbox.pool.query("UPDATE users SET email_verified_at=NOW() WHERE id=$1", [r.body.data.id]);
    const login = await call("/authentications", "POST", { email, password });
    return { id: r.body.data.id, token: login.body.data.accessToken };
  }
  // Request pertama dari database, request kedua dari cache dengan isi yang sama.
  async function missThenHit(path, token) {
    const first = await call(path, "GET", null, token);
    assert.equal(first.code, 200);
    assert.equal(first.source, "database", path + " pertama");
    const second = await call(path, "GET", null, token);
    assert.equal(second.source, "cache", path + " kedua");
    assert.deepEqual(second.body, first.body);
    return second.body;
  }
  const fromDatabase = async (path, token) => {
    const r = await call(path, "GET", null, token);
    assert.equal(r.source, "database", path + " setelah perubahan");
    return r.body;
  };

  const fromCache = async (path, token) => {
    const r = await call(path, "GET", null, token);
    assert.equal(r.source, "cache", path + " tanpa perubahan");
    return r.body;
  };

  const owner = await user("Owner", "employer");
  const candidate = await user("Candidate");
  const stranger = await user("Stranger");
  const company = (await call("/companies", "POST", { name: "Awal", location: "Jakarta" }, owner.token)).body.data.id;
  const job = (await call("/jobs", "POST", {
    company_id: company, category_id: "category-technology", title: "Backend", description: "Deskripsi",
    job_type: "full-time", experience_level: "junior", location_type: "remote",
    salary_min: 5000000, salary_max: 7000000, is_salary_visible: true,
  }, owner.token)).body.data.id;
  const pdf = await require("pdf-lib").PDFDocument.create();
  pdf.addPage().drawText("CV");
  const form = new FormData();
  form.append("document", new Blob([await pdf.save()], { type: "application/pdf" }), "cv.pdf");
  const upload = await call("/documents", "POST", form, candidate.token);
  assert.equal(upload.code, 201);
  const document = upload.body.data.id || upload.body.data.documentId;
  let application;

  await t.test("company: miss, hit, lalu invalidasi saat diubah atau dihapus", async () => {
    await missThenHit("/companies/" + company);
    await call("/companies/" + company, "PUT", { name: "Baru" }, owner.token);
    assert.equal((await fromDatabase("/companies/" + company)).data.name, "Baru");
    const missing = await call("/companies/tidak-ada");
    assert.equal(missing.code, 404);
    assert.equal(missing.source, null);
    const spare = (await call("/companies", "POST", { name: "Sementara", location: "Bandung" }, owner.token)).body.data.id;
    await missThenHit("/companies/" + spare);
    await call("/companies/" + spare, "DELETE", null, owner.token);
    assert.equal((await call("/companies/" + spare)).code, 404);
  });

  await t.test("user: hanya milik sendiri, invalidasi saat profil berubah", async () => {
    await missThenHit("/users/" + candidate.id, candidate.token);
    assert.equal((await call("/users/" + candidate.id, "GET", null, stranger.token)).code, 403);
    await call("/users/" + candidate.id, "PUT", { name: "Kandidat Baru" }, candidate.token);
    assert.equal((await fromDatabase("/users/" + candidate.id, candidate.token)).data.name, "Kandidat Baru");
  });

  await t.test("applications: daftar per user dan per job ter-invalidasi saat lamaran dibuat", async () => {
    assert.equal((await missThenHit("/applications/user/" + candidate.id, candidate.token)).data.applications.length, 0);
    assert.equal((await missThenHit("/applications/job/" + job, owner.token)).data.applications.length, 0);
    const created = await call("/applications", "POST", { job_id: job, document_id: document }, candidate.token);
    assert.equal(created.code, 201);
    application = created.body.data.id;
    assert.equal((await fromDatabase("/applications/user/" + candidate.id, candidate.token)).data.applications.length, 1);
    assert.equal((await fromDatabase("/applications/job/" + job, owner.token)).data.applications.length, 1);
    // Filter dan halaman berbeda tidak boleh berbagi entri cache.
    const filtered = await call("/applications/user/" + candidate.id + "?status=accepted", "GET", null, candidate.token);
    assert.equal(filtered.source, "database");
    assert.equal(filtered.body.data.applications.length, 0);
  });

  await t.test("application detail: invalidasi untuk pelamar dan perekrut, tertutup bagi akun lain", async () => {
    await missThenHit("/applications/" + application, candidate.token);
    await missThenHit("/applications/" + application, owner.token);
    assert.equal((await call("/applications/" + application, "GET", null, stranger.token)).code, 404);
    await call("/applications/" + application, "PUT", { status: "reviewing" }, owner.token);
    assert.equal((await fromDatabase("/applications/" + application, candidate.token)).data.status, "reviewing");
    assert.equal((await fromDatabase("/applications/" + application, owner.token)).data.status, "reviewing");
    // Data gabungan ikut segar: nama pelamar, judul lowongan, nama perusahaan.
    await fromCache("/applications/" + application, owner.token);
    await call("/users/" + candidate.id, "PUT", { name: "Nama Akhir" }, candidate.token);
    assert.equal((await fromDatabase("/applications/" + application, owner.token)).data.applicant_name, "Nama Akhir");
    await call("/jobs/" + job, "PUT", { title: "Backend Senior" }, owner.token);
    assert.equal((await fromDatabase("/applications/" + application, candidate.token)).data.title, "Backend Senior");
    await call("/companies/" + company, "PUT", { name: "Final" }, owner.token);
    assert.equal((await fromDatabase("/applications/" + application, candidate.token)).data.company_name, "Final");
    await call("/applications/" + application, "DELETE", null, candidate.token);
    assert.equal((await fromDatabase("/applications/" + application, owner.token)).data.status, "withdrawn");
  });

  await t.test("bookmarks: invalidasi saat disimpan, dihapus, atau gaji disembunyikan", async () => {
    assert.equal((await missThenHit("/bookmarks", candidate.token)).data.bookmarks.length, 0);
    await call("/jobs/" + job + "/bookmark", "POST", null, candidate.token);
    assert.equal((await fromDatabase("/bookmarks", candidate.token)).data.bookmarks[0].salary_min, 5000000);
    await fromCache("/bookmarks", candidate.token);
    await call("/jobs/" + job, "PUT", { is_salary_visible: false }, owner.token);
    assert.equal((await fromDatabase("/bookmarks", candidate.token)).data.bookmarks[0].salary_min, null);
    assert.equal((await missThenHit("/bookmarks", stranger.token)).data.bookmarks.length, 0);
    await call("/jobs/" + job + "/bookmark", "DELETE", null, candidate.token);
    assert.equal((await fromDatabase("/bookmarks", candidate.token)).data.bookmarks.length, 0);
  });

  await t.test("cache yang gagal tidak menggagalkan request", async () => {
    const cache = require("../src/cache");
    const original = { ...cache };
    cache.get = cache.set = cache.delete = async () => { throw Error("Redis mati"); };
    t.after(() => Object.assign(cache, original));
    const silenced = t.mock.method(console, "error", () => {});
    const r = await call("/companies/" + company);
    assert.equal(r.code, 200);
    assert.equal(r.source, "database");
    assert.equal((await call("/companies/" + company, "PUT", { name: "Tanpa Redis" }, owner.token)).code, 200);
    assert.equal((await call("/companies/" + company)).body.data.name, "Tanpa Redis");
    assert.ok(silenced.mock.callCount() >= 1);
  });
});
