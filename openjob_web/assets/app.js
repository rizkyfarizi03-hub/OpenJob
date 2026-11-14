const $ = (s, r = document) => r.querySelector(s),
  main = $("#main"),
  dialog = $("#dialog");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/>',
  bag: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  design: '<path d="m4 17 1-5L16 1l6 6-11 11-5 1ZM13 4l6 6M3 22h18"/>',
  chart: '<path d="M4 20V4m0 16h17M8 16v-4m5 4V8m5 8V4"/>',
  users:
    '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3m1-18a4 4 0 0 1 0 8m3 10v-3a7 7 0 0 0-2-5"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9m3-10v12"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 1 1 19 0Z"/><path d="M7 9h9M7 13h6"/>',
  file: '<path d="M14 2H5v20h14V7Zm0 0v5h5M8 12h8m-8 4h6"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  building: '<path d="M4 22V3h12v19m0-13h4v13M1 22h22M8 7h4m-4 4h4m-4 4h4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  filter: '<path d="M3 6h18M6 12h12M9 18h6"/>',
  tag: '<path d="M12 2H2v10l10 10 10-10L12 2Zm-5 5a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="m3 3 18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.5 6.6C3.7 8.5 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const icon = (n) =>
  '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  (icons[n] || icons.bag) +
  "</svg>";
const labels = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  contract: "Kontrak",
  internship: "Magang",
  freelance: "Freelance",
  remote: "Remote",
  hybrid: "Hybrid",
  "on-site": "On-site",
  entry: "Fresh graduate",
  junior: "Junior",
  mid: "Menengah",
  senior: "Senior",
  lead: "Lead",
  pending: "Terkirim",
  reviewing: "Ditinjau",
  interview: "Wawancara",
  accepted: "Diterima",
  rejected: "Ditolak",
  withdrawn: "Ditarik",
  open: "Aktif",
  close: "Ditutup",
};
const label = (v) => labels[v] || v || "—",
  date = (v) =>
    new Date(v).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  currency = (v) => new Intl.NumberFormat("id-ID").format(Number(v));
const salary = (j) =>
  j.is_salary_visible && j.salary_min != null
    ? "Rp" +
      currency(j.salary_min) +
      (j.salary_max != null ? " – " + currency(j.salary_max) : "")
    : "Gaji tidak ditampilkan";
const status = (s) =>
  '<span class="status ' + esc(s) + '">' + esc(label(s)) + "</span>";
// Logo perusahaan bila ada; kalau tidak, inisial berwarna.
const avatar = (name, i = 0, companyId, logoAt) =>
  companyId && logoAt
    ? '<img class="company-avatar logo" alt="" loading="lazy" src="/api/companies/' +
      encodeURIComponent(companyId) +
      "/logo?v=" +
      new Date(logoAt).getTime() +
      '">'
    : '<div class="company-avatar tone-' +
      (i % 5) +
      '" aria-hidden="true">' +
      esc((name || "O").slice(0, 2).toUpperCase()) +
      "</div>";
const state = {
  user: null,
  token: sessionStorage.getItem("openjob.access"),
  refresh: sessionStorage.getItem("openjob.refresh"),
  categories: [],
  bookmarks: new Set(),
  jobs: [],
  companies: [],
  applications: [],
  demo: false,
};
let version = 0,
  toastTimer,
  refreshPromise,
  resetToken = "",
  verificationToken = "";
function clearSession() {
  state.user = null;
  state.token = null;
  state.refresh = null;
  state.bookmarks.clear();
  sessionStorage.removeItem("openjob.access");
  sessionStorage.removeItem("openjob.refresh");
}
function saveSession(d) {
  state.token = d.accessToken;
  if (d.refreshToken) state.refresh = d.refreshToken;
  sessionStorage.setItem("openjob.access", state.token);
  sessionStorage.setItem("openjob.refresh", state.refresh);
}
async function api(path, options = {}, retry = true) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = "Bearer " + state.token;
  if (options.body && !(options.body instanceof FormData))
    headers["Content-Type"] = "application/json";
  let r;
  try {
    r = await fetch("/api" + path, { ...options, headers });
  } catch {
    throw Error(
      "Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.",
    );
  }
  if (
    r.status === 401 &&
    state.refresh &&
    retry &&
    !path.startsWith("/authentications")
  ) {
    if (!refreshPromise)
      refreshPromise = fetch("/api/authentications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: state.refresh }),
      })
        .then(async (r) => {
          if (!r.ok) throw Error("expired");
          saveSession((await r.json()).data);
        })
        .finally(() => {
          refreshPromise = null;
        });
    try {
      await refreshPromise;
      return api(path, options, false);
    } catch {
      clearSession();
      renderHeader();
      throw Error("Sesi berakhir. Silakan masuk kembali.");
    }
  }
  if (options.blob) {
    if (!r.ok) throw Error("Dokumen tidak tersedia atau akses ditolak");
    const blob = await r.blob(),
      disp = r.headers.get("content-disposition") || "",
      m = disp.match(/filename="?([^";]+)"?/i);
    return { blob, filename: m ? m[1].trim() : "cv.pdf" };
  }
  const result = await r
    .json()
    .catch(() => ({ message: "Respons server tidak valid" }));
  if (!r.ok) throw Error(result.message || "Permintaan tidak berhasil");
  return result.data ?? result;
}
const send = (p, m, b) => api(p, { method: m, body: JSON.stringify(b) });
function toast(t) {
  const el = $("#toast");
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}
const link = (href, text, cls = "btn") =>
  '<a class="' + cls + '" href="' + esc(href) + '">' + text + "</a>";
const empty = (t, m, a = "") =>
  '<div class="empty">' +
  icon("bag") +
  "<h3>" +
  esc(t) +
  "</h3><p>" +
  esc(m) +
  "</p>" +
  a +
  "</div>";
const heading = (t, d, k = "") =>
  '<div class="page-head">' +
  (k ? '<div class="eyebrow">' + esc(k) + "</div>" : "") +
  "<h1>" +
  esc(t) +
  "</h1><p>" +
  esc(d) +
  "</p></div>";
const field = (n, t, type = "text", v = "", extra = "") =>
  '<div class="field"><label for="' +
  n +
  '">' +
  t +
  "</label>" +
  (type === "password" ? '<div class="password-wrap">' : "") +
  '<input id="' +
  n +
  '" name="' +
  n +
  '" type="' +
  type +
  '" value="' +
  esc(v) +
  '" ' +
  extra +
  ">" +
  (type === "password"
    ? '<button type="button" class="password-toggle" data-action="toggle-password" aria-label="Tampilkan password" aria-pressed="false">' +
      icon("eye") +
      '</button></div><small class="caps-warning" role="status" hidden>Caps Lock menyala.</small>'
    : "") +
  "</div>";
function select(n, t, items, v = "", all = "Pilih…") {
  return (
    '<div class="field"><label for="' +
    n +
    '">' +
    t +
    '</label><select id="' +
    n +
    '" name="' +
    n +
    '"><option value="">' +
    all +
    "</option>" +
    items
      .map((x) => {
        const [key, text] = Array.isArray(x) ? x : [x, label(x)];
        return (
          '<option value="' +
          esc(key) +
          '" ' +
          (key === v ? "selected" : "") +
          ">" +
          esc(text) +
          "</option>"
        );
      })
      .join("") +
    "</select></div>"
  );
}
const area = (n, t, v = "", extra = "") =>
  '<div class="field"><label for="' +
  n +
  '">' +
  t +
  '</label><textarea id="' +
  n +
  '" name="' +
  n +
  '" ' +
  extra +
  ">" +
  esc(v) +
  "</textarea></div>";
