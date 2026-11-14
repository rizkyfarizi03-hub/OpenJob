// Membuat tiga secret acak untuk diisi ke Environment Variables di Vercel.
// Jalankan sekali: node vercel/secrets.cjs
const { randomBytes } = require("crypto");
for (const name of [
  "ACCESS_TOKEN_KEY",
  "REFRESH_TOKEN_KEY",
  "PASSWORD_RESET_KEY",
])
  console.log(name + "=" + randomBytes(32).toString("hex"));
