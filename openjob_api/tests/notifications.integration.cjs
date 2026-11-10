const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("crypto");
const { createSandbox, seed } = require("../dev/sandbox.cjs");
const load = require("./loadWithMocks.cjs");
test("notification pipeline persists retries across consumer reloads and separates failed mail", async (t) => {
  const sandbox = await createSandbox();
  await seed(sandbox.pool);
  t.after(() => sandbox.close());
  const pool = sandbox.pool,
    QUEUE = "openjob.application.created",
    STATUS_QUEUE = "openjob.application.status_changed";
  const publisher = load("../src/publisher.js", {
    dotenv: { config() {} },
    "./database": pool,
    "./rabbit": { QUEUE, STATUS_QUEUE },
  });
  const consumer = () =>
    load("../../openjob_consumer/src/consumer.js", {
      dotenv: { config() {} },
      nodemailer: {},
      "./database": pool,
      "./rabbit": { QUEUE, STATUS_QUEUE },
    });
  const sent = [],
    failed = [];
  let acknowledgements = 0;
  const channel = {
    sendToQueue(queue, body, options, callback) {
      (queue.endsWith(".failed") ? failed : sent).push({
        queue,
        content: body,
        options,
      });
      callback(null);
    },
    ack() {
      acknowledgements++;
    },
  };
  async function application(id, job) {
    await pool.query(
      "INSERT INTO applications(id,user_id,job_id,status) VALUES($1,'demo-applicant',$2,'pending')",
      [id, job],
    );
    await pool.query(
      "INSERT INTO application_outbox(application_id) VALUES($1)",
      [id],
    );
  }
  async function state(id) {
    return (
      await pool.query(
        "SELECT * FROM application_outbox WHERE application_id=$1",
        [id],
      )
    ).rows[0];
  }
  async function due(id) {
    await pool.query(
      "UPDATE application_outbox SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE application_id=$1",
      [id],
    );
  }
  await application("retry-app", "demo-job-1");
  const event = randomUUID();
  await pool.query(
    "INSERT INTO application_status_outbox(id,application_id,status) VALUES($1,'retry-app','interview')",
    [event],
  );
  await publisher.dispatch(channel);
  assert.equal(sent.length, 2);
  let msg = sent.find((m) => m.queue === QUEUE),
    statusMessage = sent.find((m) => m.queue === STATUS_QUEUE);
  let attempts = 0;
  const failing = {
    sendMail: async () => {
      attempts++;
      throw Object.assign(Error("temporary SMTP unavailable"), {
        code: "ETIMEDOUT",
      });
    },
  };
  await consumer().handleDelivery(channel, QUEUE, "created", msg, failing);
  let row = await state("retry-app");
  assert.equal(row.failure_count, 1);
  assert.equal(row.published_at, null);
  assert.equal(row.notified_at, null);
  assert.ok(new Date(row.next_attempt_at) > new Date());
  sent.length = 0;
  await publisher.dispatch(channel);
  assert.equal(sent.length, 0);
  await consumer().handleDelivery(channel, QUEUE, "created", msg, failing);
  assert.equal(attempts, 1);
  for (let i = 0; i < 2; i++) {
    await due("retry-app");
    await publisher.dispatch(channel);
    assert.equal(sent.length, 1);
    msg = sent.pop();
    await consumer().handleDelivery(channel, QUEUE, "created", msg, failing);
  }
  row = await state("retry-app");
  assert.equal(attempts, 3);
  assert.equal(row.failure_count, 3);
  assert.ok(row.failed_at);
  assert.equal(row.last_error, "ETIMEDOUT");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].queue, QUEUE + ".failed");
  await publisher.dispatch(channel);
  assert.equal(sent.length, 0);
  await consumer().handleDelivery(channel, QUEUE, "created", msg, failing);
  assert.equal(attempts, 3);
  const emails = [];
  const mailer = { sendMail: async (email) => emails.push(email) };
  await consumer().handleDelivery(
    channel,
    STATUS_QUEUE,
    "status",
    statusMessage,
    mailer,
  );
  await consumer().handleDelivery(
    channel,
    STATUS_QUEUE,
    "status",
    statusMessage,
    mailer,
  );
  assert.equal(emails.length, 1);
  assert.equal(
    emails[0].messageId,
    "<application-status-" + event + "@openjob.local>",
  );
  assert.match(emails[0].text, /Tahap Wawancara/);
  assert.ok(
    (
      await pool.query(
        "SELECT notified_at FROM application_status_outbox WHERE id=$1",
        [event],
      )
    ).rows[0].notified_at,
  );
  await application("recovered-app", "demo-job-2");
  await publisher.dispatch(channel);
  msg = sent.pop();
  await consumer().handleDelivery(channel, QUEUE, "created", msg, failing);
  await due("recovered-app");
  await publisher.dispatch(channel);
  msg = sent.pop();
  await consumer().handleDelivery(channel, QUEUE, "created", msg, mailer);
  row = await state("recovered-app");
  assert.equal(row.failure_count, 1);
  assert.ok(row.notified_at);
  assert.equal(row.failed_at, null);
  sent.length = 0;
  await publisher.dispatch(channel);
  assert.equal(sent.length, 0);
  await application("broker-app", "demo-job-3");
  await assert.rejects(
    () =>
      publisher.dispatch({
        sendToQueue(q, b, o, cb) {
          cb(Error("broker failed"));
        },
      }),
    /broker failed/,
  );
  assert.equal((await state("broker-app")).published_at, null);
  assert.ok(acknowledgements >= 7);
});
