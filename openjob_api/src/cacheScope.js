const { randomUUID } = require("crypto");
const cache = require("./cache");
const pool = require("./database");

// Redis hanya optimasi: bila lambat atau mati, request tetap dilayani PostgreSQL.
const TIMEOUT_MS = 500;
const PAUSE_MS = 10000;
let pausedUntil = 0;

// Penghapusan yang belum sampai ke Redis. Kuncinya tidak boleh dilayani dari cache.
const pending = new Set();

async function attempt(action) {
  if (Date.now() < pausedUntil) return undefined;
  let timer;
  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("timeout")), TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    pausedUntil = Date.now() + PAUSE_MS;
    console.error("Cache dilewati sementara:", error.message);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function flush() {
  if (pending.size === 0) return;
  const keys = [...pending];
  const done = await attempt(async () => {
    await cache.delete(...keys);
    return true;
  });
  if (done) keys.forEach((key) => pending.delete(key));
}

const read = (key) => attempt(() => cache.get(key));

const write = (key, value) =>
  attempt(async () => {
    await cache.set(key, value);
    return true;
  });

/**
 * Kunci data di dalam sebuah scope. Setiap scope punya versi; menghapus versi
 * membuat seluruh isi scope tidak terpakai tanpa perlu tahu daftar kuncinya.
 * Mengembalikan null bila cache harus dilewati.
 */
async function key(scope, name) {
  const versionKey = "scope:" + scope;
  await flush();
  if (pending.has(versionKey)) return null;
  let version = await read(versionKey);
  if (version === undefined) return null;
  if (version === null) {
    version = randomUUID();
    if (!(await write(versionKey, version))) return null;
  }
  return `${scope}:${version}:${name}`;
}

async function invalidate(...scopes) {
  for (const scope of new Set(scopes)) pending.add("scope:" + scope);
  await flush();
}

const account = (userId) => "account:" + userId;
const company = (companyId) => "company:" + companyId;

const invalidateAccounts = (...userIds) =>
  invalidate(...userIds.filter(Boolean).map(account));

// Akun lain yang responsnya memuat data milik sebuah lowongan, perusahaan, atau pengguna.
const related = {
  job: `SELECT user_id AS id FROM applications WHERE job_id=$1
        UNION SELECT user_id FROM bookmarks WHERE job_id=$1`,
  company: `SELECT a.user_id AS id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE j.company_id=$1
        UNION SELECT b.user_id FROM bookmarks b JOIN jobs j ON j.id=b.job_id WHERE j.company_id=$1`,
  user: `SELECT j.owner_id AS id FROM applications a JOIN jobs j ON j.id=a.job_id
        WHERE a.user_id=$1 AND j.owner_id IS NOT NULL`,
};

async function accountsRelatedTo(kind, id) {
  const { rows } = await pool.query(related[kind], [id]);
  return rows.map((row) => row.id);
}

// Dipanggil setelah COMMIT; kegagalan di sini tidak boleh menggagalkan respons.
async function changed(kind, id, ownerId) {
  try {
    if (kind === "company") await invalidate(company(id));
    await invalidateAccounts(ownerId, ...(await accountsRelatedTo(kind, id)));
  } catch (error) {
    console.error("Invalidasi cache gagal:", error.message);
  }
}

module.exports = {
  read,
  write,
  key,
  invalidate,
  account,
  company,
  invalidateAccounts,
  accountsRelatedTo,
  jobChanged: (jobId, ownerId) => changed("job", jobId, ownerId),
  companyChanged: (companyId, ownerId) => changed("company", companyId, ownerId),
  userChanged: (userId) => changed("user", userId, userId),
};