const formError = '<p class="form-error" role="alert"></p>';
function renderHeader() {
  const r = location.hash || "#/";
  $("#header").innerHTML =
    '<nav class="nav" aria-label="Navigasi utama"><a class="brand" href="#/" aria-label="OpenJob beranda"><span class="brand-mark">' +
    icon("bag") +
    '</span>openjob<span class="brand-dot">.</span></a><div class="nav-links">' +
    [
      ["#/", "Beranda"],
      ["#/jobs", "Cari Lowongan"],
      ["#/companies", "Perusahaan"],
    ]
      .map(([p, t]) => link(p, t, r === p ? "active" : ""))
      .join("") +
    '</div><div class="nav-actions">' +
    (state.user
      ? '<span class="user-name">Halo, ' +
        esc(state.user.name.split(" ")[0]) +
        "</span>" +
        link(
          state.user.role === "user"
            ? "#/account"
            : state.user.role === "admin"
              ? "#/admin/categories"
              : "#/employer",
          "Dashboard",
          "btn secondary",
        ) +
        '<button class="btn ghost user-logout" data-action="logout">Keluar</button>'
      : link("#/login", "Masuk", "text-link") +
        link("#/register?role=employer", "Pasang Lowongan " + icon("arrow"))) +
    "</div></nav>";
}
// Umur lowongan dalam bahasa sehari-hari, dihitung dari waktu publikasi.
function ago(v) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(v)) / 60000));
  if (minutes < 5) return "Baru saja";
  if (minutes < 60) return minutes + " menit lalu";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " jam lalu";
  const days = Math.floor(hours / 24);
  if (days < 7) return days + " hari lalu";
  if (days < 30) return Math.floor(days / 7) + " minggu lalu";
  if (days < 365) return Math.floor(days / 30) + " bulan lalu";
  return "Lebih dari setahun lalu";
}
const isNew = (v) => Date.now() - new Date(v) < 3 * 86400000;
function card(j, i = 0) {
  // Pada bookmark, created_at adalah waktu menyimpan; waktu publikasi ada di job_created_at.
  const posted = j.job_created_at || j.created_at;
  const b =
    !state.user || state.user.role === "user"
      ? '<button class="icon-btn ' +
        (state.bookmarks.has(j.id) ? "saved" : "") +
        '" data-action="bookmark" data-id="' +
        esc(j.id) +
        '" aria-label="Simpan lowongan" aria-pressed="' +
        state.bookmarks.has(j.id) +
        '">' +
        icon("bookmark") +
        "</button>"
      : "";
  return (
    '<article class="job-card"><div class="card-top">' +
    avatar(j.company_name, i, j.company_id, j.company_logo_updated_at) +
    '<div class="company-meta">' +
    link("#/companies/" + j.company_id, esc(j.company_name), "") +
    "<small>" +
    esc(j.location_city || label(j.location_type)) +
    (posted
      ? ' · <time datetime="' +
        esc(new Date(posted).toISOString()) +
        '" title="' +
        esc(date(posted)) +
        '">' +
        ago(posted) +
        "</time>"
      : "") +
    "</small></div>" +
    b +
    "</div><h3>" +
    link("#/jobs/" + j.id, esc(j.title), "") +
    '</h3><div class="tags">' +
    (posted && isNew(posted) ? '<span class="tag new">Baru</span>' : "") +
    '<span class="tag">' +
    esc(label(j.job_type)) +
    '</span><span class="tag">' +
    esc(label(j.experience_level)) +
    '</span><span class="tag green">' +
    esc(label(j.location_type)) +
    '</span></div><div class="card-bottom"><span class="salary">' +
    esc(salary(j)) +
    "</span>" +
    link("#/jobs/" + j.id, "Detail " + icon("arrow"), "text-link") +
    "</div></article>"
  );
}
function searchForm(p = new URLSearchParams(), cls = "") {
  return (
    '<form class="searchbar ' +
    cls +
    '" data-form="search"><label class="search-field">' +
    icon("search") +
    '<input name="title" aria-label="Posisi atau kata kunci" placeholder="Posisi atau kata kunci" value="' +
    esc(p.get("title") || "") +
    '"></label><label class="search-field">' +
    icon("pin") +
    '<input name="location" aria-label="Kota" placeholder="Kota atau lokasi" value="' +
    esc(p.get("location") || "") +
    '"></label><button class="btn" type="submit">Cari Lowongan</button></form>'
  );
}
async function home() {
  const d = await api("/jobs?limit=6"),
    ci = ["code", "design", "chart", "bag", "coin", "chat"];
  return (
    '<section class="hero"><div class="hero-inner"><div class="hero-copy"><div class="eyebrow">PELUANG BARU, CERITA BARU</div><h1>Langkah berikutnya.<br><em>Dimulai di sini.</em></h1><p>Temukan pekerjaan yang memberi ruang untuk berkembang. Karier yang tepat dimulai dari satu peluang.</p>' +
    searchForm() +
    '<div class="popular"><span>Pencarian populer:</span><a href="#/jobs?title=Designer">Designer</a><a href="#/jobs?title=Developer">Developer</a><a href="#/jobs?title=Marketing">Marketing</a></div></div><div class="hero-art" aria-hidden="true"><div class="art-orbit"></div><div class="art-panel"><div class="art-arrow">↗</div><span>MAKE ROOM TO GROW</span></div><div class="float-card top"><div class="mini-icon">' +
    icon("bag") +
    '</div><div><strong>Peluang yang lebih cocok</strong><span>Untuk langkah besar berikutnya</span></div></div><div class="float-card bottom"><div class="mini-icon">' +
    icon("check") +
    '</div><div><strong>Siap untuk berkembang?</strong><span>Mulai perjalanan karier Anda</span></div></div><span class="spark">✳</span></div></div></section><div class="trust-row"><div class="trust-inner"><strong>Karier Anda, pilihan Anda.</strong><span>' +
    icon("search") +
    "Temukan pekerjaan yang sesuai</span><span>" +
    icon("file") +
    "Lamar dengan CV pilihan Anda</span><span>" +
    icon("chart") +
    'Pantau proses lamaran</span></div></div><div class="container"><section class="section"><div class="section-head"><div><div class="eyebrow">TEMUKAN BIDANG ANDA</div><h2>Banyak jalan untuk bertumbuh.</h2></div>' +
    link("#/jobs", "Semua lowongan " + icon("arrow"), "text-link") +
    '</div><div class="categories">' +
    state.categories
      .slice(0, 6)
      .map(
        (c, i) =>
          '<a class="category" href="#/jobs?category=' +
          encodeURIComponent(c.id) +
          '"><div class="mini-icon">' +
          icon(ci[i]) +
          "</div><div><strong>" +
          esc(c.name) +
          "</strong><br><span>Jelajahi peluang ↗</span></div></a>",
      )
      .join("") +
    '</div></section><section class="section"><div class="section-head"><div><div class="eyebrow">LANGKAH BARU MENANTI</div><h2>Lowongan terbaru</h2><p>Temukan peran berikutnya yang bisa jadi milik Anda.</p></div>' +
    link("#/jobs", "Lihat semua " + icon("arrow"), "text-link") +
    '</div><div class="job-grid">' +
    (d.jobs.length
      ? d.jobs.map(card).join("")
      : empty(
          "Peluang baru segera hadir",
          "Belum ada lowongan aktif. Kunjungi kembali atau pasang lowongan pertama.",
        )) +
    '</div></section><section class="cta"><div><div class="eyebrow">UNTUK PERUSAHAAN</div><h2>Tim hebat dimulai dari orang yang tepat.</h2><p>Temukan talenta untuk tumbuh bersama perusahaan Anda.</p></div>' +
    link(
      state.user && state.user.role !== "user"
        ? "#/employer"
        : "#/register?role=employer",
      "Mulai Merekrut " + icon("arrow"),
      "btn lime",
    ) +
    "</section></div>"
  );
}

async function listing(params) {
  const q = new URLSearchParams(params);
  q.set("limit", "8");
  const d = await api("/jobs?" + q),
    p = d.pagination;
  return (
    '<div class="container">' +
    heading(
      "Temukan ruang untuk berkembang.",
      "Pekerjaan berikutnya, satu pencarian lebih dekat.",
      "JELAJAHI LOWONGAN",
    ) +
    searchForm(params, "listing-search") +
    '<button class="btn secondary filter-toggle" data-action="filters">' +
    icon("filter") +
    'Filter lowongan</button><div class="listing-layout"><aside class="filter-panel"><h3>Filter lowongan</h3><form data-form="filters">' +
    field("title", "Kata kunci", "text", params.get("title") || "") +
    field("location", "Kota", "text", params.get("location") || "") +
    select(
      "category",
      "Bidang pekerjaan",
      state.categories.map((c) => [c.id, c.name]),
      params.get("category"),
      "Semua bidang",
    ) +
    select(
      "job_type",
      "Tipe pekerjaan",
      ["full-time", "part-time", "contract", "internship", "freelance"],
      params.get("job_type"),
      "Semua tipe",
    ) +
    select(
      "location_type",
      "Sistem kerja",
      ["remote", "hybrid", "on-site"],
      params.get("location_type"),
      "Semua sistem",
    ) +
    select(
      "experience_level",
      "Pengalaman",
      ["entry", "junior", "mid", "senior", "lead"],
      params.get("experience_level"),
      "Semua level",
    ) +
    field(
      "min_salary",
      "Gaji minimum / bulan (Rp)",
      "text",
      money(params.get("min_salary")),
      'inputmode="numeric" autocomplete="off" data-money placeholder="Contoh: 5.000.000"',
    ) +
    select(
      "posted",
      "Waktu tayang",
      [
        ["1", "24 jam terakhir"],
        ["7", "7 hari terakhir"],
        ["30", "30 hari terakhir"],
      ],
      params.get("posted"),
      "Semua waktu",
    ) +
    '<button class="btn full">Terapkan filter</button>' +
    link("#/jobs", "Reset filter", "btn ghost full") +
    '</form></aside><section><div class="results-head"><span><strong>' +
    p.total +
    '</strong> lowongan ditemukan</span><label class="sort">Urutkan<select id="job-sort"><option value="newest">Terbaru</option><option value="salary" ' +
    (params.get("sort") === "salary" ? "selected" : "") +
    '>Gaji tertinggi</option></select></label></div><div class="job-grid">' +
    (d.jobs.length
      ? d.jobs.map(card).join("")
      : empty(
          "Belum ada yang cocok",
          "Coba kata kunci lain atau kurangi filter pencarian.",
          link("#/jobs", "Lihat semua lowongan", "btn secondary"),
        )) +
    "</div>" +
    (p.pages > 1
      ? '<div class="pagination"><button class="btn secondary small" data-action="page" data-page="' +
        (p.page - 1) +
        '" ' +
        (p.page === 1 ? "disabled" : "") +
        ">Sebelumnya</button><span>" +
        p.page +
        " / " +
        p.pages +
        '</span><button class="btn secondary small" data-action="page" data-page="' +
        (p.page + 1) +
        '" ' +
        (p.page >= p.pages ? "disabled" : "") +
        ">Berikutnya</button></div>"
      : "") +
    "</section></div></div>"
  );
}
// Jumlah kecil dibulatkan agar tidak menebak siapa pelamarnya dan tidak mematahkan semangat.
const applicantCount = (n) =>
  n === 0
    ? "Belum ada pelamar. Jadilah yang pertama."
    : n < 5
      ? "Kurang dari 5 pelamar sejauh ini."
      : currency(n) + " pelamar sejauh ini.";
