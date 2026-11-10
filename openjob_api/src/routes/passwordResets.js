const router = require("express").Router();
const Joi = require("joi");
const bcrypt = require("bcrypt");
const { randomUUID } = require("crypto");
const pool = require("../database");
const tokens = require("../resetTokens");
const fail = (res, code, message) =>
  res.status(code).json({ status: "failed", message });
const generic =
  "Jika email terdaftar, tautan untuk mengganti password akan dikirim. Periksa kotak masuk Anda.";
const attempts = new Map();
function limited(req, res, kind) {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  const limit = kind === "request" ? 10 : 20,
    key = kind + ":" + req.ip;
  const current = attempts.get(key) || {
    count: 0,
    until: now + 15 * 60 * 1000,
  };
  if (current.count >= limit) {
    res.set("Retry-After", String(Math.ceil((current.until - now) / 1000)));
    fail(res, 429, "Terlalu banyak percobaan. Silakan coba lagi nanti.");
    return true;
  }
  current.count++;
  attempts.set(key, current);
  return false;
}
router.post("/", async (req, res, next) => {
  if (limited(req, res, "request")) return;
  const { error, value } = Joi.object({
    email: Joi.string().trim().lowercase().email().max(255).required(),
  }).validate(req.body);
  if (error) return fail(res, 400, "Masukkan alamat email yang valid");
  try {
    tokens.key();
    tokens.baseUrl();
  } catch {
    return fail(
      res,
      503,
      "Pemulihan akun belum tersedia. Silakan coba lagi nanti.",
    );
  }
  if (process.env.OPENJOB_DEMO === "1" && process.env.OPENJOB_DEMO_MAIL !== "1")
    return fail(res, 503, "Pengiriman email belum tersedia pada demo ini.");
  let db;
  const respondAt = Date.now() + 250;
  try {
    db = await pool.connect();
    await db.query("BEGIN");
    const { rows } = await db.query(
      "SELECT id,email FROM users WHERE email=$1 FOR UPDATE",
      [value.email],
    );
    const user = rows[0];
    if (user) {
      const recent = await db.query(
        "SELECT id FROM password_reset_requests WHERE user_id=$1 AND created_at>NOW()-INTERVAL '1 minute' LIMIT 1",
        [user.id],
      );
      if (!recent.rowCount) {
        const id = randomUUID(),
          token = tokens.tokenFor(id);
        await db.query(
          "UPDATE password_reset_requests SET invalidated_at=NOW() WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL",
          [user.id],
        );
        await db.query(
          "INSERT INTO password_reset_requests(id,user_id,email,token_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '30 minutes')",
          [id, user.id, user.email, tokens.hash(token)],
        );
      }
    }
    await db.query("COMMIT");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, respondAt - Date.now())),
    );
    res.set("Cache-Control", "no-store");
    res.status(202).json({ status: "success", message: generic });
  } catch (e) {
    if (db) await db.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    db?.release();
  }
});
router.post("/confirm", async (req, res, next) => {
  if (limited(req, res, "confirm")) return;
  const { error, value } = Joi.object({
    token: Joi.string()
      .pattern(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-f0-9]{64}$/,
      )
      .required(),
    password: Joi.string()
      .min(8)
      .custom((v, h) =>
        Buffer.byteLength(v) <= 72 ? v : h.error("string.max", { limit: 72 }),
      )
      .required(),
  }).validate(req.body);
  if (error)
    return fail(
      res,
      400,
      "Tautan tidak valid atau password belum memenuhi syarat (minimal 8 karakter, maksimal 72 byte).",
    );
  let db;
  try {
    const tokenHash = tokens.hash(value.token),
      id = value.token.split(".")[0];
    db = await pool.connect();
    await db.query("BEGIN");
    const lookup = await db.query(
      "SELECT user_id FROM password_reset_requests WHERE id=$1 AND token_hash=$2",
      [id, tokenHash],
    );
    if (!lookup.rowCount) {
      await db.query("ROLLBACK");
      return fail(
        res,
        400,
        "Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.",
      );
    }
    // Match the lock order used by login, profile updates and reset requests.
    const user = await db.query(
      "SELECT id,email FROM users WHERE id=$1 FOR UPDATE",
      [lookup.rows[0].user_id],
    );
    const valid = await db.query(
      "SELECT id FROM password_reset_requests WHERE id=$1 AND token_hash=$2 AND email=$3 AND used_at IS NULL AND invalidated_at IS NULL AND expires_at>NOW() FOR UPDATE",
      [id, tokenHash, user.rows[0]?.email || ""],
    );
    if (!valid.rowCount) {
      await db.query("ROLLBACK");
      return fail(
        res,
        400,
        "Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.",
      );
    }
    const passwordHash = await bcrypt.hash(value.password, 10),
      userId = lookup.rows[0].user_id;
    await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      passwordHash,
      userId,
    ]);
    await db.query("DELETE FROM auth_sessions WHERE user_id=$1", [userId]);
    await db.query(
      "UPDATE password_reset_requests SET used_at=NOW() WHERE id=$1",
      [id],
    );
    await db.query(
      "UPDATE password_reset_requests SET invalidated_at=NOW() WHERE user_id=$1 AND id<>$2 AND used_at IS NULL AND invalidated_at IS NULL",
      [userId, id],
    );
    await db.query("COMMIT");
    res.set("Cache-Control", "no-store");
    res.json({
      status: "success",
      message: "Password berhasil diganti. Silakan masuk kembali.",
    });
  } catch (e) {
    if (db) await db.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    db?.release();
  }
});
module.exports = router;
