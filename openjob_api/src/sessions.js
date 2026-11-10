const jwt = require("jsonwebtoken");
const { randomUUID, createHash } = require("crypto");
const hash = (token) => createHash("sha256").update(token).digest("hex");
function tokens(id, sid, expiresAt) {
  return {
    accessToken: jwt.sign({ id, sid }, process.env.ACCESS_TOKEN_KEY, {
      expiresIn: "15m",
    }),
    refreshToken: jwt.sign(
      {
        id,
        sid,
        jti: randomUUID(),
        exp: Math.floor(new Date(expiresAt).getTime() / 1000),
      },
      process.env.REFRESH_TOKEN_KEY,
    ),
  };
}
module.exports = { hash, tokens };