async function jobDetail(id) {
  const j = await api("/jobs/" + encodeURIComponent(id));
  let a;
  if (state.user?.role === "user")
    a = (await api("/profile/applications")).applications.find(
      (x) => x.job_id === id,
    );
  return (
    '<div class="container"><div class="page-head"><div class="breadcrumb">' +
    link("#/jobs", "Cari Lowongan", "") +
    " / " +
    esc(j.title) +
    '</div></div><div class="detail-layout"><div><article class="panel"><div class="card-top">' +
    avatar(j.company_name, 0, j.company_id, j.company_logo_updated_at) +
    '<div class="company-meta">' +
    link("#/companies/" + j.company_id, esc(j.company_name), "") +
    "<small>" +
    esc(j.location_city || label(j.location_type)) +
    "</small></div>" +
    status(j.status) +
    '</div><h1 class="detail-title">' +
    esc(j.title) +
    '</h1><div class="tags"><span class="tag">' +
    esc(label(j.job_type)) +
    '</span><span class="tag">' +
    esc(label(j.experience_level)) +
    '</span><span class="tag green">' +
    esc(label(j.location_type)) +
    '</span></div><div class="detail-summary"><div><span>Gaji per bulan</span><strong>' +
    esc(salary(j)) +
    "</strong></div><div><span>Bidang pekerjaan</span><strong>" +
    esc(j.category_name) +
    "</strong></div><div><span>Lokasi</span><strong>" +
    esc(j.location_city || label(j.location_type)) +
    "</strong></div><div><span>Dipublikasikan</span><strong>" +
    ago(j.created_at) +
    " · " +
    date(j.created_at) +
    '</strong></div></div><div class="divider"></div><h2>Tentang pekerjaan ini</h2><div class="detail-description">' +
    esc(j.description) +
    '</div></article><section class="panel"><h2>Tentang ' +
    esc(j.company_name) +
    '</h2><p class="detail-description">' +
    esc(j.company_description || "Informasi perusahaan belum ditambahkan.") +
    "</p>" +
    link(
      "#/companies/" + j.company_id,
      "Lihat profil perusahaan " + icon("arrow"),
      "text-link",
    ) +
    '</section></div><aside class="sticky"><div class="panel"><h2>Langkah baru Anda?</h2><p class="muted tiny">Kenali perannya. Siapkan CV terbaik. Mulai perjalanan berikutnya.</p>' +
    (j.status === "open" && j.applicant_count != null
      ? '<p class="applicant-count">' +
        icon("users") +
        applicantCount(j.applicant_count) +
        "</p>"
      : "") +
    '<div class="stack">' +
    (a
      ? '<div class="notice">Lamaran Anda: ' +
        esc(label(a.status)) +
        "</div>" +
        link("#/account", "Lihat lamaran saya")
      : j.status !== "open"
        ? '<button class="btn full" disabled>Lowongan ditutup</button>'
        : state.user && state.user.role !== "user"
          ? '<div class="notice">Gunakan akun pelamar untuk mengirim lamaran.</div>'
          : '<button class="btn full" data-action="apply" data-id="' +
            esc(j.id) +
            '">Lamar Sekarang ' +
            icon("arrow") +
            "</button>") +
    (!state.user || state.user.role === "user"
      ? '<button class="btn secondary full" data-action="bookmark" data-id="' +
        esc(j.id) +
        '">' +
        icon("bookmark") +
        (state.bookmarks.has(j.id) ? "Tersimpan" : "Simpan Lowongan") +
        "</button>"
      : "") +
    '</div></div><div class="notice">Jaga informasi pribadi Anda. Proses lamaran dilakukan melalui akun OpenJob.</div></aside></div></div>'
  );
}
async function companies(id, params = new URLSearchParams()) {
  if (id) {
    const q = new URLSearchParams({
      page: params.get("page") || "1",
      limit: "12",
    });
    const [c, d] = await Promise.all([
      api("/companies/" + encodeURIComponent(id)),
      api("/jobs/company/" + encodeURIComponent(id) + "?" + q),
    ]);
    const p = d.pagination;
    const pagination =
      p.pages > 1
        ? '<div class="pagination"><button class="btn secondary small" data-action="company-jobs-page" data-page="' +
          (p.page - 1) +
          '" ' +
          (p.page <= 1 ? "disabled" : "") +
          ">Sebelumnya</button><span>" +
          p.page +
          " / " +
          p.pages +
          '</span><button class="btn secondary small" data-action="company-jobs-page" data-page="' +
          (p.page + 1) +
          '" ' +
          (p.page >= p.pages ? "disabled" : "") +
          ">Berikutnya</button></div>"
        : "";
    return (
      '<div class="container">' +
      heading(c.name, c.location, "KENALI PERUSAHAAN") +
      '<section class="panel"><h2>Tentang perusahaan</h2><p class="detail-description">' +
      esc(c.description || "Belum ada deskripsi perusahaan.") +
      '</p></section><div class="section-head"><h2>Lowongan aktif</h2></div><div class="job-grid">' +
      (d.jobs.length
        ? d.jobs.map(card).join("")
        : empty(
            "Belum ada lowongan aktif",
            "Perusahaan ini belum membuka posisi baru.",
          )) +
      "</div>" +
      pagination +
      '<div class="section"></div></div>'
    );
  }
  const q = new URLSearchParams(params);
  if (!q.has("limit")) q.set("limit", "12");
  const d = await api("/companies?" + q),
    p = d.pagination || {
      page: 1,
      limit: 12,
      total: d.companies.length,
      pages: 1,
    };
  const search =
    '<form class="searchbar listing-search" data-form="company-search"><label class="search-field">' +
    icon("search") +
    '<input name="name" aria-label="Nama perusahaan" placeholder="Nama perusahaan" value="' +
    esc(params.get("name") || "") +
    '"></label><label class="search-field">' +
    icon("pin") +
    '<input name="location" aria-label="Kota atau lokasi" placeholder="Kota atau lokasi" value="' +
    esc(params.get("location") || "") +
    '"></label><button class="btn" type="submit">Cari Perusahaan</button></form>';
  const pagination =
    p.pages > 1
      ? '<div class="pagination"><button class="btn secondary small" data-action="company-page" data-page="' +
        (p.page - 1) +
        '" ' +
        (p.page === 1 ? "disabled" : "") +
        ">Sebelumnya</button><span>" +
        p.page +
        " / " +
        p.pages +
        '</span><button class="btn secondary small" data-action="company-page" data-page="' +
        (p.page + 1) +
        '" ' +
        (p.page >= p.pages ? "disabled" : "") +
        ">Berikutnya</button></div>"
      : "";
  return (
    '<div class="container">' +
    heading(
      "Kenali tempat Anda bertumbuh.",
      "Jelajahi perusahaan dan temukan tim yang sejalan dengan Anda.",
      "PERUSAHAAN",
    ) +
    search +
    '<div class="results-head spaced"><span><strong>' +
    p.total +
    "</strong> perusahaan ditemukan</span>" +
    (params.get("name") || params.get("location")
      ? link("#/companies", "Reset pencarian", "text-link")
      : "") +
    '</div><div class="company-list">' +
    (d.companies.length
      ? d.companies
          .map(
            (c, i) =>
              '<article class="panel">' +
              avatar(c.name, i, c.id, c.logo_updated_at) +
              "<h3>" +
              esc(c.name) +
              "</h3><p>" +
              esc(c.location) +
              '</p><p class="description">' +
              esc(
                c.description || "Temukan informasi lowongan perusahaan ini.",
              ) +
              "</p>" +
              link(
                "#/companies/" + c.id,
                "Lihat perusahaan " + icon("arrow"),
                "text-link",
              ) +
              "</article>",
          )
          .join("")
      : empty(
          "Perusahaan tidak ditemukan",
          "Coba kata kunci lain atau periksa kembali filter pencarian.",
          link("#/companies", "Semua perusahaan", "btn secondary"),
        )) +
    "</div>" +
    pagination +
    "</div>"
  );
}
function auth(register, p) {
  return (
    '<div class="auth-layout"><aside class="auth-aside"><div class="eyebrow">OPEN UP YOUR NEXT CHAPTER</div><h1>Setiap langkah<br>punya peluang.</h1><p>Temukan pekerjaan yang memberi Anda ruang untuk menjadi lebih baik.</p><div class="art-arrow" aria-hidden="true">↗</div></aside><section class="auth-form"><h2>' +
    (register ? "Mulai perjalanan Anda." : "Senang bertemu lagi.") +
    "</h2><p>" +
    (register
      ? "Buat akun untuk menemukan peluang berikutnya."
      : "Masuk dan lanjutkan langkah karier Anda.") +
    '</p><form data-form="' +
    (register ? "register" : "login") +
    '"><input type="hidden" name="next" value="' +
    esc(p.get("next") || "") +
    '">' +
    (register
      ? '<div class="role-options"><label><input type="radio" name="role" value="user" ' +
        (p.get("role") !== "employer" ? "checked" : "") +
        '> Saya mencari kerja</label><label><input type="radio" name="role" value="employer" ' +
        (p.get("role") === "employer" ? "checked" : "") +
        "> Saya merekrut</label></div>" +
        field(
          "name",
          "Nama lengkap",
          "text",
          "",
          'required maxlength="255" autocomplete="name"',
        )
      : "") +
    field(
      "email",
      "Alamat email",
      "email",
      "",
      'required autocomplete="email"',
    ) +
    field(
      "password",
      "Password",
      "password",
      "",
      'required minlength="8" maxlength="72" autocomplete="' +
        (register ? "new-password" : "current-password") +
        '"',
    ) +
    (register
      ? '<p class="tiny muted">Minimal 8 karakter. Jenis akun menentukan akses pelamar atau perekrut.</p>'
      : "") +
    formError +
    '<button class="btn full" type="submit">' +
    (register ? "Buat Akun" : "Masuk") +
    " " +
    icon("arrow") +
    "</button></form>" +
    (!register
      ? "<p>" +
        link("#/forgot-password", "Lupa password?", "text-link") +
        "</p>"
      : "") +
    '<p class="form-note">' +
    (register
      ? "Sudah punya akun? " +
        link(
          "#/login" +
            (p.get("next") ? "?next=" + encodeURIComponent(p.get("next")) : ""),
          "Masuk di sini",
          "",
        )
      : "Belum punya akun? " +
        link(
          "#/register" +
            (p.get("next") ? "?next=" + encodeURIComponent(p.get("next")) : ""),
          "Daftar sekarang",
          "",
        )) +
    "</p>" +
    (state.demo
      ? '<div class="notice">Mode demo · password <strong>DemoOpenJob123!</strong><br>Pelamar: pelamar@example.com<br>Perekrut: perekrut@example.com<br>Data demo hilang saat server dihentikan.</div>'
      : "") +
    "</section></div>"
  );
}
function passwordRecovery(reset) {
  if (state.features && !state.features.passwordReset)
    return (
      '<div class="container section">' +
      empty(
        "Server perlu diperbarui",
        "Server masih memakai versi sebelumnya. Jalankan kembali OpenJob, lalu muat ulang halaman ini.",
        link("#/login", "Kembali ke login"),
      ) +
      "</div>"
    );
  if (reset && !resetToken)
    return (
      '<div class="container section">' +
      empty(
        "Tautan reset belum tersedia",
        "Buka tautan dari email Anda, atau minta tautan baru.",
        link("#/forgot-password", "Minta tautan baru"),
      ) +
      "</div>"
    );
  return (
    '<div class="container section"><section class="panel recovery-panel"><h1>' +
    (reset ? "Ganti password" : "Lupa password") +
    "</h1><p>" +
    (reset
      ? "Buat password baru untuk akun Anda. Setelah berhasil, seluruh sesi lama akan dikeluarkan."
      : "Masukkan email akun Anda. Kami akan mengirim tautan untuk mengganti password.") +
    '</p><form data-form="' +
    (reset ? "reset-password" : "forgot-password") +
    '">' +
    (reset
      ? field(
          "password",
          "Password baru",
          "password",
          "",
          'required minlength="8" maxlength="72" autocomplete="new-password"',
        ) +
        field(
          "confirmation",
          "Ulangi password baru",
          "password",
          "",
          'required minlength="8" maxlength="72" autocomplete="new-password"',
        )
      : field(
          "email",
          "Alamat email",
          "email",
          "",
          'required autocomplete="email"',
        )) +
    formError +
    '<button class="btn full">' +
    (reset ? "Simpan Password Baru" : "Kirim Tautan Reset") +
    "</button></form><p>" +
    link("#/login", "Kembali ke login", "text-link") +
    "</p></section></div>"
  );
}
function verificationPage() {
  if (!state.features?.emailVerification)
    return (
      '<div class="container section">' +
      empty(
        "Server perlu diperbarui",
        "Jalankan kembali OpenJob untuk memuat fitur verifikasi email.",
        link("#/login", "Kembali ke login"),
      ) +
      "</div>"
    );
  let content;
  if (verificationToken)
    content =
      '<p>Konfirmasikan bahwa alamat email pada tautan ini milik Anda.</p><form data-form="verify-email">' +
      formError +
      '<button class="btn full">Verifikasi Email Saya</button></form>';
  else if (!state.user)
    content =
      "<p>Masuk ke akun Anda untuk meminta tautan verifikasi baru.</p>" +
      link("#/login?next=" + encodeURIComponent("/verify-email"), "Masuk");
  else if (state.user.email_verified_at)
    content =
      '<div class="notice">Email Anda sudah terverifikasi.</div>' +
      link(
        state.user.role === "user" ? "#/account" : "#/employer",
        "Kembali ke dashboard",
      );
  else
    content =
      "<p>Periksa email verifikasi yang dikirim ke <strong>" +
      esc(state.user.email) +
      '</strong>. Tautan berlaku 24 jam.</p><form data-form="send-verification">' +
      formError +
      '<button class="btn full">Kirim Ulang Email Verifikasi</button><div class="verification-result" role="status"></div></form><p>' +
      link("#/account/profile", "Perbaiki alamat email", "text-link") +
      "</p>";
  return (
    '<div class="container section"><section class="panel recovery-panel"><h1>Verifikasi Email</h1>' +
    content +
    "</section></div>"
  );
}
const needsVerification = () =>
  Boolean(state.features?.emailVerification) &&
  state.user?.email_verified_at === null;
