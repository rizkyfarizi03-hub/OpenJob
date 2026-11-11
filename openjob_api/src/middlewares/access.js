const pool = require("../database");

async function identity(req, res, next) {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email, role,email_verified_at FROM users WHERE id=$1",
      [req.userId],
    );
    if (!rows.length)
      return res
        .status(401)
        .json({ status: "failed", message: "Akun tidak ditemukan" });
    req.account = rows[0];
    next();
  } catch (error) {
    next(error);
  }
}
const roles =
  (...allowed) =>
  (req, res, next) => {
    if (!allowed.includes(req.account.role))
      return res
        .status(403)
        .json({ status: "failed", message: "Akun ini tidak memiliki akses" });
    next();
  };
const verified = (req, res, next) => {
  if (!req.account.email_verified_at)
    return res.status(403).json({
      status: "failed",
      code: "EMAIL_VERIFICATION_REQUIRED",
      message:
        "Verifikasi email Anda sebelum melamar atau menerbitkan lowongan.",
    });
  next();
};
module.exports = { identity, roles, verified };
