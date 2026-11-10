// Isolated PGlite database for tests and local demo. Never connects to PostgreSQL.
const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const { PGlite } = require("@electric-sql/pglite");
const { runner } = require("node-pg-migrate");
const { randomBytes } = require("crypto");
async function createSandbox() {
  const pg = new PGlite();
  await pg.waitReady;
  const uploadDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "openjob-sandbox-"),
  );
  process.env.OPENJOB_UPLOAD_DIRECTORY = uploadDirectory;
  process.env.ACCESS_TOKEN_KEY = randomBytes(32).toString("hex");
  process.env.REFRESH_TOKEN_KEY = randomBytes(32).toString("hex");
  process.env.PASSWORD_RESET_KEY = randomBytes(32).toString("hex");
  process.env.WEB_BASE_URL = "http://127.0.0.1:3100";
  const raw = async (sql, params) => {
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
  // Serialize entire transactions: PGlite owns one connection.
  let tail = Promise.resolve();
  async function acquire() {
    let release;
    const previous = tail;
    tail = new Promise((r) => {
      release = r;
    });
    await previous;
    return release;
  }
  const pool = {
    query: async (...args) => {
      const release = await acquire();
      try {
        return await raw(...args);
      } finally {
        release();
      }
    },
    connect: async () => {
      const release = await acquire();
      return { query: raw, release };
    },
    end: async () => {},
  };
  await runner({
    dbClient: { query: raw, connect: async () => {}, end: async () => {} },
    dir: path.resolve(__dirname, "../migrations"),
    direction: "up",
    migrationsTable: "pgmigrations",
    noLock: true,
    log: () => {},
  });
  require.cache[require.resolve("../src/database")] = { exports: pool };
  const cache = new Map();
  require.cache[require.resolve("../src/cache")] = {
    exports: {
      get: async (k) => (cache.has(k) ? JSON.parse(cache.get(k)) : null),
      set: async (k, v) => cache.set(k, JSON.stringify(v)),
      delete: async (...keys) => keys.forEach((k) => cache.delete(k)),
    },
  };
  return {
    pool,
    uploadDirectory,
    close: async () => {
      await pg.close();
      // Only the exact directory created by mkdtemp is ever removed.
      await fs.rm(uploadDirectory, { recursive: true, force: true });
    },
  };
}
async function seed(pool) {
  const hash = await require("bcrypt").hash("DemoOpenJob123!", 10);
  await pool.query(
    "INSERT INTO users(id,name,email,password_hash,role) VALUES('demo-applicant','Nadia Putri','pelamar@example.com',$1,'user'),('demo-employer','Arif Pratama','perekrut@example.com',$1,'employer')",
    [hash],
  );
  await pool.query(
    "UPDATE users SET email_verified_at=NOW() WHERE id IN ('demo-applicant','demo-employer')",
  );
  const companies = [
    [
      "studio-ruang",
      "Ruang Studio",
      "Jakarta",
      "Studio desain digital yang membantu bisnis menghadirkan pengalaman yang lebih manusiawi. Kami percaya ide hebat tumbuh dari kolaborasi.",
    ],
    [
      "nusa-digital",
      "Nusa Digital",
      "Bandung",
      "Tim teknologi yang membangun produk untuk kehidupan sehari-hari. Kami memberi ruang untuk belajar, bereksperimen, dan menghasilkan dampak.",
    ],
    [
      "akar-karya",
      "Akar Karya",
      "Jakarta",
      "Membangun bisnis berkelanjutan bersama tim yang peduli pada kualitas, pelanggan, dan pertumbuhan bersama.",
    ],
    [
      "orbit-labs",
      "Orbit Labs",
      "Yogyakarta",
      "Laboratorium produk digital dengan budaya kerja terbuka dan kolaboratif. Bergabunglah untuk mengubah ide menjadi solusi nyata.",
    ],
  ];
  for (const c of companies)
    await pool.query(
      "INSERT INTO companies(id,name,location,description,owner_id) VALUES($1,$2,$3,$4,'demo-employer')",
      c,
    );
  const jobs = [
    [
      "Product Designer",
      "studio-ruang",
      "category-design",
      "full-time",
      "mid",
      "hybrid",
      "Jakarta",
      8000000,
      12000000,
    ],
    [
      "Frontend Developer",
      "nusa-digital",
      "category-technology",
      "full-time",
      "junior",
      "remote",
      "Bandung",
      7000000,
      11000000,
    ],
    [
      "Digital Marketing Specialist",
      "akar-karya",
      "category-marketing",
      "full-time",
      "mid",
      "on-site",
      "Jakarta",
      6500000,
      9500000,
    ],
    [
      "Backend Developer",
      "orbit-labs",
      "category-technology",
      "full-time",
      "senior",
      "remote",
      "Yogyakarta",
      12000000,
      18000000,
    ],
    [
      "Finance Associate",
      "akar-karya",
      "category-finance",
      "full-time",
      "junior",
      "hybrid",
      "Jakarta",
      5500000,
      8000000,
    ],
    [
      "Customer Success Specialist",
      "nusa-digital",
      "category-customer",
      "full-time",
      "entry",
      "hybrid",
      "Bandung",
      5000000,
      7000000,
    ],
    [
      "Business Operations Intern",
      "orbit-labs",
      "category-business",
      "internship",
      "entry",
      "on-site",
      "Yogyakarta",
      2500000,
      3500000,
    ],
    [
      "Brand Designer",
      "studio-ruang",
      "category-design",
      "contract",
      "mid",
      "hybrid",
      "Jakarta",
      7000000,
      10000000,
    ],
    [
      "Software Engineer",
      "orbit-labs",
      "category-technology",
      "full-time",
      "mid",
      "remote",
      "Yogyakarta",
      10000000,
      16000000,
    ],
  ];
  for (let i = 0; i < jobs.length; i++) {
    const [title, company, category, type, level, location, city, min, max] =
      jobs[i];
    const description =
      "Tentang peran\nKami mencari " +
      title +
      " yang ingin tumbuh bersama tim dan menghasilkan pekerjaan yang bermakna.\n\nTanggung jawab\n• Berkolaborasi dengan tim lintas fungsi untuk menyelesaikan proyek.\n• Mengembangkan solusi dengan perhatian pada kualitas dan kebutuhan pengguna.\n• Berbagi ide, menerima masukan, dan terus meningkatkan hasil kerja.\n\nKualifikasi\n• Memiliki kemampuan yang relevan dengan posisi ini.\n• Komunikatif, teliti, dan nyaman bekerja bersama tim.\n• Portofolio atau pengalaman proyek menjadi nilai tambah.\n\nYang kami tawarkan\nLingkungan kolaboratif, kesempatan belajar, dan ruang untuk berkembang.\n\nIni adalah lowongan contoh untuk demonstrasi OpenJob.";
    await pool.query(
      "INSERT INTO jobs(id,owner_id,company_id,category_id,title,description,job_type,experience_level,location_type,location_city,salary_min,salary_max,is_salary_visible,created_at) VALUES($1,'demo-employer',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,CURRENT_TIMESTAMP - ($12 * INTERVAL '1 hour'))",
      [
        "demo-job-" + (i + 1),
        company,
        category,
        title,
        description,
        type,
        level,
        location,
        city,
        min,
        max,
        i,
      ],
    );
  }
}
module.exports = { createSandbox, seed };