// Demo tanpa Mailpit tidak mengirim email, jadi akun baru tidak bisa diverifikasi.
const mailUnavailable = () => state.demo && !state.features?.demoMail;
const demoMailNote =
  "Mode demo ini tidak mengirim email, jadi akun baru tidak bisa diverifikasi. Untuk mencoba alur lengkap, masuk dengan akun contoh di halaman Masuk.";
function verificationNotice() {
  if (!needsVerification()) return "";
  return (
    '<div class="notice warn" role="status"><strong>Email belum diverifikasi.</strong> ' +
    (state.user.role === "user"
      ? "Anda sudah bisa mengunggah CV. Verifikasi diperlukan sebelum mengirim lamaran. "
      : "Anda sudah bisa membuat profil perusahaan. Verifikasi diperlukan sebelum menerbitkan lowongan. ") +
    (mailUnavailable()
      ? demoMailNote
      : link("#/verify-email", "Verifikasi email", "text-link")) +
    "</div>"
  );
}
function workspace(content, section, employer = false, notice = true) {
  const isAdmin = state.user?.role === "admin";
  const adminLinks = isAdmin
    ? [["admin/categories", "tag", "Kategori Lowongan"]]
    : [];
  const links = employer
    ? [
        ["employer", "grid", "Ringkasan"],
        ["employer/jobs", "bag", "Lowongan Saya"],
        ["employer/applicants", "users", "Pelamar"],
        ["employer/company", "building", "Perusahaan"],
        ...adminLinks,
        ["account/profile", "file", "Pengaturan Akun"],
      ]
    : [
        ["account", "grid", "Lamaran Saya"],
        ["account/saved", "bookmark", "Tersimpan"],
        ["account/documents", "file", "Dokumen CV"],
        ...adminLinks,
        ["account/profile", "users", "Profil Saya"],
      ];
  return (
    '<div class="workspace"><aside class="sidebar" aria-label="Menu dashboard"><p class="sidebar-label">' +
    (isAdmin ? "RUANG ADMIN" : employer ? "RUANG PEREKRUT" : "RUANG PELAMAR") +
    "</p>" +
    links
      .map(([p, i, t]) =>
        link("#/" + p, icon(i) + t, section === p ? "active" : ""),
      )
      .join("") +
    '</aside><div class="workspace-main">' +
    (notice ? verificationNotice() : "") +
    content +
    "</div></div>"
  );
}
const dateTime = (v) =>
  new Date(v).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const stat = (t, v) =>
  '<div class="stat"><span>' + t + "</span><strong>" + v + "</strong></div>";
function applicationsTable(items, employer) {
  if (!items.length)
    return empty(
      employer ? "Belum ada lamaran masuk" : "Perjalanan Anda dimulai di sini",
      employer
        ? "Lamaran akan muncul ketika kandidat melamar lowongan Anda."
        : "Temukan pekerjaan yang cocok dan kirim lamaran pertama Anda.",
      link(
        employer ? "#/employer/jobs" : "#/jobs",
        employer ? "Kelola Lowongan" : "Cari Lowongan",
      ),
    );
  return (
    '<div class="table-wrap"><table><thead><tr><th>' +
    (employer ? "Pelamar" : "Posisi & perusahaan") +
    "</th>" +
    (employer ? "<th>Posisi</th>" : "") +
    "<th>Tanggal</th><th>Status</th><th>Aksi</th></tr></thead><tbody>" +
    items
      .map(
        (a) =>
          "<tr><td><strong>" +
          (employer
            ? esc(a.applicant_name)
            : link("#/jobs/" + a.job_id, esc(a.title), "")) +
          "</strong><small>" +
          esc(employer ? a.applicant_email : a.company_name) +
          "</small></td>" +
          (employer ? "<td>" + esc(a.title) + "</td>" : "") +
          "<td>" +
          date(a.created_at) +
          "</td><td>" +
          status(a.status) +
          '<small class="status-updated">Diperbarui ' +
          esc(dateTime(a.updated_at || a.created_at)) +
          '</small></td><td><button class="btn secondary small" data-action="application-detail" data-id="' +
          esc(a.id) +
          '">Lihat Detail</button></td></tr>',
      )
      .join("") +
    "</tbody></table></div>"
  );
}

