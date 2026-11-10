const path = require("node:path");
const { createRequire } = require("node:module");
const load = require("../tests/loadWithMocks.cjs");
module.exports = (sandbox) => {
  const consumerRequire = createRequire(
    path.resolve(__dirname, "../../openjob_consumer/package.json"),
  );
  const mailer = consumerRequire("nodemailer").createTransport({
    host: "127.0.0.1",
    port: 1025,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 5000,
    socketTimeout: 10000,
  });
  const consumer = load("../../openjob_consumer/src/consumer.js", {
    dotenv: { config() {} },
    nodemailer: {},
    "./database": sandbox.pool,
    "./rabbit": {},
    "./resetLink": consumerRequire("./src/resetLink"),
  });
  let running;
  const run = () => {
    if (running) return;
    running = (async () => {
      for (const [table, notify] of [
        ["password_reset_requests", consumer.notifyReset],
        ["email_verification_requests", consumer.notifyVerification],
      ]) {
        const { rows } = await sandbox.pool.query(
          "SELECT id FROM " +
            table +
            " WHERE notified_at IS NULL AND failed_at IS NULL AND used_at IS NULL AND invalidated_at IS NULL AND expires_at>NOW() AND next_attempt_at<=NOW()",
        );
        for (const { id } of rows)
          await notify(
            { content: Buffer.from(JSON.stringify({ id })) },
            {
              sendMail: (options) =>
                mailer.sendMail({
                  ...options,
                  from: "openjob-demo@example.test",
                }),
            },
          );
      }
    })()
      .catch((e) => console.error("Demo reset mail:", e.code || e.name))
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(run, 1000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    if (running) await running;
    mailer.close();
  };
};
