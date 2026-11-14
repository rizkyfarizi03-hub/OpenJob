// Uji ujung ke ujung mode Vercel: build, api/index.js, PostgreSQL (PGlite lewat
// protokol jaringan Postgres), dan server SMTP tiruan. Tidak menghubungi layanan luar.
// Jalankan dari folder utama: npm run test:vercel (butuh npm ci di openjob_api dan openjob_consumer).
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const { randomBytes } = require("node:crypto");
const { SMTPServer } = require("smtp-server");
const root = path.resolve(__dirname, "..");
const apiRequire = require("node:module").createRequire(
  path.join(root, "openjob_api/package.json"),
);
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
// Proses build dijalankan async agar server database di proses ini tetap melayani.
const run = (args, env) =>
  execFile("node", args, { cwd: root, env }).then(
    (r) => ({ status: 0, stdout: r.stdout, stderr: r.stderr }),
    (e) => ({
      status: e.code || 1,
      stdout: e.stdout || "",
      stderr: e.stderr || "",
    }),
  );
const mails = [];
let n = 0;
const ok = (m) => console.log("ok", ++n, m);
(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const port = await freePort();
  const database = new PGLiteSocketServer({
    db: await PGlite.create(),
    port,
    host: "127.0.0.1",
    maxConnections: 20,
  });
  await database.start();
  const smtpPort = await freePort();
  const smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    logger: false,
    onAuth: (a, s, cb) => cb(null, { user: a.username }),
    onData(stream, session, cb) {
      let raw = "";
      stream.on("data", (c) => (raw += c));
      stream.on("end", () => {
        mails.push({ to: session.envelope.rcptTo.map((r) => r.address), raw });
        cb();
      });
    },
  });
  await new Promise((r) => smtp.listen(smtpPort, "127.0.0.1", r));
  const env = {
    ...process.env,
    DATABASE_URL:
      "postgres://postgres:postgres@127.0.0.1:" + port + "/postgres",
    OPENJOB_PUBLIC_DEMO: "1",
    ACCESS_TOKEN_KEY: randomBytes(32).toString("hex"),
    REFRESH_TOKEN_KEY: randomBytes(32).toString("hex"),
    PASSWORD_RESET_KEY: randomBytes(32).toString("hex"),
    WEB_BASE_URL: "https://openjob-demo.vercel.app",
    MAIL_HOST: "127.0.0.1",
    MAIL_PORT: String(smtpPort),
    MAIL_USER: "u",
    MAIL_PASSWORD: "p",
    MAIL_FROM: "OpenJob <noreply@openjob-demo.dev>",
  };
  // Build: migrations and demo data, twice to prove it is repeatable.
  for (let i = 0; i < 2; i++) {
    const build = await run(["vercel/build.cjs"], env);
    assert.equal(build.status, 0, build.stderr);
    if (i === 0) assert.match(build.stdout, /Data contoh dibuat/);
    else assert.doesNotMatch(build.stdout, /Data contoh dibuat/);
  }
  // Vercel menolak folder keluaran kosong.
  assert.deepEqual(
    require("node:fs").readdirSync(path.join(root, "vercel/public")),
    ["robots.txt"],
  );
  const noDb = await run(["vercel/build.cjs"], { ...env, DATABASE_URL: "" });
  assert.notEqual(noDb.status, 0);
  assert.match(noDb.stderr, /DATABASE_URL belum diatur/);
  ok("build runs migrations, seeds once, fails clearly without DATABASE_URL");

  // Missing configuration is reported by name, never by value.
  const probe = await run(
    [
      "-e",
      `
    const h=require('./api/index.js');
    const s=require('http').createServer(h).listen(0,async()=>{
      const r=await fetch('http://127.0.0.1:'+s.address().port+'/');
      console.log(r.status+' '+await r.text()); process.exit(0);});`,
    ],
    { ...env, MAIL_HOST: "", WEB_BASE_URL: "" },
  );
  assert.match(probe.stdout, /^503 .*WEB_BASE_URL, MAIL_HOST$/m, probe.stderr);
  ok("missing settings return 503 naming the variables");

  // Tanpa pengaturan MAIL_ sama sekali: situs jalan, akun baru tidak dijadwalkan email.
  const noMail = await run(
    [
      "-e",
      `
    const h=require('./api/index.js');
    const s=require('http').createServer(h).listen(0,async()=>{
      const base='http://127.0.0.1:'+s.address().port;
      const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
      const health=await (await fetch(base+'/api/health')).json();
      const reg=await (await post('/api/users',{name:'Tanpa Email',email:'tanpa.email@openjob-demo.dev',password:'UjiOpenJob123!'})).json();
      const reset=await post('/api/password-resets',{email:'tanpa.email@openjob-demo.dev'});
      console.log(JSON.stringify({demo:health.demo,publicDemo:health.publicDemo,queued:reg.data.verificationQueued,reset:reset.status}));
      process.exit(0);});`,
    ],
    { ...env, MAIL_HOST: "", MAIL_PORT: "", MAIL_USER: "", MAIL_PASSWORD: "" },
  );
  assert.deepEqual(
    JSON.parse(noMail.stdout.trim().split("\n").pop()),
    {
      demo: true,
      publicDemo: true,
      queued: false,
      reset: 503,
    },
    noMail.stderr,
  );
  assert.equal(mails.length, 0);
  ok("without MAIL_ settings the site runs and no email is scheduled");

  Object.assign(process.env, env);
  const handler = require(path.join(root, "api/index.js"));
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const call = async (
    path,
    method = "GET",
    body,
    token,
    ip = "203.0.113.9",
  ) => {
    const headers = { "X-Forwarded-For": ip };
    if (token) headers.Authorization = "Bearer " + token;
    if (body && !(body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const r = await fetch(base + path, {
      method,
      headers,
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
    });
    const type = r.headers.get("content-type") || "";
    return {
      code: r.status,
      headers: r.headers,
      body: type.includes("json")
        ? await r.json()
        : Buffer.from(await r.arrayBuffer()),
    };
  };
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 50));
    await handler.drain();
  };
  const login = async (email, password = "DemoOpenJob123!") =>
    (await call("/api/authentications", "POST", { email, password })).body.data
      .accessToken;
  const db = new (apiRequire("pg").Pool)({
    connectionString: env.DATABASE_URL,
    max: 1,
  });
  const count = async (sql) => (await db.query(sql)).rows[0].n;

  assert.equal((await call("/")).code, 200);
  for (const a of [
    "/assets/app.js",
    "/assets/styles.css",
    "/assets/fonts/inter-latin-wght-normal.woff2",
  ])
    assert.equal((await call(a)).code, 200, a);
  const health = (await call("/api/health")).body;
  assert.equal(health.publicDemo, true);
  assert.equal(health.demo, false);
  assert.equal((await call("/api/jobs")).body.data.pagination.total, 9);
  ok("site, assets, health and seeded jobs are served");

  const employer = await login("perekrut@example.com");
  const locked = await call(
    "/api/users/demo-employer",
    "PUT",
    { password: "BaruSekali123!", current_password: "DemoOpenJob123!" },
    employer,
  );
  assert.equal(locked.code, 403);
  assert.equal(
    (
      await call(
        "/api/users/demo-employer",
        "PUT",
        { name: "Arif P." },
        employer,
      )
    ).code,
    200,
  );
  assert.ok(await login("perekrut@example.com"));
  ok("demo account email/password are locked, name still editable");

  const email = "rizky.uji@openjob-demo.dev",
    password = "UjiOpenJob123!";
  const reg = await call("/api/users", "POST", {
    name: "Rizky Uji",
    email,
    password,
  });
  assert.equal(reg.code, 201);
  assert.equal(reg.body.data.verificationQueued, true);
  await settle();
  const verifyMail = mails.find((m) => m.to.includes(email));
  assert.ok(verifyMail, "verification email sent");
  const text = verifyMail.raw.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
  const link = text.match(
    /https:\/\/openjob-demo\.vercel\.app\/#\/verify-email\?token=([a-f0-9-]+\.[a-f0-9]{64})/,
  );
  assert.ok(link, "link uses WEB_BASE_URL");
  assert.equal(
    (await call("/api/email-verifications/confirm", "POST", { token: link[1] }))
      .code,
    200,
  );
  const candidate = await login(email, password);
  assert.ok(
    (await call("/api/profile", "GET", null, candidate)).body.data
      .email_verified_at,
  );
  ok(
    "registration sends a real verification email whose link verifies the account",
  );

  const pdf = await apiRequire("pdf-lib").PDFDocument.create();
  pdf.addPage().drawText("CV Rizky");
  const bytes = Buffer.from(await pdf.save());
  const upload = async () => {
    const form = new FormData();
    form.append(
      "document",
      new Blob([bytes], { type: "application/pdf" }),
      "CV-Rizky.pdf",
    );
    return call("/api/documents", "POST", form, candidate);
  };
  const doc = (await upload()).body.data.documentId;
  assert.ok(doc);
  assert.equal(await count("SELECT count(*)::int AS n FROM document_files"), 1);
  const spare = (await upload()).body.data.documentId;
  assert.equal(await count("SELECT count(*)::int AS n FROM document_files"), 2);
  assert.equal(
    (await call("/api/documents/" + spare, "DELETE", null, candidate)).code,
    200,
  );
  assert.equal(await count("SELECT count(*)::int AS n FROM document_files"), 1);
  ok("CVs are stored in and removed from the database");

  const before = mails.length;
  const app = await call(
    "/api/applications",
    "POST",
    { job_id: "demo-job-1", document_id: doc },
    candidate,
  );
  assert.equal(app.code, 201);
  await settle();
  assert.equal(mails.length, before, "no mail to perekrut@example.com");
  assert.equal(
    await count(
      "SELECT count(*)::int AS n FROM application_outbox WHERE notified_at IS NOT NULL",
    ),
    1,
  );
  const download = await call("/api/documents/" + doc, "GET", null, employer);
  assert.equal(download.code, 200);
  assert.equal(download.headers.get("content-type"), "application/pdf");
  assert.deepEqual(download.body, bytes);
  assert.equal(
    (
      await call(
        "/api/applications/" + app.body.data.id,
        "PUT",
        { status: "interview" },
        employer,
      )
    ).code,
    200,
  );
  await settle();
  const statusMail = mails.slice(before).find((m) => m.to.includes(email));
  assert.ok(
    statusMail && /Wawancara/.test(statusMail.raw.replace(/=\r?\n/g, "")),
    "status email",
  );
  const history = (
    await call("/api/applications/" + app.body.data.id, "GET", null, candidate)
  ).body.data.history.map((h) => h.status);
  assert.deepEqual(history, ["pending", "interview"]);
  ok(
    "applying, recruiter CV download and status email work; example.com is never mailed",
  );

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const lf = new FormData();
  lf.append("logo", new Blob([png], { type: "image/png" }), "logo.png");
  assert.equal(
    (await call("/api/companies/orbit-labs/logo", "PUT", lf, employer)).code,
    200,
  );
  assert.deepEqual((await call("/api/companies/orbit-labs/logo")).body, png);
  ok("company logo is stored and served from PostgreSQL");

  const resetBefore = mails.length;
  assert.equal(
    (await call("/api/password-resets", "POST", { email })).code,
    202,
  );
  await settle();
  const reset = mails.slice(resetBefore).find((m) => m.to.includes(email));
  assert.ok(
    reset &&
      /#\/reset-password\?token=/.test(
        reset.raw.replace(/=\r?\n/g, "").replace(/=3D/g, "="),
      ),
  );
  ok("password reset email is sent");

  // Registration limit is per visitor IP (X-Forwarded-For behind Vercel).
  let blocked;
  for (let i = 0; i < 11; i++)
    blocked = await call(
      "/api/users",
      "POST",
      { name: "Spam", email: "spam" + i + "@example.com", password },
      null,
      "198.51.100.7",
    );
  assert.equal(blocked.code, 429);
  assert.equal(
    (
      await call(
        "/api/users",
        "POST",
        { name: "Lain", email: "lain@example.com", password },
        null,
        "198.51.100.8",
      )
    ).code,
    201,
  );
  ok("registration is rate limited per visitor");

  // SMTP outage: the request still succeeds and the email is scheduled for retry.
  await new Promise((r) => smtp.close(r));
  const late = "tertunda@openjob-demo.dev";
  assert.equal(
    (
      await call(
        "/api/users",
        "POST",
        { name: "Tertunda", email: late, password },
        null,
        "192.0.2.4",
      )
    ).code,
    201,
  );
  await settle();
  const row = (
    await db.query(
      "SELECT failure_count, notified_at, next_attempt_at > NOW() AS later FROM email_verification_requests WHERE email=$1",
      [late],
    )
  ).rows[0];
  assert.equal(row.failure_count, 1);
  assert.equal(row.notified_at, null);
  assert.equal(row.later, true);
  ok("SMTP failure does not break registration; email is retried later");

  console.log("ALL VERCEL CHECKS PASSED");
  server.close();
  await db.end();
  await database.stop();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.stack);
  process.exit(1);
});
