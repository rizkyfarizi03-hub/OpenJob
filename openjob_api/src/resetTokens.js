const { createHmac, createHash } = require("crypto");
function key() {
  const secret = process.env.PASSWORD_RESET_KEY;
  if (!secret || Buffer.byteLength(secret) < 32)
    throw Error("PASSWORD_RESET_KEY wajib diisi minimal 32 byte");
  return secret;
}
const tokenFor = (id, purpose = "password-reset") =>
  id +
  "." +
  createHmac("sha256", key())
    .update("openjob-" + purpose + ":" + id)
    .digest("hex");
const hash = (token) => createHash("sha256").update(token).digest("hex");
function baseUrl() {
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
    throw Error("WEB_BASE_URL wajib berupa origin HTTPS atau localhost");
  return url.origin;
}
module.exports = { key, tokenFor, hash, baseUrl };
