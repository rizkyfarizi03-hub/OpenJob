const express = require("express");
const Joi = require("joi");
const bcrypt = require("bcrypt");
const { randomUUID } = require("crypto");
const pool = require("../database");
const verify = require("../middlewares/verifyToken");
const cachedResponse = require("../cachedResponse");
const scope = require("../cacheScope");
const router = express.Router();
const password = Joi.string()
  .min(8)
  .custom((v, h) =>
    Buffer.byteLength(v, "utf8") <= 72
      ? v
      : h.error("string.max", { limit: 72 }),
  );
const email = Joi.string().trim().lowercase().email();
const name = Joi.string().trim().min(1).max(255);
const fail = (res, code, message) =>
  res.status(code).json({ status: "failed", message });
router.post("/", async (req, res, next) => {
  const { error, value } = Joi.object({
    name: name.required(),
    email: email.required(),
    password: password.required(),
    role: Joi.string().valid("user", "employer").default("user"),
  }).validate(req.body);
  if (error) return fail(res, 400, error.message);
  let client;
  try {
    const id = randomUUID(),
      hashed = await bcrypt.hash(value.password, 10);
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
      [id, value.name, value.email, hashed, value.role],
    );
    const requests = require("../verificationRequests"),
      queued =
        requests.configured() &&
        (process.env.OPENJOB_DEMO !== "1" ||
          process.env.OPENJOB_DEMO_MAIL === "1");
    if (queued) await requests.enqueue(client, { id, email: value.email });
    await client.query("COMMIT");
    res
      .status(201)
      .json({ status: "success", data: { id, verificationQueued: queued } });
  } catch (e) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (e.code === "23505") return fail(res, 400, "Email sudah terdaftar");
    next(e);
  } finally {
    client?.release();
  }
});
router.get("/:id", verify, async (req, res, next) => {
  if (req.params.id !== req.userId)
    return fail(res, 403, "Tidak memiliki akses");
  try {
    await cachedResponse(
      res,
      await scope.key(scope.account(req.userId), "user"),
      async () => {
        const r = await pool.query(
          "SELECT id,name,email,role,created_at,email_verified_at FROM users WHERE id=$1",
          [req.userId],
        );
        return r.rowCount ? { status: "success", data: r.rows[0] } : null;
      },
      "Pengguna tidak ditemukan",
    );
  } catch (e) {
    next(e);
  }
});
router.put("/:id", verify, async (req, res, next) => {
  if (req.params.id !== req.userId)
    return fail(res, 403, "Tidak memiliki akses");
  const { error, value } = Joi.object({
    name,
    email,
    password,
    current_password: Joi.string().custom((v, h) =>
      Buffer.byteLength(v, "utf8") <= 72
        ? v
        : h.error("string.max", { limit: 72 }),
    ),
  })
    .or("name", "email", "password")
    .validate(req.body);
  if (error) return fail(res, 400, error.message);
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const r = await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
      req.userId,
    ]);
    const user = r.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return fail(res, 404, "Pengguna tidak ditemukan");
    }
    const sensitive =
      !!value.password ||
      (value.email !== undefined && value.email !== user.email);
    if (
      sensitive &&
      (!value.current_password ||
        !(await bcrypt.compare(value.current_password, user.password_hash)))
    ) {
      await client.query("ROLLBACK");
      return fail(
        res,
        400,
        "Masukkan password saat ini dengan benar untuk mengganti email atau password",
      );
    }
    const hashed = value.password
      ? await bcrypt.hash(value.password, 10)
      : null;
    await client.query(
      "UPDATE users SET name=COALESCE($1,name),email=COALESCE($2,email),password_hash=COALESCE($3,password_hash) WHERE id=$4",
      [value.name ?? null, value.email ?? null, hashed, req.userId],
    );
    if (value.email !== undefined && value.email !== user.email) {
      await client.query(
        "UPDATE users SET email_verified_at=NULL WHERE id=$1",
        [req.userId],
      );
      await client.query(
        "UPDATE email_verification_requests SET invalidated_at=NOW() WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL",
        [req.userId],
      );
      const requests = require("../verificationRequests");
      if (
        requests.configured() &&
        (process.env.OPENJOB_DEMO !== "1" ||
          process.env.OPENJOB_DEMO_MAIL === "1")
      )
        await requests.enqueue(client, { id: req.userId, email: value.email });
    }
    if (sensitive) {
      await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [
        req.userId,
      ]);
      await client.query(
        "UPDATE password_reset_requests SET invalidated_at=NOW() WHERE user_id=$1 AND used_at IS NULL AND invalidated_at IS NULL",
        [req.userId],
      );
    }
    await client.query("COMMIT");
    client.release();
    client = undefined; // invalidasi memakai pool; lepaskan koneksi transaksi dulu
    await scope.userChanged(req.userId);
    res.json({
      status: "success",
      data: { reauthenticate: sensitive },
      message: "Profil berhasil diperbarui",
    });
  } catch (e) {
    if (client) await client.query("ROLLBACK");
    if (e.code === "23505") return fail(res, 409, "Email sudah terdaftar");
    next(e);
  } finally {
    client?.release();
  }
});
module.exports = router;
