const router = require("express").Router();
const Joi = require("joi");
const pool = require("../database");
const verify = require("../middlewares/verifyToken");
const tokens = require("../resetTokens");
const requests = require("../verificationRequests");
const scope = require("../cacheScope");
const fail = (res, code, message) =>
  res.status(code).json({ status: "failed", message });
const attempts = new Map();
function limited(req, res, kind) {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  const key = kind + ":" + (kind === "send" ? req.userId : req.ip),
    entry = attempts.get(key) || { count: 0, until: now + 15 * 60000 };
  if (entry.count >= 20) {
    res.set("Retry-After", String(Math.ceil((entry.until - now) / 1000)));
    fail(res, 429, "Terlalu banyak percobaan. Silakan coba lagi nanti.");
    return true;
  }
  entry.count++;
  attempts.set(key, entry);
  return false;
}
router.post("/", verify, async (req, res, next) => {
  if (limited(req, res, "send")) return;
  let db;
  try {
    db = await pool.connect();
    await db.query("BEGIN");
    const { rows } = await db.query(
      "SELECT id,email,email_verified_at FROM users WHERE id=$1 FOR UPDATE",
      [req.userId],
    );
    const user = rows[0];
    if (!user) {
      await db.query("ROLLBACK");
      return fail(res, 401, "Silakan masuk kembali");
    }
    if (user.email_verified_at) {
      await db.query("COMMIT");
      return res.json({
        status: "success",
        message: "Email Anda sudah terverifikasi.",
      });
    }
    if (
      !requests.configured() ||
      (process.env.OPENJOB_DEMO === "1" &&
        process.env.OPENJOB_DEMO_MAIL !== "1")
    ) {
      await db.query("ROLLBACK");
      return fail(
        res,
        503,
        "Pengiriman email verifikasi belum tersedia. Silakan coba lagi nanti.",
      );
    }
    const recent = await db.query(
      "SELECT id FROM email_verification_requests WHERE user_id=$1 AND email=$2 AND created_at>NOW()-INTERVAL '1 minute' LIMIT 1",
      [user.id, user.email],
    );
    if (!recent.rowCount) await requests.enqueue(db, user);
    await db.query("COMMIT");
    res.status(202).json({
      status: "success",
      message:
        "Email verifikasi telah dijadwalkan. Periksa kotak masuk Anda. Jika baru meminta email, tunggu satu menit sebelum mengirim ulang.",
    });
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
  }).validate(req.body);
  if (error)
    return fail(
      res,
      400,
      "Tautan verifikasi tidak valid. Minta tautan baru dari akun Anda.",
    );
  let db;
  try {
    const hash = tokens.hash(value.token),
      id = value.token.split(".")[0];
    db = await pool.connect();
    await db.query("BEGIN");
    const lookup = await db.query(
      "SELECT user_id FROM email_verification_requests WHERE id=$1 AND token_hash=$2",
      [id, hash],
    );
    if (!lookup.rowCount) {
      await db.query("ROLLBACK");
      return fail(
        res,
        400,
        "Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.",
      );
    }
    const user = await db.query(
      "SELECT id,email FROM users WHERE id=$1 FOR UPDATE",
      [lookup.rows[0].user_id],
    );
    const valid = await db.query(
      "SELECT id FROM email_verification_requests WHERE id=$1 AND token_hash=$2 AND email=$3 AND expires_at>NOW() AND used_at IS NULL AND invalidated_at IS NULL FOR UPDATE",
      [id, hash, user.rows[0]?.email || ""],
    );
    if (!valid.rowCount) {
      await db.query("ROLLBACK");
      return fail(
        res,
        400,
        "Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.",
      );
    }
    await db.query("UPDATE users SET email_verified_at=NOW() WHERE id=$1", [
      lookup.rows[0].user_id,
    ]);
    await db.query(
      "UPDATE email_verification_requests SET used_at=NOW() WHERE id=$1",
      [id],
    );
    await db.query(
      "UPDATE email_verification_requests SET invalidated_at=NOW() WHERE user_id=$1 AND id<>$2 AND used_at IS NULL AND invalidated_at IS NULL",
      [lookup.rows[0].user_id, id],
    );
    await db.query("COMMIT");
    db.release();
    db = undefined;
    await scope.userChanged(lookup.rows[0].user_id);
    res.set("Cache-Control", "no-store");
    res.json({
      status: "success",
      message:
        "Email berhasil diverifikasi. Anda sekarang bisa melamar atau menerbitkan lowongan.",
    });
  } catch (e) {
    if (db) await db.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    db?.release();
  }
});
module.exports = router;
