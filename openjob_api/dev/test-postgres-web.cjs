// Exercises the running persistent QA website and real local workers over HTTP.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const base = process.env.OPENJOB_SMOKE_BASE_URL || "http://127.0.0.1:3101";
if (!["http://127.0.0.1:3101", "http://127.0.0.1:3102"].includes(base))
  throw Error("Smoke tests are limited to local QA ports");
async function call(route, method = "GET", body, token) {
  const response = await fetch(base + "/api" + route, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return { code: response.status, body: await response.json() };
}
async function mail(email, subject) {
  const until = Date.now() + 25000;
  while (Date.now() < until) {
    const inbox = await fetch("http://127.0.0.1:8025/api/v1/messages").then(
      (r) => r.json(),
    );
    const found = inbox.messages.find(
      (m) =>
        m.To?.some((to) => to.Address === email) &&
        (!subject || m.Subject === subject),
    );
    if (found)
      return fetch("http://127.0.0.1:8025/api/v1/message/" + found.ID).then(
        (r) => r.json(),
      );
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw Error("Local email not received: " + subject);
}
async function account(tag, role) {
  const email = role + "-" + tag + "@example.com",
    password = "PersistentQa123!";
  assert.equal(
    (
      await call("/users", "POST", {
        name: "QA " + role,
        email,
        password,
        role,
      })
    ).code,
    201,
  );
  const login = await call("/authentications", "POST", { email, password });
  assert.equal(login.code, 200);
  const token = login.body.data.accessToken;
  assert.equal(
    (await call("/profile", "GET", null, token)).body.data.email_verified_at,
    null,
  );
  const message = await mail(email, "Verifikasi email akun OpenJob");
  const link = new URL(message.Text.match(/http[^\s]+/)[0]);
  assert.equal(link.origin, base);
  const verificationToken = new URLSearchParams(link.hash.split("?")[1]).get(
    "token",
  );
  assert.equal(
    (
      await call("/email-verifications/confirm", "POST", {
        token: verificationToken,
      })
    ).code,
    200,
  );
  return { email, token };
}
(async () => {
  const health = await call("/health");
  assert.equal(health.body.localQa, base.endsWith(":3101"));
  assert.equal(health.body.demo, false);
  const manifest = path.resolve(
    __dirname,
    base.endsWith(":3101")
      ? "../.qa-postgres/web-smoke.json"
      : "../.qa-postgres/normal-start-smoke.json",
  );
  if (process.argv[2] === "--check") {
    const saved = JSON.parse(await fs.readFile(manifest, "utf8"));
    const login = await call("/authentications", "POST", {
      email: saved.email,
      password: "PersistentQa123!",
    });
    assert.equal(login.code, 200);
    const token = login.body.data.accessToken;
    const applications = await call("/applications", "GET", null, token);
    assert.ok(
      applications.body.data.applications.some(
        (a) => a.id === saved.application && a.status === "reviewing",
      ),
    );
    const pdf = await fetch(base + "/api/documents/" + saved.document, {
      headers: { Authorization: "Bearer " + token },
    });
    assert.equal(pdf.status, 200);
    assert.match(await pdf.text(), /^%PDF-/);
    console.log(
      "PERSISTENT_WEBSITE_RESTART_PASS: login, application status and CV survived",
    );
    return;
  }
  const tag = randomUUID(),
    employer = await account(tag, "employer"),
    candidate = await account(tag, "user");
  const company = await call(
    "/companies",
    "POST",
    {
      name: "Perusahaan Uji Persisten " + tag.slice(0, 8),
      location: "Jakarta",
      description: "Data buatan untuk pengujian lokal.",
    },
    employer.token,
  );
  assert.equal(company.code, 201);
  const job = await call(
    "/jobs",
    "POST",
    {
      company_id: company.body.data.id,
      category_id: "category-technology",
      title: "Posisi Uji Persisten",
      description: "Lowongan buatan untuk pengujian.",
      job_type: "full-time",
      experience_level: "junior",
      location_type: "remote",
      location_city: "Jakarta",
      status: "open",
    },
    employer.token,
  );
  assert.equal(job.code, 201);
  const pdf = await require("pdf-lib").PDFDocument.create();
  pdf.addPage().drawText("Fictional CV for local QA only");
  const form = new FormData();
  form.append(
    "document",
    new Blob([await pdf.save()], { type: "application/pdf" }),
    "cv-qa.pdf",
  );
  const document = await call("/documents", "POST", form, candidate.token);
  assert.equal(document.code, 201);
  const application = await call(
    "/applications",
    "POST",
    {
      job_id: job.body.data.id,
      document_id: document.body.data.documentId,
      cover_letter: "Lamaran buatan untuk pengujian.",
    },
    candidate.token,
  );
  assert.equal(application.code, 201);
  await mail(employer.email, "Lamaran baru: Posisi Uji Persisten");
  assert.equal(
    (
      await call(
        "/applications/" + application.body.data.id,
        "PUT",
        { status: "reviewing" },
        employer.token,
      )
    ).code,
    200,
  );
  const statusMail = await mail(
    candidate.email,
    "Pembaruan status lamaran: Posisi Uji Persisten",
  );
  assert.ok(statusMail.Text);
  await fs.writeFile(
    manifest,
    JSON.stringify({
      email: candidate.email,
      application: application.body.data.id,
      document: document.body.data.documentId,
    }),
  );
  console.log(
    "PERSISTENT_WEBSITE_SMOKE_PASS: registration, email verification, company, job, CV, application, review status and local email",
  );
})().catch((e) => {
  console.error("PERSISTENT_WEBSITE_SMOKE_FAILED", e.message);
  process.exitCode = 1;
});
