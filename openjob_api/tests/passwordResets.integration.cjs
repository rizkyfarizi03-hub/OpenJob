const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("../dev/sandbox.cjs");
const load = require("./loadWithMocks.cjs");
test("password recovery: private requests, queued email, expiry, single use and session revocation", async (t) => {
  const sandbox = await createSandbox();
  process.env.OPENJOB_DEMO = "0";
  const tokens = require("../src/resetTokens");
  const app = require("../src/server"),
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
  const base = "http://127.0.0.1:" + server.address().port;
  process.env.WEB_BASE_URL = base;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await sandbox.close();
  });
  async function call(path, body, method = "POST", access) {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(access ? { Authorization: "Bearer " + access } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { code: response.status, body: await response.json() };
  }
  const email = "reset-user@example.com",
    password = "OriginalPassword123!",
    newPassword = "RecoveredPassword456!";
  const user = await call("/users", { name: "Recovery User", email, password });
  assert.equal(user.code, 201);
  const userId = user.body.data.id;
  const first = await call("/authentications", { email, password }),
    second = await call("/authentications", { email, password });
  async function latest() {
    return (
      await sandbox.pool.query(
        "SELECT * FROM password_reset_requests WHERE user_id=$1 ORDER BY created_at DESC",
        [userId],
      )
    ).rows[0];
  }
  async function cooldown() {
    await sandbox.pool.query(
      "UPDATE password_reset_requests SET created_at=NOW()-INTERVAL '2 minutes' WHERE user_id=$1",
      [userId],
    );
  }
  const unknown = await call("/password-resets", {
      email: "unknown@example.com",
    }),
    known = await call("/password-resets", { email: email.toUpperCase() });
  assert.equal(unknown.code, 202);
  assert.deepEqual(unknown, known);
  assert.ok(!JSON.stringify(known).includes("token"));
  await call("/password-resets", { email });
  assert.equal(
    (await sandbox.pool.query("SELECT id FROM password_reset_requests"))
      .rowCount,
    1,
  );
  let request = await latest(),
    token = tokens.tokenFor(request.id);
  assert.equal(request.token_hash, tokens.hash(token));
  assert.notEqual(request.token_hash, token);
  assert.ok(
    new Date(request.expires_at) - new Date(request.created_at) >= 29 * 60000,
  );
  const RESET_QUEUE = "openjob.account.password_reset",
    sent = [];
  const rabbit = {
    QUEUE: "openjob.application.created",
    STATUS_QUEUE: "openjob.application.status_changed",
    RESET_QUEUE,
    VERIFY_QUEUE: "openjob.account.email_verification",
  };
  const publisher = load("../src/publisher.js", {
    dotenv: { config() {} },
    "./database": sandbox.pool,
    "./rabbit": rabbit,
  });
  const consumer = load("../../openjob_consumer/src/consumer.js", {
    dotenv: { config() {} },
    nodemailer: {},
    "./database": sandbox.pool,
    "./rabbit": rabbit,
    "./resetLink": require("../../openjob_consumer/src/resetLink"),
  });
  const channel = {
    sendToQueue(queue, content, options, cb) {
      sent.push({ queue, content });
      cb(null);
    },
  };
  await publisher.dispatch(channel);
  const resetMessage = sent.find((m) => m.queue === RESET_QUEUE);
  assert.ok(resetMessage);
  assert.deepEqual(JSON.parse(resetMessage.content), { id: request.id });
  const failed = await consumer.notifyReset(resetMessage, {
    sendMail: async () => {
      throw Object.assign(Error("SMTP unavailable"), { code: "ETIMEDOUT" });
    },
  });
  assert.equal(failed.action, "retry");
  assert.equal((await latest()).failure_count, 1);
  await sandbox.pool.query(
    "UPDATE password_reset_requests SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id=$1",
    [request.id],
  );
  const emails = [];
  await consumer.notifyReset(resetMessage, {
    sendMail: async (m) => emails.push(m),
  });
  await consumer.notifyReset(resetMessage, {
    sendMail: async (m) => emails.push(m),
  });
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, email);
  const link = emails[0].text.match(/http[^\s]+/)[0],
    url = new URL(link);
  assert.equal(url.origin, base);
  assert.equal(new URLSearchParams(url.hash.split("?")[1]).get("token"), token);
  assert.equal(
    (
      await call("/password-resets/confirm", {
        token: token.slice(0, -1) + "x",
        password: newPassword,
      })
    ).code,
    400,
  );
  for (const pass of ["short", "a".repeat(73), "界".repeat(25)])
    assert.equal(
      (await call("/password-resets/confirm", { token, password: pass })).code,
      400,
    );
  const results = await Promise.all([
    call("/password-resets/confirm", { token, password: newPassword }),
    call("/password-resets/confirm", { token, password: newPassword }),
  ]);
  assert.deepEqual(results.map((r) => r.code).sort(), [200, 400]);
  for (const session of [first, second]) {
    assert.equal(
      (await call("/profile", null, "GET", session.body.data.accessToken)).code,
      401,
    );
    assert.equal(
      (
        await call(
          "/authentications",
          { refreshToken: session.body.data.refreshToken },
          "PUT",
        )
      ).code,
      400,
    );
  }
  assert.equal((await call("/authentications", { email, password })).code, 401);
  const login = await call("/authentications", {
    email,
    password: newPassword,
  });
  assert.equal(login.code, 200);
  await cooldown();
  await call("/password-resets", { email });
  request = await latest();
  token = tokens.tokenFor(request.id);
  await sandbox.pool.query(
    "UPDATE password_reset_requests SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
    [request.id],
  );
  assert.equal(
    (
      await call("/password-resets/confirm", {
        token,
        password: "ExpiredPassword123!",
      })
    ).code,
    400,
  );
  let expiryMails = 0;
  await consumer.notifyReset(
    { content: Buffer.from(JSON.stringify({ id: request.id })) },
    { sendMail: async () => expiryMails++ },
  );
  assert.equal(expiryMails, 0);
  await cooldown();
  await call("/password-resets", { email });
  const previous = await latest(),
    oldToken = tokens.tokenFor(previous.id);
  await cooldown();
  await call("/password-resets", { email });
  request = await latest();
  assert.notEqual(request.id, previous.id);
  assert.equal(
    (
      await call("/password-resets/confirm", {
        token: oldToken,
        password: newPassword,
      })
    ).code,
    400,
  );
  assert.equal(
    (
      await call(
        "/users/" + userId,
        {
          password: "ChangedThroughProfile123!",
          current_password: newPassword,
        },
        "PUT",
        login.body.data.accessToken,
      )
    ).code,
    200,
  );
  assert.equal(
    (
      await call("/password-resets/confirm", {
        token: tokens.tokenFor(request.id),
        password: newPassword,
      })
    ).code,
    400,
  );
  const secret = process.env.PASSWORD_RESET_KEY;
  delete process.env.PASSWORD_RESET_KEY;
  assert.equal((await call("/password-resets", { email })).code, 503);
  process.env.PASSWORD_RESET_KEY = secret;
  const origin = process.env.WEB_BASE_URL;
  process.env.WEB_BASE_URL = "http://untrusted.example.com";
  assert.equal((await call("/password-resets", { email })).code, 503);
  process.env.WEB_BASE_URL = origin;
  let response;
  for (let i = 0; i < 15; i++) {
    response = await call("/password-resets", { email: "unknown@example.com" });
    if (response.code === 429) break;
  }
  assert.equal(response.code, 429);
  for (let i = 0; i < 25; i++) {
    response = await call("/password-resets/confirm", {
      token: "invalid",
      password: newPassword,
    });
    if (response.code === 429) break;
  }
  assert.equal(response.code, 429);
});