async function account(section, params = new URLSearchParams()) {
  if (section === "account/profile")
    return workspace(
      heading("Profil saya", "Kelola informasi akun Anda.") +
        '<section class="panel"><h2>Informasi pribadi</h2><form data-form="profile"><div class="form-grid">' +
        field(
          "name",
          "Nama lengkap",
          "text",
          state.user.name,
          'required maxlength="255" autocomplete="name"',
        ) +
        field(
          "email",
          "Alamat email",
          "email",
          state.user.email,
          'required autocomplete="email"',
        ) +
        "</div>" +
        field(
          "current_password",
          "Password saat ini (untuk mengganti email atau password)",
          "password",
          "",
          'autocomplete="current-password"',
        ) +
        field(
          "password",
          "Password baru (opsional)",
          "password",
          "",
          'minlength="8" maxlength="72" autocomplete="new-password"',
        ) +
        '<p class="tiny muted">Kosongkan password jika tidak ingin mengubahnya.</p>' +
        formError +
        '<button class="btn">Simpan Perubahan</button></form></section>',
      section,
      state.user.role !== "user",
    );
  if (section === "account/saved") {
    const d = await api("/bookmarks");
    return workspace(
      heading(
        "Lowongan Tersimpan",
        "Kembali ke lowongan pilihan saat Anda siap melamar.",
      ) +
        '<div class="job-grid">' +
        (d.bookmarks.length
          ? d.bookmarks.map((b, i) => card({ ...b, id: b.job_id }, i)).join("")
          : empty(
              "Belum ada lowongan tersimpan",
              "Klik ikon simpan pada lowongan yang menarik perhatian Anda.",
              link("#/jobs", "Jelajahi Lowongan"),
            )) +
        "</div>",
      section,
    );
  }
  if (section === "account/documents") {
    const d = await api("/documents");
    return workspace(
      heading(
        "Dokumen CV",
        "Unggah CV Anda dan pilih dokumen yang sesuai untuk setiap lamaran.",
      ) +
        (params.get("job") && d.documents.length
          ? '<div class="notice">CV sudah tersedia. ' +
            link(
              "#/jobs/" + encodeURIComponent(params.get("job")),
              "Lanjutkan lamaran",
              "btn secondary",
            ) +
            "</div>"
          : "") +
        '<section class="panel"><h2>Unggah CV</h2><form data-form="upload" class="upload-zone"><div class="field"><label for="document">Pilih berkas PDF</label><input type="file" id="document" name="document" accept=".pdf,application/pdf" required><small>Maksimal 5 MB. CV hanya tersedia untuk Anda dan perekrut yang menerima lamaran Anda.</small></div>' +
        formError +
        '<button class="btn">Unggah Dokumen ' +
        icon("plus") +
        '</button></form></section><section class="panel"><h2>Dokumen saya</h2>' +
        (d.documents.length
          ? d.documents
              .map(
                (x) =>
                  '<div class="document-row"><div class="mini-icon">' +
                  icon("file") +
                  '</div><div class="document-info"><strong>' +
                  esc(x.originalName) +
                  "</strong><small>" +
                  Math.ceil(x.size / 1024) +
                  " KB · " +
                  date(x.createdAt) +
                  (x.inUse ? " · Digunakan dalam lamaran" : "") +
                  '</small></div><div class="actions"><button class="btn secondary small" data-action="download" data-id="' +
                  esc(x.id) +
                  '" data-name="' +
                  esc(x.originalName) +
                  '">Unduh</button><button class="btn danger small" data-action="delete-document" data-id="' +
                  esc(x.id) +
                  '" ' +
                  (x.inUse
                    ? 'disabled title="CV disimpan sebagai riwayat lamaran"'
                    : "") +
                  ">Hapus</button></div></div>",
              )
              .join("")
          : '<p class="muted tiny">Belum ada dokumen. Unggah CV pertama Anda di atas.</p>') +
        "</section>",
      section,
    );
  }
  const d = await api("/profile/applications");
  state.applications = d.applications;
  return workspace(
    heading("Lamaran Saya", "Pantau status dan pembaruan lamaran Anda.") +
      (d.applications.length
        ? '<div class="stats">'
        : '<div class="stats" hidden>') +
      stat("Total lamaran", d.applications.length) +
      stat(
        "Dalam proses",
        d.applications.filter((a) =>
          ["pending", "reviewing", "interview"].includes(a.status),
        ).length,
      ) +
      stat(
        "Diterima",
        d.applications.filter((a) => a.status === "accepted").length,
      ) +
      "</div>" +
      (d.applications.length
        ? '<div class="section-head"><h2>Riwayat lamaran</h2>' +
          link("#/jobs", "Cari Lowongan " + icon("arrow"), "text-link") +
          "</div>"
        : "") +
      applicationsTable(d.applications, false),
    section,
  );
}
function applicantPagination(p) {
  if (p.pages <= 1 && p.page === 1) return "";
  return (
    '<nav class="pagination" aria-label="Halaman pelamar"><button class="btn secondary small" data-action="applicant-page" data-page="' +
    (p.page - 1) +
    '" ' +
    (p.page <= 1 ? "disabled" : "") +
    ">Sebelumnya</button><span>Halaman " +
    p.page +
    " · " +
    p.total +
    ' lamaran</span><button class="btn secondary small" data-action="applicant-page" data-page="' +
    (p.page + 1) +
    '" ' +
    (p.page >= p.pages ? "disabled" : "") +
    ">Berikutnya</button></nav>"
  );
}
async function employer(section, params = new URLSearchParams()) {
  const editor = section.match(/^employer\/jobs\/(?:new|([^/]+)\/edit)$/);
  if (editor) return jobPage(editor[1] && decodeURIComponent(editor[1]));
  const companyOnly = section === "employer/company",
    needsApplicants =
      section === "employer" || section === "employer/applicants";
  const applicantQuery = new URLSearchParams({
    limit: section === "employer/applicants" ? "20" : "1",
    page: section === "employer/applicants" ? params.get("page") || "1" : "1",
  });
  if (section === "employer/applicants")
    for (const key of ["job_id", "status"])
      if (params.get(key)) applicantQuery.set(key, params.get(key));
  const [j, c, a] = await Promise.all([
    companyOnly ? Promise.resolve({ jobs: [] }) : api("/jobs/mine"),
    section === "employer/applicants"
      ? Promise.resolve({ companies: [] })
      : api("/companies/mine"),
    needsApplicants
      ? api("/applications?" + applicantQuery)
      : Promise.resolve({ applications: [] }),
  ]);
  if (needsApplicants && (!a.summary || !a.pagination))
    throw Error(
      "Server masih memakai versi sebelumnya. Hentikan server OpenJob, jalankan kembali, lalu muat ulang halaman ini.",
    );
  state.jobs = j.jobs;
  state.companies = c.companies;
  state.applications = a.applications;
  if (section === "employer/company")
    return workspace(
      heading(
        "Perusahaan Saya",
        "Perkenalkan perusahaan dan kelola profilnya.",
      ) +
        '<div class="section-head end"><button class="btn" data-action="company-form">' +
        icon("plus") +
        "Tambah Perusahaan</button></div>" +
        (c.companies.length
          ? c.companies
              .map(
                (x) =>
                  '<section class="panel"><div class="section-head"><div><h2>' +
                  esc(x.name) +
                  "</h2><p>" +
                  esc(x.location) +
                  '</p></div><button class="btn secondary small" data-action="company-form" data-id="' +
                  esc(x.id) +
                  '">Edit Profil</button></div><div class="logo-row">' +
                  avatar(x.name, 0, x.id, x.logo_updated_at) +
                  '<form data-form="company-logo" data-id="' +
                  esc(x.id) +
                  '"><label class="btn secondary small" for="logo-' +
                  esc(x.id) +
                  '">' +
                  (x.logo_updated_at ? "Ganti Logo" : "Unggah Logo") +
                  '</label><input class="visually-hidden" type="file" id="logo-' +
                  esc(x.id) +
                  '" name="logo" accept="image/png,image/jpeg,image/webp">' +
                  formError +
                  "</form>" +
                  (x.logo_updated_at
                    ? '<button class="btn danger small" data-action="delete-logo" data-id="' +
                      esc(x.id) +
                      '">Hapus Logo</button>'
                    : "") +
                  '<small class="muted">PNG, JPG, atau WebP. Maksimal 512 KB.</small></div><p class="detail-description">' +
                  esc(x.description) +
                  "</p>" +
                  link(
                    "#/companies/" + x.id,
                    "Lihat profil publik " + icon("arrow"),
                    "text-link",
                  ) +
                  "</section>",
              )
              .join("")
          : empty(
              "Belum ada perusahaan",
              "Buat profil perusahaan sebelum memasang lowongan.",
              '<button class="btn" data-action="company-form">' +
                icon("plus") +
                "Tambah Perusahaan</button>",
            )),
      section,
      true,
    );
  if (section === "employer/applicants")
    return workspace(
      heading(
        "Pelamar Masuk",
        "Tinjau CV dan kelola proses seleksi kandidat.",
      ) +
        '<div class="applicant-filters">' +
        select(
          "applicant-filter",
          "Filter posisi",
          j.jobs.map((x) => [x.id, x.title]),
          params.get("job_id") || "",
          "Semua lowongan",
        ) +
        select(
          "applicant-status-filter",
          "Tahap seleksi",
          [
            ["pending", "Menunggu ditinjau"],
            ["reviewing", "Sedang ditinjau"],
            ["interview", "Tahap wawancara"],
            ["accepted", "Diterima"],
            ["rejected", "Belum sesuai"],
            ["withdrawn", "Ditarik"],
          ],
          params.get("status") || "",
          "Semua status",
        ) +
        '</div><div class="results-head"><span><strong>' +
        a.pagination.total +
        "</strong> lamaran sesuai filter</span>" +
        (params.get("job_id") || params.get("status")
          ? link("#/employer/applicants", "Reset filter", "text-link")
          : "") +
        '</div><div id="applicant-table">' +
        (a.applications.length
          ? applicationsTable(a.applications, true)
          : empty(
              "Tidak ada lamaran di halaman ini",
              "Ubah filter atau kembali ke halaman sebelumnya.",
            )) +
        "</div>" +
        applicantPagination(a.pagination),
      section,
      true,
    );
  const table = j.jobs.length
    ? '<div class="table-wrap"><table><thead><tr><th>Lowongan</th><th>Status</th><th>Pelamar</th><th>Aksi</th></tr></thead><tbody>' +
      j.jobs
        .map(
          (x) =>
            "<tr><td><strong>" +
            esc(x.title) +
            "</strong><small>" +
            esc(x.company_name) +
            " · " +
            esc(x.location_city || label(x.location_type)) +
            "</small></td><td>" +
            status(x.status) +
            "</td><td>" +
            x.applicant_count +
            '</td><td><div class="actions"><button class="btn secondary small" data-action="job-form" data-id="' +
            esc(x.id) +
            '">Edit</button><button class="btn secondary small" data-action="toggle-job" data-id="' +
            esc(x.id) +
            '">' +
            (x.status === "open" ? "Tutup" : "Buka") +
            "</button>" +
            link("#/jobs/" + x.id, "Lihat", "text-link") +
            "</div></td></tr>",
        )
        .join("") +
      "</tbody></table></div>"
    : "";
  const guide = onboarding(c, j);
  return workspace(
    heading(
      section === "employer" ? "Ringkasan Rekrutmen" : "Lowongan saya",
      section === "employer"
        ? "Semua aktivitas rekrutmen Anda, dalam satu tempat."
        : "Kelola posisi yang sedang dibuka untuk tim Anda.",
    ) +
      guide +
      (section === "employer" && (j.jobs.length || a.summary.total)
        ? '<div class="stats">' +
          stat(
            "Lowongan aktif",
            j.jobs.filter((x) => x.status === "open").length,
          ) +
          stat("Total lamaran", a.summary.total) +
          stat("Menunggu ditinjau", a.summary.pending) +
          "</div>"
        : "") +
      (j.jobs.length
        ? '<div class="section-head"><h2>' +
          (section === "employer" ? "Lowongan Anda" : "Daftar lowongan") +
          '</h2><button class="btn" data-action="job-form">' +
          icon("plus") +
          "Pasang Lowongan</button></div>" +
          table
        : guide
          ? ""
          : empty(
              "Belum ada lowongan",
              "Pasang lowongan pertama Anda.",
              '<button class="btn" data-action="job-form">' +
                icon("plus") +
                "Pasang Lowongan</button>",
            )),
    section,
    true,
    !guide,
  );
}
// Tiga langkah awal perekrut; hilang setelah lowongan pertama terpasang.
function onboarding(c, j) {
  const unverified = needsVerification();
  const steps = [
    [
      !unverified,
      "Verifikasi email",
      !unverified
        ? "Email Anda sudah terverifikasi."
        : mailUnavailable()
          ? demoMailNote
          : "Buka tautan yang dikirim ke " + esc(state.user.email) + ".",
      mailUnavailable()
        ? ""
        : link("#/verify-email", "Verifikasi", "btn secondary small"),
    ],
    [
      c.companies.length > 0,
      "Buat profil perusahaan",
      "Lowongan dipasang atas nama perusahaan Anda.",
      '<button class="btn secondary small" data-action="company-form">Buat Profil</button>',
    ],
    [
      j.jobs.length > 0,
      "Pasang lowongan pertama",
      "Lowongan tampil di pencarian setelah diterbitkan.",
      '<button class="btn secondary small" data-action="job-form">Pasang Lowongan</button>',
    ],
  ];
  if (steps.every(([done]) => done)) return "";
  // Langkah yang disorot adalah yang pertama bisa dikerjakan sekarang.
  const next = steps.findIndex(([done, , , action]) => !done && action);
  return (
    '<section class="panel onboarding" aria-label="Langkah memulai"><h2>Mulai merekrut dalam tiga langkah</h2><ol class="steps">' +
    steps
      .map(
        ([done, title, text, action], i) =>
          '<li class="step' +
          (done ? " done" : i === next ? " current" : "") +
          '"><span class="step-mark" aria-hidden="true">' +
          (done ? icon("check") : i + 1) +
          "</span><div><strong>" +
          title +
          "</strong><p>" +
          text +
          "</p></div>" +
          (done
            ? '<span class="step-state">Selesai</span>'
            : i === next
              ? action.replace("btn secondary small", "btn small")
              : action) +
          "</li>",
      )
      .join("") +
    "</ol></section>"
  );
}
async function adminCategories() {
  const d = await api("/categories");
  state.categories = d.categories;
  return workspace(
    heading(
      "Kelola Kategori",
      "Atur kategori bidang pekerjaan untuk lowongan.",
      "ADMINISTRATOR",
    ) +
      '<div class="section-head"><h2>Daftar Kategori (' +
      d.categories.length +
      ')</h2><button class="btn" data-action="category-form">' +
      icon("plus") +
      'Tambah Kategori</button></div><div class="table-wrap"><table><thead><tr><th>Nama Kategori</th><th>ID</th><th>Aksi</th></tr></thead><tbody>' +
      (d.categories.length
        ? d.categories
            .map(
              (c) =>
                "<tr><td><strong>" +
                esc(c.name) +
                "</strong></td><td><small>" +
                esc(c.id) +
                '</small></td><td><div class="actions"><button class="btn secondary small" data-action="category-form" data-id="' +
                esc(c.id) +
                '" data-name="' +
                esc(c.name) +
                '">Edit</button><button class="btn danger small" data-action="delete-category" data-id="' +
                esc(c.id) +
                '">Hapus</button></div></td></tr>',
            )
            .join("")
        : '<tr><td colspan="3"><p class="muted tiny">Belum ada kategori.</p></td></tr>') +
      "</tbody></table></div>",
    "admin/categories",
    true,
  );
}
function showDialog(t, html) {
  dialog.innerHTML =
    '<div class="dialog-head"><h2 id="dialog-title">' +
    esc(t) +
    '</h2><button class="icon-btn" data-action="close-dialog" aria-label="Tutup dialog">' +
    icon("close") +
    "</button></div>" +
    html;
  if (!dialog.open) dialog.showModal();
}
function categoryForm(id, name = "") {
  showDialog(
    id ? "Edit Kategori" : "Tambah Kategori Baru",
    '<form data-form="category" data-id="' +
      esc(id || "") +
      '">' +
      field("name", "Nama kategori", "text", name, 'required maxlength="100"') +
      formError +
      '<button class="btn full">' +
      (id ? "Simpan Perubahan" : "Buat Kategori") +
      "</button></form>",
  );
}
function companyForm(id, thenJob = false) {
  const c = state.companies.find((x) => x.id === id) || {};
  showDialog(
    id ? "Edit perusahaan" : "Tambah perusahaan",
    (thenJob
      ? '<p class="muted">Lowongan dipasang atas nama perusahaan. Buat profilnya dulu, setelah itu form lowongan langsung terbuka.</p>'
      : "") +
      '<form data-form="company" data-id="' +
      esc(id || "") +
      '" data-then="' +
      (thenJob ? "job" : "") +
      '">' +
      field(
        "name",
        "Nama perusahaan",
        "text",
        c.name,
        'required maxlength="255"',
      ) +
      field(
        "location",
        "Lokasi",
        "text",
        c.location,
        'required maxlength="255"',
      ) +
      area(
        "description",
        "Tentang perusahaan",
        c.description,
        'maxlength="10000"',
      ) +
      formError +
      '<button class="btn full">' +
      (thenJob ? "Simpan dan Lanjut ke Lowongan" : "Simpan Perusahaan") +
      "</button></form>",
  );
}
// Lowongan baru butuh email terverifikasi dan minimal satu perusahaan.
async function openJobForm(id) {
  if (!id) {
    if (state.features?.emailVerification) state.user = await api("/profile");
    if (needsVerification()) {
      showDialog(
        "Verifikasi email terlebih dahulu",
        "<p>Lowongan baru bisa diterbitkan setelah email akun Anda diverifikasi.</p>" +
          (mailUnavailable()
            ? '<div class="notice warn">' + demoMailNote + "</div>"
            : link("#/verify-email", "Verifikasi email")),
      );
      return;
    }
    if (!state.companies.length) {
      companyForm(undefined, true);
      return;
    }
  }
  const hash = id
    ? "#/employer/jobs/" + encodeURIComponent(id) + "/edit"
    : "#/employer/jobs/new";
  if (location.hash === hash) await route();
  else location.hash = hash;
}
const money = (v) => (v == null || v === "" ? "" : currency(v));
// Kartu pratinjau memakai tampilan yang sama dengan hasil pencarian.
function jobPreview(j) {
  const company = state.companies.find((c) => c.id === j.company_id) || {};
  return card({
    ...j,
    id: "pratinjau",
    title: j.title || "Judul posisi",
    company_name: company.name || "Perusahaan",
    company_logo_updated_at: company.logo_updated_at,
    created_at: new Date().toISOString(),
  });
}
function readJobForm(form) {
  const data = Object.fromEntries(new FormData(form));
  for (const k of ["salary_min", "salary_max"]) {
    const digits = data[k].replace(/\D/g, "");
    data[k] = digits === "" ? null : Number(digits);
  }
  data.is_salary_visible = $("[name=is_salary_visible]", form).checked;
  return data;
}
// Halaman pasang/edit lowongan: form di kiri, pratinjau kartu di kanan.
async function jobPage(id) {
  const [mine, owned] = await Promise.all([
    api("/jobs/mine"),
    api("/companies/mine"),
  ]);
  state.jobs = mine.jobs;
  state.companies = owned.companies;
  const back = link("#/employer/jobs", "Kembali ke lowongan", "btn secondary");
  const j = id ? state.jobs.find((x) => x.id === id) : {};
  if (!j)
    return workspace(
      empty(
        "Lowongan tidak ditemukan",
        "Lowongan ini tidak ada atau bukan milik Anda.",
        back,
      ),
      "employer/jobs",
      true,
    );
  if (!id && !state.companies.length)
    return workspace(
      empty(
        "Buat profil perusahaan dulu",
        "Lowongan dipasang atas nama perusahaan Anda.",
        '<button class="btn" data-action="job-form">Buat Profil Perusahaan</button>',
      ),
      "employer/jobs",
      true,
    );
  const initial = {
    job_type: "full-time",
    experience_level: "junior",
    location_type: "on-site",
    company_id: state.companies[0]?.id,
    ...j,
  };
  return workspace(
    heading(
      id ? "Edit lowongan" : "Pasang lowongan",
      id
        ? "Perubahan langsung terlihat oleh pelamar setelah disimpan."
        : "Lengkapi detail posisi. Pratinjau di samping mengikuti isian Anda.",
    ) +
      '<div class="job-editor"><section class="panel">' +
      jobForm(id, initial) +
      '</section><aside class="job-preview" aria-label="Pratinjau lowongan"><p class="sidebar-label">PRATINJAU</p><div id="job-preview" inert>' +
      jobPreview(initial) +
      '</div><p class="tiny muted">Begini lowongan tampil di hasil pencarian.</p></aside></div>',
    "employer/jobs",
    true,
  );
}
function jobForm(id, j) {
  return (
    '<form data-form="job" data-id="' +
    esc(id || "") +
    '"><div class="form-grid"><div class="span-2">' +
    field(
      "title",
      "Judul posisi",
      "text",
      j.title,
      'required maxlength="255"',
    ) +
    "</div>" +
    select(
      "company_id",
      "Perusahaan",
      state.companies.map((c) => [c.id, c.name]),
      j.company_id || state.companies[0]?.id,
    ) +
    select(
      "category_id",
      "Kategori",
      state.categories.map((c) => [c.id, c.name]),
      j.category_id,
    ) +
    select(
      "job_type",
      "Tipe pekerjaan",
      ["full-time", "part-time", "contract", "internship", "freelance"],
      j.job_type || "full-time",
    ) +
    select(
      "experience_level",
      "Pengalaman",
      ["entry", "junior", "mid", "senior", "lead"],
      j.experience_level || "junior",
    ) +
    select(
      "location_type",
      "Sistem kerja",
      ["remote", "hybrid", "on-site"],
      j.location_type || "on-site",
    ) +
    field("location_city", "Kota", "text", j.location_city, 'maxlength="255"') +
    field(
      "salary_min",
      "Gaji minimum / bulan (Rp)",
      "text",
      money(j.salary_min),
      'inputmode="numeric" autocomplete="off" data-money placeholder="Contoh: 5.000.000"',
    ) +
    field(
      "salary_max",
      "Gaji maksimum / bulan (Rp)",
      "text",
      money(j.salary_max),
      'inputmode="numeric" autocomplete="off" data-money placeholder="Contoh: 8.000.000"',
    ) +
    '</div><p class="salary-hint" role="status"></p><label class="check"><input type="checkbox" name="is_salary_visible" ' +
    (j.is_salary_visible ? "checked" : "") +
    "> Tampilkan gaji di lowongan</label>" +
    area(
      "description",
      "Deskripsi, tanggung jawab & kualifikasi",
      j.description,
      'required maxlength="20000"',
    ) +
    formError +
    '<div class="form-actions">' +
    link("#/employer/jobs", "Batal", "btn secondary") +
    '<button class="btn">' +
    (id ? "Simpan Perubahan" : "Publikasikan Lowongan") +
    "</button></div></form>"
  );
}
async function apply(id) {
  if (!state.user) {
    location.hash = "#/login?next=" + encodeURIComponent("/jobs/" + id);
    return;
  }
  if (state.user.role !== "user")
    throw Error("Gunakan akun pelamar untuk mengirim lamaran");
  if (state.features?.emailVerification) state.user = await api("/profile");
  if (state.features?.emailVerification && !state.user.email_verified_at) {
    showDialog(
      "Verifikasi email terlebih dahulu",
      "<p>Anda bisa menyiapkan CV sekarang. Verifikasi email diperlukan sebelum mengirim lamaran.</p>" +
        link("#/verify-email", "Verifikasi email"),
    );
    return;
  }
  const d = await api("/documents");
  if (!d.documents.length) {
    showDialog(
      "Siapkan CV Anda",
      empty(
        "Satu langkah sebelum melamar",
        "Unggah CV dalam format PDF terlebih dahulu, lalu kembali ke lowongan ini.",
        link("#/account/documents?job=" + encodeURIComponent(id), "Unggah CV"),
      ),
    );
    return;
  }
  showDialog(
    "Kirim lamaran",
    '<p class="muted tiny">Pilih CV yang paling sesuai untuk posisi ini. Dokumen yang dikirim akan disimpan sebagai riwayat lamaran.</p><form data-form="apply" data-id="' +
      esc(id) +
      '">' +
      select(
        "document_id",
        "CV pilihan Anda",
        d.documents.map((x) => [x.id, x.originalName]),
        d.documents[0].id,
      ) +
      area(
        "cover_letter",
        "Pesan untuk perekrut (opsional)",
        "",
        'maxlength="5000"',
      ) +
      formError +
      '<button class="btn full">Kirim Lamaran ' +
      icon("arrow") +
      "</button></form>",
  );
}
const timeline = (history) =>
  '<ol class="timeline">' +
  history
    .map(
      (h, i) =>
        '<li class="' +
        (i === history.length - 1 ? "latest " : "") +
        esc(h.status) +
        '"><strong>' +
        esc(label(h.status)) +
        "</strong><small>" +
        esc(dateTime(h.at)) +
        "</small></li>",
    )
    .join("") +
  "</ol>";
