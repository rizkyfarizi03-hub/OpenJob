// Uji alur frontend terhadap server demo dalam memori, memakai jsdom.
// Jalankan dari folder utama: npm run test:ui (butuh npm ci di openjob_api).
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
process.env.OPENJOB_DEMO = "1";
const { createSandbox, seed } = require("../../openjob_api/dev/sandbox.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const sb = await createSandbox();
  await seed(sb.pool);
  const app = require("../../openjob_api/src/server");
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const html = fs
    .readFileSync(path.resolve(__dirname, "../index.html"), "utf8")
    .replace(/<script[^>]*><\/script>/, "");
  const dom = new JSDOM(html, {
    url: base + "/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window,
    d = w.document;
  w.fetch = (u, o) => fetch(new URL(u, base), o);
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  w.scrollTo = () => {};
  const errors = [];
  w.addEventListener("error", (e) => errors.push(e.message));
  w.eval(fs.readFileSync(path.resolve(__dirname, "../assets/app.js"), "utf8"));
  const $ = (s) => d.querySelector(s),
    $$ = (s) => [...d.querySelectorAll(s)];
  const until = async (fn, what) => {
    for (let i = 0; i < 100; i++) {
      try {
        const v = fn();
        if (v) return v;
      } catch {}
      await sleep(50);
    }
    throw Error("timeout: " + what);
  };
  const go = async (hash) => {
    // Tandai isi lama agar kita menunggu sampai halaman baru benar-benar dirender.
    for (const el of $("#main").children) el.dataset.stale = "1";
    w.location.hash = hash;
    await until(
      () => !$("#main [data-stale]") && !$(".loading"),
      "route " + hash,
    );
  };
  const fill = (sel, v) => {
    const el = $(sel);
    el.value = v;
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
    return el;
  };
  const text = (s) => ($(s)?.textContent || "").replace(/\s+/g, " ").trim();
  const register = async (role, name) => {
    await go("#/register?role=" + role);
    fill("#name", name);
    fill("#email", name.toLowerCase().replace(/\W/g, "") + "@example.com");
    fill("#password", "TestOpenJob123!");
    $("[data-form=register]").requestSubmit();
    await until(
      () =>
        w.location.hash.startsWith(
          role === "employer" ? "#/employer" : "#/account",
        ) && !$(".loading"),
      "register " + role,
    );
    await sleep(200);
  };
  const logout = async () => {
    $("[data-action=logout]").click();
    await until(() => !$("[data-action=logout]"), "logout");
  };
  let n = 0;
  const ok = (m) => console.log("ok", ++n, m);

  await until(() => $(".hero") || $("#main h1"), "home");
  // 0. job age on cards and detail
  await sb.pool.query(
    "UPDATE jobs SET created_at=NOW()-INTERVAL '10 days' WHERE id='demo-job-1'",
  );
  await go("#/jobs");
  const cardFor = (title) =>
    $$(".job-card").find((c) => c.querySelector("h3").textContent === title);
  assert.ok(cardFor("Frontend Developer").textContent.includes("1 jam lalu"));
  assert.ok(cardFor("Frontend Developer").querySelector(".tag.new"));
  // Lowongan tertua berada di halaman kedua.
  await go("#/jobs?page=2");
  assert.ok(cardFor("Product Designer").textContent.includes("1 minggu lalu"));
  assert.equal(cardFor("Product Designer").querySelector(".tag.new"), null);
  // Logo perusahaan menggantikan inisial pada kartu.
  await sb.pool.query(
    "UPDATE companies SET logo_updated_at=NOW() WHERE id='nusa-digital'",
  );
  await go("#/jobs?title=Frontend");
  assert.match(
    $(".job-card img.company-avatar.logo").getAttribute("src"),
    /^\/api\/companies\/nusa-digital\/logo\?v=\d+$/,
  );
  await go("#/jobs?title=Backend");
  assert.equal($(".job-card img.company-avatar"), null);
  assert.ok($(".job-card div.company-avatar"));
  // Filter waktu tayang dan jumlah pelamar.
  await go("#/jobs?posted=7");
  assert.ok(text(".results-head").startsWith("8 lowongan"));
  assert.equal($("#posted").value, "7");
  await go("#/jobs/demo-job-1");
  assert.equal(
    text(".applicant-count"),
    "Belum ada pelamar. Jadilah yang pertama.",
  );
  assert.ok(text(".detail-summary").includes("1 minggu lalu ·"));
  ok("job age and new badge");
  // 1. password toggle + caps lock
  await go("#/login");
  const pw = $("#password"),
    toggle = $(".password-toggle");
  assert.equal(pw.type, "password");
  toggle.click();
  await sleep(20);
  assert.equal(pw.type, "text");
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.equal(toggle.getAttribute("aria-label"), "Sembunyikan password");
  toggle.click();
  await sleep(20);
  assert.equal(pw.type, "password");
  assert.equal($(".caps-warning").hidden, true);
  pw.dispatchEvent(
    new w.KeyboardEvent("keydown", {
      bubbles: true,
      key: "A",
      modifierCapsLock: true,
    }),
  );
  assert.equal($(".caps-warning").hidden, false);
  pw.dispatchEvent(new w.KeyboardEvent("keyup", { bubbles: true, key: "a" }));
  assert.equal($(".caps-warning").hidden, true);
  ok("password toggle and Caps Lock warning");

  // 2. new recruiter: guided steps, no dead button, no zero stats
  await register("employer", "Uji Perekrut");
  assert.ok($(".onboarding"), "onboarding shown");
  assert.equal($$(".step").length, 3);
  assert.equal(text(".step.current strong"), "Buat profil perusahaan");
  assert.equal(
    $$(".notice.warn").length,
    0,
    "no duplicate verification banner",
  );
  assert.equal($(".stats"), null);
  assert.equal($$("button[disabled]").length, 0);
  assert.ok(text(".step").includes("Mode demo ini tidak mengirim email"));
  assert.equal($(".eyebrow"), null);
  ok("recruiter onboarding");

  // 3. unverified: job form explains instead of failing
  $(".step [data-action=job-form]").click();
  await until(() => $("#dialog").hasAttribute("open"), "verification dialog");
  assert.equal(text("#dialog-title"), "Verifikasi email terlebih dahulu");
  $("#dialog").close();
  ok("unverified recruiter gets an explanation");

  // 4. verified, no company: company form hands off to the job form
  await sb.pool.query(
    "UPDATE users SET email_verified_at=NOW() WHERE email='ujiperekrut@example.com'",
  );
  $(".step [data-action=job-form]").click();
  await until(
    () => text("#dialog-title") === "Tambah perusahaan",
    "company-first dialog",
  );
  assert.equal($("[data-form=company]").dataset.then, "job");
  fill("#dialog #name", "PT Uji");
  fill("#dialog #location", "Depok");
  $("[data-form=company]").requestSubmit();
  await until(
    () =>
      text("#dialog-title") === "Pasang lowongan" &&
      $("#dialog").hasAttribute("open"),
    "job form after company",
  );
  assert.equal($("#company_id").selectedOptions[0].textContent, "PT Uji");
  ok("company form continues to job form");

  // 5. salary formatting and warnings
  const min = fill("#salary_min", "100");
  assert.equal(min.value, "100");
  assert.ok(
    text(".salary-hint").includes("terlalu kecil"),
    text(".salary-hint"),
  );
  assert.ok($(".salary-hint").classList.contains("warn"));
  fill("#salary_min", "9000000");
  fill("#salary_max", "8000000");
  assert.equal($("#salary_min").value, "9.000.000");
  assert.equal(
    text(".salary-hint"),
    "Gaji minimum lebih besar dari gaji maksimum.",
  );
  fill("#salary_min", "5000000abc");
  assert.equal($("#salary_min").value, "5.000.000");
  assert.equal(
    text(".salary-hint"),
    "Rentang gaji: Rp5.000.000 – Rp8.000.000 per bulan.",
  );
  assert.equal($(".salary-hint").classList.contains("warn"), false);
  fill("#title", "Konten Kreator");
  $("#category_id").value = "category-design";
  fill("#description", "Deskripsi uji");
  $("[data-form=job]").requestSubmit();
  await until(
    () => !$("#dialog").hasAttribute("open") && $("table") && !$(".loading"),
    "job saved",
  );
  const saved = await sb.pool.query(
    "SELECT salary_min,salary_max,status FROM jobs WHERE title='Konten Kreator'",
  );
  assert.deepEqual(saved.rows[0], {
    salary_min: 5000000,
    salary_max: 8000000,
    status: "open",
  });
  assert.equal($(".onboarding"), null, "onboarding disappears once complete");
  assert.ok($(".stats"));
  ok("salary input and job creation");

  // 6. editing shows formatted salary
  $("table [data-action=job-form]").click();
  await until(() => text("#dialog-title") === "Edit lowongan", "edit dialog");
  assert.equal($("#salary_min").value, "5.000.000");
  $("#dialog").close();
  ok("edit form pre-fills formatted salary");

  // 7. new applicant: role-specific notice, no zero stats
  await logout();
  await register("user", "Uji Pelamar");
  assert.ok(
    text(".notice.warn").includes("mengunggah CV"),
    text(".notice.warn"),
  );
  assert.ok(!text(".notice.warn").includes("lowongan"));
  assert.equal($(".stats").hidden, true);
  ok("applicant dashboard");

  // Riwayat tahap lamaran dan pengurutan gaji untuk pelamar contoh.
  await logout();
  await sb.pool.query(
    "INSERT INTO documents(id,user_id,filename,original_name,mime_type,size) VALUES('doc-ui','demo-applicant','doc-ui.pdf','cv.pdf','application/pdf',10)",
  );
  await sb.pool.query(
    "INSERT INTO applications(id,user_id,job_id,document_id,status) VALUES('app-ui','demo-applicant','demo-job-2','doc-ui','reviewing')",
  );
  await sb.pool.query(
    "INSERT INTO application_status_outbox(id,application_id,status) VALUES('11111111-1111-4111-8111-111111111111','app-ui','reviewing')",
  );
  await go("#/login");
  fill("#email", "pelamar@example.com");
  fill("#password", "DemoOpenJob123!");
  $("[data-form=login]").requestSubmit();
  await until(
    () => w.location.hash === "#/account" && $("table"),
    "demo applicant",
  );
  $("[data-action=application-detail]").click();
  await until(() => $(".timeline"), "timeline");
  assert.deepEqual(
    $$(".timeline strong").map((x) => x.textContent),
    ["Terkirim", "Ditinjau"],
  );
  assert.ok($(".timeline li:last-child").classList.contains("latest"));
  $("#dialog").close();
  await go("#/jobs?sort=salary");
  assert.equal($("#job-sort").value, "salary");
  assert.equal($(".job-card h3").textContent, "Backend Developer");
  fill("#min_salary", "11000000");
  assert.equal($("#min_salary").value, "11.000.000");
  $("[data-form=filters]").requestSubmit();
  await until(
    () => w.location.hash.includes("min_salary=11000000") && !$(".loading"),
    "salary filter",
  );
  await sleep(200);
  assert.ok(
    text(".results-head").startsWith("4 lowongan"),
    text(".results-head"),
  );
  ok("status timeline, salary sort and filter");

  // 8. seeded recruiter is unaffected
  await logout();
  await go("#/login");
  fill("#email", "perekrut@example.com");
  fill("#password", "DemoOpenJob123!");
  $("[data-form=login]").requestSubmit();
  await until(
    () => w.location.hash === "#/employer" && $("table"),
    "demo recruiter",
  );
  assert.equal($(".onboarding"), null);
  assert.equal($(".notice.warn"), null);
  assert.ok($(".stats"));
  $(".section-head [data-action=job-form]").click();
  await until(
    () => text("#dialog-title") === "Pasang lowongan",
    "job form for demo recruiter",
  );
  $("#dialog").close();
  await go("#/employer/jobs");
  assert.equal(text(".section-head h2"), "Daftar lowongan");
  await go("#/account/profile");
  assert.equal($$(".password-toggle").length, 2);
  ok("existing recruiter flows");

  assert.deepEqual(errors, []);
  console.log("ALL UI CHECKS PASSED");
  server.close();
  await sb.close();
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
