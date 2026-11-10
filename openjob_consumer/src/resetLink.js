const { createHmac, createHash } = require("crypto");
function link(row, purpose, page) {
  const secret = process.env.PASSWORD_RESET_KEY;
  if (!secret || Buffer.byteLength(secret) < 32)
    throw Object.assign(Error("Reset key belum dikonfigurasi"), {
      code: "RESET_CONFIGURATION",
    });
  const url = new URL(process.env.WEB_BASE_URL);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw Object.assign(Error("Reset origin tidak valid"), {
      code: "RESET_CONFIGURATION",
    });
  const token =
    row.id +
    "." +
    createHmac("sha256", secret)
      .update("openjob-" + purpose + ":" + row.id)
      .digest("hex");
  if (createHash("sha256").update(token).digest("hex") !== row.token_hash)
    throw Object.assign(Error("Reset key tidak cocok dengan API"), {
      code: "RESET_KEY_MISMATCH",
    });
  return url.origin + "/#/" + page + "?token=" + encodeURIComponent(token);
}
module.exports = (row) => link(row, "password-reset", "reset-password");
module.exports.verification = (row) =>
  link(row, "email-verification", "verify-email");