async function applicationDetail(id) {
  const listed = state.applications.find((x) => x.id === id);
  if (!listed) return;
  // Detail memuat riwayat tahap; data daftar dipakai bila detail gagal dimuat.
  const a = await api("/applications/" + encodeURIComponent(id)).catch(
    () => listed,
  );
  const recruiter = state.user.role !== "user",
    active = ["pending", "reviewing", "interview"].includes(a.status);
  showDialog(
    recruiter ? a.applicant_name : "Detail lamaran",
    "<h3>" +
      esc(a.title) +
      '</h3><p class="muted tiny">' +
      esc(a.company_name) +
      " · Dikirim " +
      date(a.created_at) +
      "</p>" +
      (a.history
        ? timeline(a.history)
        : status(a.status) +
          '<p class="muted tiny">Pembaruan terakhir: ' +
          esc(dateTime(a.updated_at || a.created_at)) +
          "</p>") +
      '<div class="divider"></div><p class="detail-description">' +
      esc(a.cover_letter || "Tidak ada pesan tambahan.") +
      "</p>" +
      (a.document_id && a.status !== "withdrawn"
        ? '<button class="btn secondary" data-action="download" data-id="' +
          esc(a.document_id) +
          '" data-name="CV-' +
          esc(a.applicant_name) +
          '.pdf">' +
          icon("file") +
          "Unduh CV</button>"
        : "") +
      (recruiter && active
        ? '<div class="divider"></div><form data-form="application-status" data-id="' +
          esc(id) +
          '">' +
          select(
            "status",
            "Tahap seleksi",
            a.status === "interview"
              ? ["interview", "accepted", "rejected"]
              : ["reviewing", "interview", "accepted", "rejected"],
            a.status === "pending" ? "reviewing" : a.status,
          ) +
          formError +
          '<button class="btn full">Perbarui Status</button></form>'
        : !recruiter && active
          ? '<div class="divider"></div><button class="btn danger" data-action="withdraw" data-id="' +
            esc(id) +
            '">Tarik Lamaran</button>'
          : ""),
  );
}

