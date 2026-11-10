// Live local QA: PGlite by default; the explicit PostgreSQL QA preload uses its isolated database.
// Disposable RabbitMQ queues and Mailpit on loopback; no production SMTP or application database.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createRequire } = require("node:module");
const path = require("node:path");
const amqp = require("amqplib");
const { createSandbox, seed } = require("./sandbox.cjs");
const load = require("../tests/loadWithMocks.cjs");
const consumerRequire = createRequire(
  path.resolve(__dirname, "../../openjob_consumer/package.json"),
);
const nodemailer = consumerRequire("nodemailer");
async function waitFor(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Timed out: " + label);
}
(async () => {
  const sandbox = await createSandbox();
  let connection, channel, mailer, server;
  const prefix = "openjob.qa." + randomUUID();
  const QUEUE = prefix + ".created",
    STATUS_QUEUE = prefix + ".status",
    RESET_QUEUE = prefix + ".reset",
    VERIFY_QUEUE = prefix + ".verify";
  const queues = [
    QUEUE,
    STATUS_QUEUE,
    RESET_QUEUE,
    VERIFY_QUEUE,
    QUEUE + ".failed",
    STATUS_QUEUE + ".failed",
    RESET_QUEUE + ".failed",
    VERIFY_QUEUE + ".failed",
  ];
  const errors = [],
    pending = new Set();
  let acknowledged = 0;
  try {
    await seed(sandbox.pool);
    const emailTag = randomUUID();
    const candidateEmail = "candidate-" + emailTag + "@example.com";
    await sandbox.pool.query(
      "UPDATE users SET email=$1 WHERE id='demo-applicant'",
      [candidateEmail],
    );
    await sandbox.pool.query(
      "UPDATE users SET email=$1 WHERE id='demo-employer'",
      ["recruiter-" + emailTag + "@example.com"],
    );
    // Credential matches compose.dev.yml's local development service only.
    connection = await amqp.connect(
      "amqp://openjob:openjob_local_2026@127.0.0.1:5672",
      { timeout: 5000 },
    );
    connection.on("error", (e) => errors.push(e.message));
    channel = await connection.createConfirmChannel();
    channel.on("error", (e) => errors.push(e.message));
    for (const queue of queues)
      await channel.assertQueue(queue, { exclusive: true, autoDelete: true });
    await channel.prefetch(1);
    const mocks = {
      dotenv: { config() {} },
      "./database": sandbox.pool,
      "./rabbit": { QUEUE, STATUS_QUEUE, RESET_QUEUE, VERIFY_QUEUE },
    };
    const publisher = load("../src/publisher.js", mocks);
    const consumer = load("../../openjob_consumer/src/consumer.js", {
      ...mocks,
      nodemailer: {},
      "./resetLink": consumerRequire("./src/resetLink"),
    });
    mailer = nodemailer.createTransport({
      host: "127.0.0.1",
      port: 1025,
      secure: false,
      ignoreTLS: true,
      connectionTimeout: 5000,
      socketTimeout: 10000,
    });
    const actualEmails = [];
    const healthy = {
      sendMail: async (options) => {
        const result = await mailer.sendMail({
          ...options,
          from: "openjob-qa@example.test",
        });
        assert.equal(result.accepted.length, 1);
        actualEmails.push({
          to: options.to,
          subject: options.subject,
          messageId: options.messageId,
          text: options.text,
        });
        return result;
      },
    };
    let alwaysFail = false,
      failOnce = true,
      smtpFailures = 0;
    const activeMailer = {
      sendMail: async (options) => {
        if (alwaysFail || failOnce) {
          failOnce = false;
          smtpFailures++;
          throw Object.assign(Error("Simulated local SMTP outage"), {
            code: "ECONNECTION",
          });
        }
        return healthy.sendMail(options);
      },
    };
    const wrappedChannel = {
      sendToQueue: channel.sendToQueue.bind(channel),
      ack(message) {
        channel.ack(message);
        acknowledged++;
      },
    };
    for (const [queue, kind] of [
      [QUEUE, "created"],
      [STATUS_QUEUE, "status"],
      [RESET_QUEUE, "reset"],
      [VERIFY_QUEUE, "verify"],
    ]) {
      await channel.consume(queue, (message) => {
        const work = consumer.handleDelivery(
          wrappedChannel,
          queue,
          kind,
          message,
          activeMailer,
        );
        pending.add(work);
        work
          .catch((e) => errors.push(e.message))
          .finally(() => pending.delete(work));
      });
    }
    async function addApplication(id, job) {
      await sandbox.pool.query(
        "INSERT INTO applications(id,user_id,job_id,status) VALUES($1,'demo-applicant',$2,'pending')",
        [id, job],
      );
      await sandbox.pool.query(
        "INSERT INTO application_outbox(application_id) VALUES($1)",
        [id],
      );
    }
    async function state(id) {
      return (
        await sandbox.pool.query(
          "SELECT * FROM application_outbox WHERE application_id=$1",
          [id],
        )
      ).rows[0];
    }
    async function due(id) {
      await sandbox.pool.query(
        "UPDATE application_outbox SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE application_id=$1",
        [id],
      );
    }
    await addApplication("live-recover", "demo-job-1");
    await publisher.dispatch(channel);
    await waitFor(
      async () => (await state("live-recover")).failure_count === 1,
      "first SMTP failure",
    );
    assert.equal((await state("live-recover")).published_at, null);
    await publisher.dispatch(channel);
    assert.equal(actualEmails.length, 0);
    await due("live-recover");
    await publisher.dispatch(channel);
    await waitFor(
      async () => Boolean((await state("live-recover")).notified_at),
      "SMTP recovery",
    );
    assert.equal(actualEmails.length, 1);
    const event = randomUUID();
    await sandbox.pool.query(
      "INSERT INTO application_status_outbox(id,application_id,status) VALUES($1,'live-recover','interview')",
      [event],
    );
    await publisher.dispatch(channel);
    await waitFor(() => actualEmails.length === 2, "status email");
    await waitFor(
      async () =>
        Boolean(
          (
            await sandbox.pool.query(
              "SELECT notified_at FROM application_status_outbox WHERE id=$1",
              [event],
            )
          ).rows[0].notified_at,
        ),
      "status notification commit",
    );
    const before = acknowledged;
    await new Promise((resolve, reject) =>
      channel.sendToQueue(
        STATUS_QUEUE,
        Buffer.from(
          JSON.stringify({
            id: event,
            application_id: "live-recover",
            status: "interview",
          }),
        ),
        { persistent: true },
        (e) => (e ? reject(e) : resolve()),
      ),
    );
    await waitFor(() => acknowledged > before, "duplicate message ack");
    assert.equal(actualEmails.length, 2);
    alwaysFail = true;
    await addApplication("live-failed", "demo-job-2");
    for (let i = 1; i <= 3; i++) {
      if (i > 1) await due("live-failed");
      await publisher.dispatch(channel);
      await waitFor(
        async () => (await state("live-failed")).failure_count === i,
        "SMTP failure " + i,
      );
    }
    await waitFor(
      async () =>
        (await channel.checkQueue(QUEUE + ".failed")).messageCount === 1,
      "failed queue",
    );
    const failed = await channel.get(QUEUE + ".failed", { noAck: false });
    assert.equal(failed.properties.headers["x-openjob-failures"], 3);
    channel.ack(failed);
    assert.ok((await state("live-failed")).failed_at);
    const failuresBefore = smtpFailures;
    await publisher.dispatch(channel);
    assert.equal(smtpFailures, failuresBefore);
    await new Promise((resolve, reject) =>
      channel.sendToQueue(
        STATUS_QUEUE,
        Buffer.from("invalid JSON"),
        { persistent: true },
        (e) => (e ? reject(e) : resolve()),
      ),
    );
    await waitFor(
      async () =>
        (await channel.checkQueue(STATUS_QUEUE + ".failed")).messageCount === 1,
      "malformed message isolation",
    );
    const invalid = await channel.get(STATUS_QUEUE + ".failed", {
      noAck: false,
    });
    assert.equal(
      invalid.properties.headers["x-openjob-error"],
      "INVALID_MESSAGE",
    );
    channel.ack(invalid);
    alwaysFail = false;
    process.env.OPENJOB_DEMO = "0";
    server = await new Promise((resolve) => {
      const s = require("../src/server").listen(0, "127.0.0.1", () =>
        resolve(s),
      );
    });
    const base = "http://127.0.0.1:" + server.address().port;
    process.env.WEB_BASE_URL = base;
    async function post(route, body, method = "POST") {
      const response = await fetch(base + "/api" + route, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { code: response.status, body: await response.json() };
    }
    const login = await post("/authentications", {
      email: candidateEmail,
      password: "DemoOpenJob123!",
    });
    assert.equal(login.code, 200);
    const requested = await post("/password-resets", { email: candidateEmail });
    assert.equal(requested.code, 202);
    await publisher.dispatch(channel);
    await waitFor(() => actualEmails.length === 3, "password reset email");
    const resetEmail = actualEmails.find(
      (m) => m.subject === "Ganti password akun OpenJob",
    );
    assert.ok(resetEmail);
    const resetUrl = new URL(resetEmail.text.match(/http[^\s]+/)[0]);
    assert.equal(resetUrl.origin, base);
    const token = new URLSearchParams(resetUrl.hash.split("?")[1]).get("token");
    assert.ok(token);
    const confirmed = await post("/password-resets/confirm", {
      token,
      password: "LiveRecoveredPassword456!",
    });
    assert.equal(confirmed.code, 200);
    assert.equal(
      (
        await post("/password-resets/confirm", {
          token,
          password: "AnotherPassword123!",
        })
      ).code,
      400,
    );
    assert.equal(
      (
        await post(
          "/authentications",
          { refreshToken: login.body.data.refreshToken },
          "PUT",
        )
      ).code,
      400,
    );
    assert.equal(
      (
        await post("/authentications", {
          email: candidateEmail,
          password: "LiveRecoveredPassword456!",
        })
      ).code,
      200,
    );
    const verificationEmail = "verification-" + emailTag + "@example.com";
    assert.equal(
      (
        await post("/users", {
          name: "Email verification QA",
          email: verificationEmail,
          password: "VerificationLive123!",
        })
      ).code,
      201,
    );
    const verificationLogin = await post("/authentications", {
      email: verificationEmail,
      password: "VerificationLive123!",
    });
    assert.equal(verificationLogin.code, 200);
    const verificationHeaders = {
      Authorization: "Bearer " + verificationLogin.body.data.accessToken,
      "Content-Type": "application/json",
    };
    assert.equal(
      (
        await fetch(base + "/api/applications", {
          method: "POST",
          headers: verificationHeaders,
          body: "{}",
        })
      ).status,
      403,
    );
    await publisher.dispatch(channel);
    await waitFor(() => actualEmails.length === 4, "email verification");
    const verificationMail = actualEmails.find(
      (m) => m.to === verificationEmail,
    );
    assert.equal(verificationMail.subject, "Verifikasi email akun OpenJob");
    const verificationUrl = new URL(
      verificationMail.text.match(/http[^\s]+/)[0],
    );
    assert.equal(verificationUrl.origin, base);
    const verificationToken = new URLSearchParams(
      verificationUrl.hash.split("?")[1],
    ).get("token");
    assert.equal(
      (await post("/email-verifications/confirm", { token: verificationToken }))
        .code,
      200,
    );
    assert.equal(
      (await post("/email-verifications/confirm", { token: verificationToken }))
        .code,
      400,
    );
    const profile = await fetch(base + "/api/profile", {
      headers: verificationHeaders,
    }).then((r) => r.json());
    assert.ok(profile.data.email_verified_at);
    const inbox = await fetch("http://127.0.0.1:8025/api/v1/messages").then(
      async (r) => {
        assert.equal(r.status, 200);
        return r.json();
      },
    );
    assert.equal(
      inbox.messages.filter((m) =>
        m.To?.some((to) => to.Address?.includes(emailTag)),
      ).length,
      4,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          result: "PASS",
          smtpAccepted: actualEmails.length,
          emailVerificationVerified: true,
          passwordResetVerified: true,
          retryRecovered: true,
          duplicateSuppressed: true,
          maxFailures: 3,
          failedMessageSeparated: true,
          malformedMessageSeparated: true,
          mailpitVerified: true,
          temporaryDatabase: !sandbox.persistent,
          databaseKind: sandbox.databaseKind || "pglite",
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.allSettled([...pending]);
    if (channel) {
      for (const queue of queues)
        await channel.deleteQueue(queue).catch(() => {});
      await channel.close().catch(() => {});
    }
    if (connection) await connection.close().catch(() => {});
    if (mailer) mailer.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await sandbox.close();
  }
})().catch((e) => {
  console.error("Local notification QA failed:", e.message);
  process.exitCode = 1;
});
