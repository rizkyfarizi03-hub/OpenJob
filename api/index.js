// Titik masuk Vercel. API dan fungsi kirim email consumer berjalan dalam satu fungsi,
// tanpa RabbitMQ dan Redis. Jalur lokal tetap memakai publisher dan consumer terpisah;
// file ini hanya menyusun keduanya, seperti launcher di openjob_api/dev.

// CV disimpan di database karena Vercel tidak punya disk permanen.
process.env.OPENJOB_DOCUMENT_STORAGE = "database";
if (!process.env.WEB_BASE_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL)
  process.env.WEB_BASE_URL =
    "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL;

const required = [
  "DATABASE_URL",
  "ACCESS_TOKEN_KEY",
  "REFRESH_TOKEN_KEY",
  "PASSWORD_RESET_KEY",
  "WEB_BASE_URL",
  "MAIL_HOST",
  "MAIL_PORT",
  "MAIL_USER",
  "MAIL_PASSWORD",
];
const missing = required.filter((name) => !process.env[name]);

// Tanpa Redis: cache tidak menyimpan apa pun, jadi semua data dibaca dari PostgreSQL.
require.cache[require.resolve("../openjob_api/src/cache")] = {
  exports: {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
  },
};
const pool = require("../openjob_api/src/database");
// Consumer memakai koneksi database yang sama dengan API.
require.cache[require.resolve("../openjob_consumer/src/database")] = {
  exports: pool,
};
const consumer = require("../openjob_consumer/src/consumer");
const nodemailer = require("../openjob_consumer/node_modules/nodemailer");
const app = require("../openjob_api/src/server");

let functions = {};
try {
  functions = require("@vercel/functions");
} catch {
  // Di luar Vercel paket ini boleh tidak ada.
}
const waitUntil = functions.waitUntil || ((promise) => promise);
if (functions.attachDatabasePool) functions.attachDatabasePool(pool);

// Vercel menulis ulang X-Forwarded-For dengan IP pengunjung, jadi pembatasan
// percobaan login dan pendaftaran tetap dihitung per pengunjung.
app.set("trust proxy", 1);

const transport =
  missing.length === 0 &&
  nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT),
    secure: Number(process.env.MAIL_PORT) === 465,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
// Alamat contoh (example.com, *.test) tidak pernah dikirimi email sungguhan.
const fake = (address) =>
  /@(example\.(com|org|net)|[^@\s]+\.(test|example|invalid))$/i.test(
    String(address).trim(),
  );
const mailer = {
  sendMail: (options) =>
    fake(options.to)
      ? Promise.resolve({ skipped: true })
      : transport.sendMail(options),
};

const ready =
  "notified_at IS NULL AND failed_at IS NULL AND next_attempt_at<=NOW()";
const account =
  " AND used_at IS NULL AND invalidated_at IS NULL AND expires_at>NOW()";
const outboxes = [
  [
    "SELECT application_id FROM application_outbox WHERE " + ready,
    consumer.notify,
  ],
  [
    "SELECT id,application_id,status FROM application_status_outbox WHERE " +
      ready,
    consumer.notifyStatus,
  ],
  [
    "SELECT id FROM password_reset_requests WHERE " + ready + account,
    consumer.notifyReset,
  ],
  [
    "SELECT id FROM email_verification_requests WHERE " + ready + account,
    consumer.notifyVerification,
  ],
];
// Mengirim semua email yang siap. Status, percobaan ulang, dan batas gagal tetap
// dicatat oleh fungsi consumer di tabel yang sama dengan jalur RabbitMQ.
async function drainOnce() {
  for (const [sql, deliver] of outboxes) {
    const { rows } = await pool.query(
      sql + " ORDER BY next_attempt_at LIMIT 20",
    );
    for (const row of rows) {
      try {
        await deliver({ content: Buffer.from(JSON.stringify(row)) }, mailer);
      } catch (e) {
        console.error("Email belum terkirim:", e.code || e.message);
      }
    }
  }
}
let running, again;
function drain() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await drainOnce();
    } while (again);
  })()
    .catch((e) => console.error("Antrean email:", e.code || e.message))
    .finally(() => {
      running = null;
    });
  return running;
}

function handler(req, res) {
  if (missing.length) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end(
      "OpenJob belum dikonfigurasi. Environment variable yang belum diisi: " +
        missing.join(", "),
    );
  }
  // Setiap perubahan yang berhasil bisa menjadwalkan email; kirim setelah respons selesai.
  if (req.method !== "GET" && req.method !== "HEAD")
    res.on("finish", () => {
      if (res.statusCode < 400) waitUntil(drain());
    });
  return app(req, res);
}
handler.drain = drain;
module.exports = handler;
