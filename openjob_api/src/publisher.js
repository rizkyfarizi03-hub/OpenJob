require("dotenv").config();
const pool = require("./database");
const {
  QUEUE,
  STATUS_QUEUE,
  RESET_QUEUE,
  VERIFY_QUEUE,
  connect,
} = require("./rabbit");
// An outbox keeps committed applications queued even if RabbitMQ is unavailable.
async function dispatch(sharedChannel) {
  const db = await pool.connect();
  let connection,
    channel = sharedChannel;
  try {
    await db.query("BEGIN");
    const { rows } = await db.query(
      "SELECT application_id FROM application_outbox WHERE published_at IS NULL AND notified_at IS NULL AND failed_at IS NULL AND next_attempt_at<=NOW() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 50",
    );
    const sr = await db.query(
      "SELECT id, application_id, status FROM application_status_outbox WHERE published_at IS NULL AND notified_at IS NULL AND failed_at IS NULL AND next_attempt_at<=NOW() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 50",
    );
    const statusRows = sr.rows;
    const reset = await db.query(
      "SELECT id FROM password_reset_requests WHERE published_at IS NULL AND notified_at IS NULL AND failed_at IS NULL AND used_at IS NULL AND invalidated_at IS NULL AND expires_at>NOW() AND next_attempt_at<=NOW() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 50",
    );
    const resetRows = reset.rows;
    const verification = await db.query(
      "SELECT id FROM email_verification_requests WHERE published_at IS NULL AND notified_at IS NULL AND failed_at IS NULL AND used_at IS NULL AND invalidated_at IS NULL AND expires_at>NOW() AND next_attempt_at<=NOW() ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 50",
    );
    const verificationRows = verification.rows;
    if (statusRows.length && !STATUS_QUEUE)
      throw Error("Antrean status belum dikonfigurasi");
    if (resetRows.length && !RESET_QUEUE)
      throw Error("Antrean reset belum dikonfigurasi");
    if (verificationRows.length && !VERIFY_QUEUE)
      throw Error("Antrean verifikasi belum dikonfigurasi");
    if (
      rows.length > 0 ||
      statusRows.length > 0 ||
      resetRows.length > 0 ||
      verificationRows.length > 0
    ) {
      if (!channel) {
        connection = await connect();
        channel = await connection.createConfirmChannel();
        channel.on("error", (e) =>
          console.error("Publisher channel:", e.message),
        );
        await channel.assertQueue(QUEUE, { durable: true });
        if (STATUS_QUEUE && statusRows.length > 0) {
          await channel.assertQueue(STATUS_QUEUE, { durable: true });
        }
        if (RESET_QUEUE && resetRows.length)
          await channel.assertQueue(RESET_QUEUE, { durable: true });
        if (VERIFY_QUEUE && verificationRows.length)
          await channel.assertQueue(VERIFY_QUEUE, { durable: true });
      }
      for (const { application_id } of rows) {
        await new Promise((resolve, reject) =>
          channel.sendToQueue(
            QUEUE,
            Buffer.from(JSON.stringify({ application_id })),
            {
              persistent: true,
              contentType: "application/json",
              messageId: application_id,
            },
            (e) => (e ? reject(e) : resolve()),
          ),
        );
        await db.query(
          "UPDATE application_outbox SET published_at=CURRENT_TIMESTAMP WHERE application_id=$1",
          [application_id],
        );
      }
      for (const { id, application_id, status } of statusRows) {
        if (STATUS_QUEUE) {
          await new Promise((resolve, reject) =>
            channel.sendToQueue(
              STATUS_QUEUE,
              Buffer.from(JSON.stringify({ id, application_id, status })),
              {
                persistent: true,
                contentType: "application/json",
                messageId: id,
              },
              (e) => (e ? reject(e) : resolve()),
            ),
          );
        }
        await db.query(
          "UPDATE application_status_outbox SET published_at=CURRENT_TIMESTAMP WHERE id=$1",
          [id],
        );
      }
      for (const { id } of resetRows) {
        await new Promise((resolve, reject) =>
          channel.sendToQueue(
            RESET_QUEUE,
            Buffer.from(JSON.stringify({ id })),
            {
              persistent: true,
              contentType: "application/json",
              messageId: id,
            },
            (e) => (e ? reject(e) : resolve()),
          ),
        );
        await db.query(
          "UPDATE password_reset_requests SET published_at=NOW() WHERE id=$1",
          [id],
        );
      }
      for (const { id } of verificationRows) {
        await new Promise((resolve, reject) =>
          channel.sendToQueue(
            VERIFY_QUEUE,
            Buffer.from(JSON.stringify({ id })),
            {
              persistent: true,
              contentType: "application/json",
              messageId: id,
            },
            (e) => (e ? reject(e) : resolve()),
          ),
        );
        await db.query(
          "UPDATE email_verification_requests SET published_at=NOW() WHERE id=$1",
          [id],
        );
      }
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
    if (connection) {
      await connection.close().catch(() => {});
    }
  }
}
async function start() {
  let connection, channel;
  for (;;) {
    try {
      if (!channel) {
        if (connection) await connection.close().catch(() => {});
        connection = await connect();
        const currentConnection = connection;
        connection.on("close", () => {
          if (connection === currentConnection) {
            connection = null;
            channel = null;
          }
        });
        channel = await connection.createConfirmChannel();
        const currentChannel = channel;
        channel.on("error", () => {
          if (channel === currentChannel) channel = null;
        });
        channel.on("close", () => {
          if (channel === currentChannel) channel = null;
        });
        await channel.assertQueue(QUEUE, { durable: true });
        if (STATUS_QUEUE)
          await channel.assertQueue(STATUS_QUEUE, { durable: true });
        if (RESET_QUEUE)
          await channel.assertQueue(RESET_QUEUE, { durable: true });
        if (VERIFY_QUEUE)
          await channel.assertQueue(VERIFY_QUEUE, { durable: true });
      }
      await dispatch(channel);
    } catch (e) {
      console.error("Publisher retry:", e.message);
      if (connection) {
        await connection.close().catch(() => {});
        connection = null;
        channel = null;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
if (require.main === module)
  start().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
module.exports = { dispatch, start };