async function route() {
  const mine = ++version;
  if (dialog.open) dialog.close();
  renderHeader();
  main.innerHTML = '<div class="loading">Menyiapkan peluang untuk Anda…</div>';
  const [path, query = ""] = (location.hash.slice(1) || "/").split("?"),
    params = new URLSearchParams(query),
    parts = path.split("/").filter(Boolean);
  if (parts[0] === "reset-password" && params.get("token")) {
    resetToken = params.get("token");
    history.replaceState(null, "", "#/reset-password");
  }
  if (parts[0] === "verify-email" && params.get("token")) {
    verificationToken = params.get("token");
    history.replaceState(null, "", "#/verify-email");
  }
  try {
    if (!state.categories.length)
      state.categories = (await api("/categories")).categories;
    let html;
    if (["account", "employer", "admin"].includes(parts[0]) && !state.user) {
      location.hash =
        "#/login?next=" + encodeURIComponent(path + (query ? "?" + query : ""));
      return;
    }
    if (parts[0] === "admin") {
      if (state.user.role !== "admin")
        html = workspace(
          empty(
            "Akses Dibatasi",
            "Halaman ini hanya dapat diakses oleh administrator.",
            link("#/account", "Kembali ke dashboard"),
          ),
          "account",
        );
      else html = await adminCategories();
    } else if (parts[0] === "employer" && state.user.role === "user")
      html = workspace(
        empty(
          "Area khusus perekrut",
          "Akun Anda adalah akun pencari kerja.",
          link("#/account", "Kembali ke dashboard"),
        ),
        "account",
      );
    else if (
      parts[0] === "account" &&
      state.user.role !== "user" &&
      parts[1] !== "profile"
    ) {
      location.hash =
        state.user.role === "admin" ? "#/admin/categories" : "#/employer";
      return;
    } else if (!parts.length) html = await home();
    else if (parts[0] === "jobs")
      html = parts[1] ? await jobDetail(parts[1]) : await listing(params);
    else if (parts[0] === "companies") html = await companies(parts[1], params);
    else if (parts[0] === "login" || parts[0] === "register")
      html = auth(parts[0] === "register", params);
    else if (parts[0] === "forgot-password" || parts[0] === "reset-password")
      html = passwordRecovery(parts[0] === "reset-password");
    else if (parts[0] === "verify-email") html = verificationPage();
    else if (parts[0] === "account")
      html = await account(parts.join("/"), params);
    else if (parts[0] === "employer")
      html = await employer(parts.join("/"), params);
    else
      html = empty(
        "Halaman tidak ditemukan",
        "Kembali ke beranda untuk melanjutkan.",
        link("#/", "Ke Beranda"),
      );
    if (mine !== version) return;
    main.innerHTML = html;
    document.title =
      (parts[0] === "jobs"
        ? "Lowongan"
        : parts[0] === "employer"
          ? "Ruang Perekrut"
          : parts[0] === "admin"
            ? "Ruang Admin"
            : parts[0] === "account"
              ? "Ruang Karier"
              : "Ruang untuk berkembang") + " — OpenJob";
    window.scrollTo(0, 0);
  } catch (e) {
    if (mine === version)
      main.innerHTML =
        '<div class="container section">' +
        empty(
          "Halaman belum dapat dimuat",
          e.message,
          '<button class="btn" data-action="retry">Coba Lagi</button>',
        ) +
        "</div>";
  }
}
document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.form,
    data = Object.fromEntries(new FormData(form)),
    button = $('button[type="submit"],button:not([type])', form),
    error = $(".form-error", form);
  if (error) error.textContent = "";
  if (type === "search" || type === "filters" || type === "company-search") {
    if (type === "company-search") {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(data))
        if (v.trim()) p.set(k, v.trim());
      const hash = "#/companies?" + p;
      if (location.hash === hash) await route();
      else location.hash = hash;
      return;
    }
    const p =
      type === "search" && location.hash.split("?")[0] === "#/jobs"
        ? new URLSearchParams(location.hash.split("?")[1])
        : new URLSearchParams();
    p.delete("page");
    for (const [k, raw] of Object.entries(data)) {
      const v = k === "min_salary" ? raw.replace(/\D/g, "") : raw.trim();
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const hash = "#/jobs?" + p;
    if (location.hash === hash) await route();
    else location.hash = hash;
    return;
  }
  if (button) button.disabled = true;
  try {
    if (type === "send-verification") {
      const result = await send("/email-verifications", "POST", {});
      $(".verification-result", form).textContent = result.message;
    } else if (type === "verify-email") {
      const result = await send("/email-verifications/confirm", "POST", {
        token: verificationToken,
      });
      verificationToken = "";
      if (state.user) state.user = await api("/profile");
      main.innerHTML =
        '<div class="container section">' +
        empty(
          "Email berhasil diverifikasi",
          result.message,
          link(
            state.user
              ? state.user.role === "user"
                ? "#/account"
                : "#/employer"
              : "#/login",
            state.user ? "Kembali ke dashboard" : "Masuk ke akun",
          ),
        ) +
        "</div>";
    } else if (type === "forgot-password") {
      const result = await send("/password-resets", "POST", {
        email: data.email,
      });
      form.innerHTML =
        '<div class="notice" role="status">' + esc(result.message) + "</div>";
    } else if (type === "reset-password") {
      if (data.password !== data.confirmation)
        throw Error("Ulangan password harus sama dengan password baru");
      await send("/password-resets/confirm", "POST", {
        token: resetToken,
        password: data.password,
      });
      resetToken = "";
      clearSession();
      location.hash = "#/login";
      toast("Password berhasil diganti. Silakan masuk kembali.");
    } else if (type === "register" || type === "login") {
      if (type === "register")
        await send("/users", "POST", {
          name: data.name,
          email: data.email,
          password: data.password,
          role: data.role,
        });
      saveSession(
        await send("/authentications", "POST", {
          email: data.email,
          password: data.password,
        }),
      );
      state.user = await api("/profile");
      await loadBookmarks();
      location.hash =
        data.next &&
        /^\/(jobs|account|employer|verify-email)(\/|$)/.test(data.next)
          ? "#" + data.next
          : state.user.role === "user"
            ? "#/account"
            : state.user.role === "admin"
              ? "#/admin/categories"
              : "#/employer";
      toast(
        type === "register"
          ? "Akun berhasil dibuat. Selamat datang!"
          : "Selamat datang kembali!",
      );
    } else if (type === "profile") {
      const body = { name: data.name, email: data.email };
      if (data.password) body.password = data.password;
      if (data.current_password) body.current_password = data.current_password;
      const result = await send("/users/" + state.user.id, "PUT", body);
      if (result?.reauthenticate) {
        clearSession();
        location.hash = "#/login";
        toast("Akun diperbarui. Silakan masuk kembali.");
      } else {
        state.user = await api("/profile");
        toast("Profil berhasil diperbarui");
        await route();
      }
    } else if (type === "upload") {
      const file = $("input[type=file]", form).files[0];
      if (!file || file.size > 5 * 1024 * 1024)
        throw Error("Pilih PDF dengan ukuran maksimal 5 MB");
      await api("/documents", { method: "POST", body: new FormData(form) });
      toast("CV berhasil diunggah");
      await route();
    } else if (type === "company-logo") {
      const file = $("input[type=file]", form).files[0];
      if (!file) throw Error("Pilih berkas gambar");
      if (file.size > 512 * 1024) throw Error("Ukuran logo maksimal 512 KB");
      await api("/companies/" + form.dataset.id + "/logo", {
        method: "PUT",
        body: new FormData(form),
      });
      toast("Logo disimpan");
      await route();
    } else if (type === "company") {
      await send(
        "/companies" + (form.dataset.id ? "/" + form.dataset.id : ""),
        form.dataset.id ? "PUT" : "POST",
        data,
      );
      const thenJob = form.dataset.then === "job";
      dialog.close();
      toast("Profil perusahaan disimpan");
      await route();
      if (thenJob) await openJobForm();
    } else if (type === "job") {
      for (const k of ["salary_min", "salary_max"]) {
        const digits = data[k].replace(/\D/g, "");
        data[k] = digits === "" ? null : Number(digits);
        if (data[k] > 2147483647) throw Error("Nilai gaji terlalu besar");
      }
      data.is_salary_visible = $("[name=is_salary_visible]", form).checked;
      if (
        data.salary_min != null &&
        data.salary_max != null &&
        data.salary_min > data.salary_max
      )
        throw Error(
          "Gaji maksimum harus lebih besar dari atau sama dengan minimum",
        );
      for (const k of [
        "company_id",
        "category_id",
        "job_type",
        "experience_level",
        "location_type",
      ])
        if (!data[k]) throw Error("Lengkapi semua pilihan lowongan");
      await send(
        "/jobs" + (form.dataset.id ? "/" + form.dataset.id : ""),
        form.dataset.id ? "PUT" : "POST",
        data,
      );
      toast("Lowongan berhasil disimpan");
      if (location.hash === "#/employer/jobs") await route();
      else location.hash = "#/employer/jobs";
    } else if (type === "apply") {
      await send("/applications", "POST", { job_id: form.dataset.id, ...data });
      dialog.close();
      toast("Lamaran terkirim. Semoga langkah berikutnya milik Anda!");
      await route();
    } else if (type === "application-status") {
      const result = await send(
        "/applications/" + form.dataset.id,
        "PUT",
        data,
      );
      dialog.close();
      toast(
        result.changed === false
          ? "Status lamaran tidak berubah"
          : "Status lamaran diperbarui",
      );
      await route();
    } else if (type === "category") {
      await send(
        "/categories" + (form.dataset.id ? "/" + form.dataset.id : ""),
        form.dataset.id ? "PUT" : "POST",
        { name: data.name },
      );
      state.categories = (await api("/categories")).categories;
      dialog.close();
      toast(
        form.dataset.id
          ? "Kategori berhasil diperbarui"
          : "Kategori berhasil dibuat",
      );
      await route();
    }
  } catch (e) {
    if (error) error.textContent = e.message;
    else toast(e.message);
  } finally {
    if (button) button.disabled = false;
  }
});
async function confirmAction(t, m, action) {
  showDialog(
    t,
    '<p class="muted">' +
      esc(m) +
      '</p><div class="dialog-actions"><button class="btn secondary" data-action="close-dialog">Batal</button><button class="btn" id="confirm-action">Ya, lanjutkan</button></div>',
  );
  $("#confirm-action").onclick = async () => {
    const b = $("#confirm-action");
    b.disabled = true;
    try {
      await action();
      dialog.close();
      await route();
    } catch (e) {
      toast(e.message);
      b.disabled = false;
    }
  };
}
document.addEventListener("click", async (event) => {
  if (event.target.closest(".skip-link")) {
    event.preventDefault();
    main.focus();
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action,
    id = button.dataset.id;
  try {
    if (action === "toggle-password") {
      const input = $("input", button.parentElement),
        show = input.type === "password";
      input.type = show ? "text" : "password";
      button.innerHTML = icon(show ? "eyeOff" : "eye");
      button.setAttribute("aria-pressed", String(show));
      button.setAttribute(
        "aria-label",
        show ? "Sembunyikan password" : "Tampilkan password",
      );
      input.focus();
    } else if (action === "close-dialog") dialog.close();
    else if (action === "retry") await route();
    else if (action === "filters")
      $(".filter-panel").classList.toggle("visible");
    else if (action === "page") {
      const p = new URLSearchParams(location.hash.split("?")[1]);
      p.set("page", button.dataset.page);
      location.hash = "#/jobs?" + p;
    } else if (action === "applicant-page") {
      const p = new URLSearchParams(location.hash.split("?")[1]);
      p.set("page", button.dataset.page);
      location.hash = "#/employer/applicants?" + p;
    } else if (action === "company-jobs-page") {
      const p = new URLSearchParams(location.hash.split("?")[1]);
      p.set("page", button.dataset.page);
      location.hash = location.hash.split("?")[0] + "?" + p;
    } else if (action === "company-page") {
      const p = new URLSearchParams(location.hash.split("?")[1]);
      p.set("page", button.dataset.page);
      location.hash = "#/companies?" + p;
    } else if (action === "logout") {
      await send("/authentications", "DELETE", { refreshToken: state.refresh });
      clearSession();
      location.hash = "#/";
      await route();
      toast("Anda sudah keluar");
    } else if (action === "bookmark") {
      if (!state.user) {
        location.hash = "#/login?next=" + encodeURIComponent("/jobs/" + id);
        return;
      }
      if (state.user.role !== "user") {
        toast("Hanya pencari kerja yang dapat menyimpan lowongan");
        return;
      }
      button.disabled = true;
      const saved = state.bookmarks.has(id);
      await api("/jobs/" + id + "/bookmark", {
        method: saved ? "DELETE" : "POST",
      });
      saved ? state.bookmarks.delete(id) : state.bookmarks.add(id);
      toast(saved ? "Lowongan dihapus dari simpanan" : "Lowongan disimpan");
      if (location.hash.startsWith("#/account/saved")) await route();
      else
        document.querySelectorAll('[data-action="bookmark"]').forEach((el) => {
          if (el.dataset.id === id) {
            const now = state.bookmarks.has(id);
            el.classList.toggle("saved", now);
            el.setAttribute("aria-pressed", String(now));
            el.setAttribute(
              "aria-label",
              now ? "Hapus dari simpanan" : "Simpan lowongan",
            );
            if (!el.classList.contains("icon-btn"))
              el.innerHTML =
                icon("bookmark") + (now ? "Tersimpan" : "Simpan Lowongan");
          }
        });
    } else if (action === "apply") await apply(id);
    else if (action === "company-form") companyForm(id);
    else if (action === "category-form") categoryForm(id, button.dataset.name);
    else if (action === "delete-category")
      await confirmAction(
        "Hapus kategori?",
        "Kategori yang masih digunakan oleh lowongan tidak dapat dihapus.",
        async () => {
          await api("/categories/" + id, { method: "DELETE" });
          state.categories = (await api("/categories")).categories;
          toast("Kategori dihapus");
        },
      );
    else if (action === "job-form") await openJobForm(id);
    else if (action === "toggle-job") {
      const j = state.jobs.find((x) => x.id === id);
      await confirmAction(
        j.status === "open" ? "Tutup lowongan?" : "Buka kembali lowongan?",
        j.status === "open"
          ? "Pelamar baru tidak dapat melamar. Riwayat lamaran tetap tersimpan."
          : "Lowongan akan tampil kembali di pencarian.",
        async () => {
          await send("/jobs/" + id, "PUT", {
            status: j.status === "open" ? "close" : "open",
          });
          toast("Status lowongan diperbarui");
        },
      );
    } else if (action === "download") {
      button.disabled = true;
      const { blob, filename } = await api("/documents/" + id, { blob: true }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = button.dataset.name || filename || "CV-OpenJob.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } else if (action === "delete-document")
      await confirmAction(
        "Hapus dokumen?",
        "Dokumen ini akan dihapus dari akun Anda.",
        async () => {
          await api("/documents/" + id, { method: "DELETE" });
          toast("Dokumen dihapus");
        },
      );
    else if (action === "delete-logo")
      await confirmAction(
        "Hapus logo?",
        "Perusahaan akan kembali memakai inisial nama.",
        async () => {
          await api("/companies/" + id + "/logo", { method: "DELETE" });
          toast("Logo dihapus");
        },
      );
    else if (action === "application-detail") await applicationDetail(id);
    else if (action === "withdraw")
      await confirmAction(
        "Tarik lamaran?",
        "Anda tidak dapat melamar ulang ke lowongan yang sama. Riwayat tetap disimpan.",
        async () => {
          await api("/applications/" + id, { method: "DELETE" });
          toast("Lamaran ditarik");
        },
      );
  } catch (e) {
    toast(e.message);
  } finally {
    button.disabled = false;
  }
});
document.addEventListener("change", (e) => {
  // Logo langsung diunggah begitu berkas dipilih.
  if (e.target.matches?.("[data-form=company-logo] input[type=file]"))
    e.target.form.requestSubmit();
  if (e.target.id === "job-sort") {
    const p = new URLSearchParams(location.hash.split("?")[1]);
    p.delete("page");
    if (e.target.value === "salary") p.set("sort", "salary");
    else p.delete("sort");
    location.hash = "#/jobs" + (p.size ? "?" + p : "");
  }
  if (
    e.target.id === "applicant-filter" ||
    e.target.id === "applicant-status-filter"
  ) {
    const p = new URLSearchParams();
    const jv = $("#applicant-filter")?.value,
      sv = $("#applicant-status-filter")?.value;
    if (jv) p.set("job_id", jv);
    if (sv) p.set("status", sv);
    location.hash = "#/employer/applicants" + (p.size ? "?" + p : "");
  }
});
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  }
});
// Pratinjau lowongan mengikuti setiap perubahan isian.
for (const type of ["input", "change"])
  document.addEventListener(type, (e) => {
    const form = e.target.closest?.("[data-form=job]"),
      preview = $("#job-preview");
    if (form && preview) preview.innerHTML = jobPreview(readJobForm(form));
  });
