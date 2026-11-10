const test = require("node:test");
const assert = require("node:assert/strict");
const load = require("./loadWithMocks.cjs");

test("publisher pushes application id once with durable queue and persistent message", async () => {
  const outbox = [{ application_id: "application-123", published_at: null }];
  const sent = [];
  const queries = [];
  const pool = {
    connect: async () => ({
      query: async (query, params) => {
        queries.push(query);
        if (query.startsWith("SELECT application_id")) {
          return { rows: outbox.filter((r) => !r.published_at) };
        }
        if (query.startsWith("UPDATE application_outbox")) {
          outbox.find((r) => r.application_id === params[0]).published_at = new Date();
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    }),
  };
  let asserted;
  const channel = {
    on() {},
    assertQueue: async (name, options) => { asserted = { name, options }; },
    sendToQueue: (queue, body, options, callback) => {
      sent.push({ queue, body: JSON.parse(body.toString()), options });
      callback(null);
    },
  };
  const { dispatch } = load("../src/publisher.js", {
    dotenv: { config() {} },
    "./database": pool,
    "./rabbit": {
      QUEUE: "openjob.application.created",
      connect: async () => ({ createConfirmChannel: async () => channel, close: async () => {} }),
    },
  });
  await dispatch();
  await dispatch();
  assert.deepEqual(asserted, { name: "openjob.application.created", options: { durable: true } });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, { application_id: "application-123" });
  assert.equal(sent[0].options.persistent, true);
  assert.equal(sent[0].options.messageId, "application-123");
  assert.equal(sent[0].queue, "openjob.application.created");
  assert.equal(queries.filter((sql) => sql === "COMMIT").length, 2);
});

test("publisher and consumer share the same queue name", () => {
  const apiRabbit = load("../src/rabbit.js", { amqplib: { connect() {} } });
  assert.equal(apiRabbit.QUEUE, "openjob.application.created");
  assert.equal(apiRabbit.STATUS_QUEUE, "openjob.application.status_changed");
});

test("publisher pushes application status change to status queue with durable queue and persistent message", async () => {
  const statusOutbox = [{ id: "status-outbox-1", application_id: "application-123", status: "interview", published_at: null }];
  const sent = [];
  const asserted = [];
  const pool = {
    connect: async () => ({
      query: async (query, params) => {
        if (query.startsWith("SELECT application_id")) {
          return { rows: [] };
        }
        if (query.includes("application_status_outbox WHERE published_at IS NULL")) {
          return { rows: statusOutbox.filter((r) => !r.published_at) };
        }
        if (query.startsWith("UPDATE application_status_outbox")) {
          statusOutbox.find((r) => r.id === params[0]).published_at = new Date();
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    }),
  };
  const channel = {
    on() {},
    assertQueue: async (name, options) => { asserted.push({ name, options }); },
    sendToQueue: (queue, body, options, callback) => {
      sent.push({ queue, body: JSON.parse(body.toString()), options });
      callback(null);
    },
  };
  const { dispatch } = load("../src/publisher.js", {
    dotenv: { config() {} },
    "./database": pool,
    "./rabbit": {
      QUEUE: "openjob.application.created",
      STATUS_QUEUE: "openjob.application.status_changed",
      connect: async () => ({ createConfirmChannel: async () => channel, close: async () => {} }),
    },
  });
  await dispatch();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].queue, "openjob.application.status_changed");
  assert.deepEqual(sent[0].body, { id: "status-outbox-1", application_id: "application-123", status: "interview" });
  assert.equal(sent[0].options.persistent, true);
  assert.ok(statusOutbox[0].published_at);
});