// Kolom gaji: pemisah ribuan saat mengetik, plus peringatan untuk angka yang janggal.
document.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.matches?.("[data-money]")) return;
  const before = el.value.slice(0, el.selectionStart).replace(/\D/g, "").length;
  const digits = el.value.replace(/\D/g, "").slice(0, 10);
  el.value = digits ? currency(digits) : "";
  let caret = 0;
  for (let seen = 0; caret < el.value.length && seen < before; caret++)
    if (/\d/.test(el.value[caret])) seen++;
  el.setSelectionRange(caret, caret);
  const form = el.closest("form"),
    hint = $(".salary-hint", form);
  if (!hint) return;
  const read = (n) => {
      const d = $("[name=" + n + "]", form).value.replace(/\D/g, "");
      return d === "" ? null : Number(d);
    },
    min = read("salary_min"),
    max = read("salary_max");
  const low = [min, max].find((v) => v != null && v > 0 && v < 100000);
  hint.classList.toggle(
    "warn",
    low != null || (min != null && max != null && min > max),
  );
  hint.textContent =
    min != null && max != null && min > max
      ? "Gaji minimum lebih besar dari gaji maksimum."
      : low != null
        ? "Rp" +
          currency(low) +
          " per bulan terlihat terlalu kecil. Periksa jumlah nolnya."
        : min != null || max != null
          ? "Rentang gaji: " +
            [min, max]
              .filter((v) => v != null)
              .map((v) => "Rp" + currency(v))
              .join(" – ") +
            " per bulan."
          : "";
});
for (const type of ["keydown", "keyup"])
  document.addEventListener(type, (e) => {
    const wrap = e.target.closest?.(".password-wrap");
    if (!wrap || !e.getModifierState) return;
    const warning = $(".caps-warning", wrap.parentElement);
    if (warning) warning.hidden = !e.getModifierState("CapsLock");
  });
window.addEventListener("hashchange", route);
async function loadBookmarks() {
  if (state.user && state.user.role === "user") {
    try {
      state.bookmarks = new Set(
        (await api("/bookmarks")).bookmarks.map((b) => b.job_id),
      );
    } catch {
      state.bookmarks = new Set();
    }
  } else {
    state.bookmarks = new Set();
  }
}
async function start() {
  try {
    const health = await api("/health");
    state.demo = health.demo;
    state.features = health.features || {};
    if (health.localQa)
      $("#demo-banner").textContent =
        "PENGUJIAN LOKAL · Data tersimpan setelah restart. Gunakan akun dan CV buatan. Email masuk ke Mailpit lokal (port 8025), bukan ke inbox asli.";
    else if (state.demo)
      $("#demo-banner").textContent =
        "MODE DEMO · Data contoh di database sementara. Tidak menggunakan data PostgreSQL Anda." +
        (health.features?.demoMail
          ? " Email demo masuk ke Mailpit lokal (port 8025), bukan ke inbox email asli."
          : "");
  } catch {}
  if (state.token) {
    try {
      state.user = await api("/profile");
      await loadBookmarks();
    } catch {
      clearSession();
    }
  }
  await route();
}
start();
