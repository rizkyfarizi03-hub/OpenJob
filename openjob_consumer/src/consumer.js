require("dotenv").config();
const nodemailer = require("nodemailer");
const { createHash } = require("crypto");
const pool = require("./database");
const {
  QUEUE,
  STATUS_QUEUE,
  RESET_QUEUE,
  VERIFY_QUEUE,
  connect,
} = require("./rabbit");
const MAX_FAILURES = 3;
const statuses = {
  reviewing: "Sedang Ditinjau",
  interview: "Tahap Wawancara",
  accepted: "Diterima",
  rejected: "Belum Sesuai",
  withdrawn: "Ditarik",
};
function invalid() {
  return Object.assign(Error("Payload notifikasi tidak valid"), {
    permanent: true,
    code: "INVALID_MESSAGE",
  });
}
function payloadFor(message, kind) {
  if (!message?.content || message.content.length > 4096) throw invalid();
  let p;
  try {
    p = JSON.parse(message.content.toString());
  } catch {
    throw invalid();
  }
  const keys =
    kind === "reset" || kind === "verify"
      ? ["id"]
      : kind === "created"
        ? ["application_id"]
        : ["id", "application_id", "status"];
  if (
    !p ||
    typeof p !== "object" ||
    Array.isArray(p) ||
    Object.keys(p).length !== keys.length ||
    keys.some((k) => typeof p[k] !== "string" || !p[k])
  )
    throw invalid();
  for (const key of keys.filter((k) => k !== "status"))
    if (!/^[a-zA-Z0-9_-]{1,50}$/.test(p[key])) throw invalid();
  if (
    kind !== "created" &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      p.id,
    )
  )
    throw invalid();
  if (kind === "status" && !Object.hasOwn(statuses, p.status)) throw invalid();
  return p;
}
function transport() {
  for (const name of ["MAIL_HOST", "MAIL_PORT", "MAIL_USER", "MAIL_PASSWORD"])
    if (!process.env[name]) throw Error(name + " wajib diisi");
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT),
    secure: Number(process.env.MAIL_PORT) === 465,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}
async function deliver(message, mailer, kind) {
  const p = payloadFor(message, kind),
    accountMail = kind === "reset" || kind === "verify",
    table =
      kind === "verify"
        ? "email_verification_requests"
        : kind === "reset"
          ? "password_reset_requests"
          : kind === "created"
            ? "application_outbox"
            : "application_status_outbox";
  const key = kind === "created" ? "application_id" : "id",
    id = kind === "created" ? p.application_id : p.id;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const state = await db.query(
      "SELECT notified_at,failure_count,next_attempt_at,failed_at" +
        (accountMail
          ? ",id,user_id,email,token_hash,expires_at,used_at,invalidated_at"
          : kind === "status"
            ? ",application_id,status"
            : "") +
        " FROM " +
        table +
        " WHERE " +
        key +
        "=$1 FOR UPDATE",
      [id],
    );
    const row = state.rows[0];
    if (!row || row.notified_at) {
      await db.query("COMMIT");
      return { action: "done" };
    }
    if (
      kind === "status" &&
      (row.application_id !== p.application_id || row.status !== p.status)
    )
      throw invalid();
    if (
      accountMail &&
      (row.used_at ||
        row.invalidated_at ||
        new Date(row.expires_at).getTime() <= Date.now())
    ) {
      await db.query("UPDATE " + table + " SET notified_at=NOW() WHERE id=$1", [
        id,
      ]);
      await db.query("COMMIT");
      return { action: "done" };
    }
    if (row.failed_at) {
      await db.query("COMMIT");
      return { action: "failed", failures: row.failure_count };
    }
    if (
      row.next_attempt_at &&
      new Date(row.next_attempt_at).getTime() > Date.now()
    ) {
      await db.query("COMMIT");
      return { action: "deferred" };
    }
    const result = accountMail
      ? await db.query(
          "SELECT id,name AS applicant_name,email AS applicant_email,email_verified_at FROM users WHERE id=$1 AND email=$2",
          [row.user_id, row.email],
        )
      : await db.query(
          `SELECT a.id,a.created_at,u.name AS applicant_name,u.email AS applicant_email,
 j.title,owner.email AS owner_email,c.name AS company_name
 FROM applications a JOIN users u ON u.id=a.user_id JOIN jobs j ON j.id=a.job_id
 JOIN companies c ON c.id=j.company_id LEFT JOIN users owner ON owner.id=j.owner_id WHERE a.id=$1`,
          [p.application_id],
        );
    const a = result.rows[0];
    if (kind === "verify" && a?.email_verified_at) {
      await db.query("UPDATE " + table + " SET notified_at=NOW() WHERE id=$1", [
        id,
      ]);
      await db.query("COMMIT");
      return { action: "done" };
    }
    let failure;
    try {
      if (!a || (kind === "created" && !a.owner_email))
        throw Object.assign(Error("Data penerima tidak tersedia"), {
          code: "RECIPIENT_MISSING",
        });
      const options =
        kind === "verify"
          ? {
              to: a.applicant_email,
              messageId: "<email-verification-" + p.id + "@openjob.local>",
              subject: "Verifikasi email akun OpenJob",
              text:
                "Halo " +
                a.applicant_name +
                ",\n\nKonfirmasikan alamat email akun OpenJob Anda melalui tautan berikut:\n" +
                require("./resetLink").verification(row) +
                "\n\nTautan berlaku 24 jam dan hanya dapat digunakan sekali. Verifikasi diperlukan sebelum melamar atau menerbitkan lowongan. Jika Anda tidak membuat akun atau mengganti email ini, abaikan pesan ini.",
            }
          : kind === "reset"
            ? {
                to: a.applicant_email,
                messageId: "<password-reset-" + p.id + "@openjob.local>",
                subject: "Ganti password akun OpenJob",
                text:
                  "Halo " +
                  a.applicant_name +
                  ",\n\nGunakan tautan berikut untuk mengganti password akun OpenJob Anda:\n" +
                  require("./resetLink")(row) +
                  "\n\nTautan berlaku 30 menit sejak permintaan dan hanya dapat digunakan sekali. Jika Anda tidak meminta perubahan ini, abaikan email ini. Password Anda belum berubah.",
              }
            : kind === "created"
              ? {
                  to: a.owner_email,
                  messageId: "<application-" + a.id + "@openjob.local>",
                  subject: "Lamaran baru: " + a.title,
                  text:
                    "Ada lamaran baru untuk " +
                    a.title +
                    ".\nNama pelamar: " +
                    a.applicant_name +
                    "\nEmail pelamar: " +
                    a.applicant_email +
                    "\nTanggal lamaran: " +
                    new Date(a.created_at).toISOString(),
                }
              : {
                  to: a.applicant_email,
                  messageId: "<application-status-" + p.id + "@openjob.local>",
                  subject: "Pembaruan status lamaran: " + a.title,
                  text:
                    "Halo " +
                    a.applicant_name +
                    ",\n\nStatus lamaran Anda untuk posisi " +
                    a.title +
                    " di " +
                    a.company_name +
                    " telah diperbarui menjadi: " +
                    statuses[row.status] +
                    ".\n\nSilakan masuk ke akun OpenJob Anda untuk melihat detail perkembangan lamaran.\n\nSalam,\nTim OpenJob",
                };
      await mailer.sendMail({
        from: process.env.MAIL_FROM || process.env.MAIL_USER,
        ...options,
      });
    } catch (e) {
      failure = e;
    }
    if (failure) {
      const failures = Number(row.failure_count || 0) + 1;
      const permanent =
        failure.responseCode >= 500 && failure.responseCode < 600;
      const failed = failures >= MAX_FAILURES || permanent;
      const delay = failures === 1 ? 5 : 30;
      const code =
        String(failure.code || "SMTP_ERROR")
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .slice(0, 80) || "SMTP_ERROR";
      await db.query(
        "UPDATE " +
          table +
          " SET failure_count=$2,last_error=$3,published_at=NULL,next_attempt_at=NOW()+($4 * INTERVAL '1 second'),failed_at=CASE WHEN $5 THEN NOW() ELSE NULL END WHERE " +
          key +
          "=$1",
        [id, failures, code, delay, failed],
      );
      await db.query("COMMIT");
      return { action: failed ? "failed" : "retry", failures, code };
    }
    await db.query(
      "UPDATE " +
        table +
        " SET notified_at=CURRENT_TIMESTAMP,last_error=NULL WHERE " +
        key +
        "=$1",
      [id],
    );
    await db.query("COMMIT");
    return { action: "done" };
  } catch (e) {
    await db.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}
const notify = (message, mailer) => deliver(message, mailer, "created");
const notifyStatus = (message, mailer) => deliver(message, mailer, "status");
const notifyReset = (message, mailer) => deliver(message, mailer, "reset");
const notifyVerification = (message, mailer) =>
  deliver(message, mailer, "verify");
async function handleDelivery(channel, queue, kind, message, mailer) {
  if (!message) return;
  let result;
  try {
    result = await deliver(message, mailer, kind);
  } catch (e) {
    if (!e.permanent) throw e;
    result = { action: "failed", code: e.code, failures: 0 };
  }
  if (result.action === "failed") {
    const body =
      message.content.length <= 4096
        ? message.content
        : Buffer.from(
            JSON.stringify({
              reason: "MESSAGE_TOO_LARGE",
              originalSize: message.content.length,
            }),
          );
    await new Promise((resolve, reject) =>
      channel.sendToQueue(
        queue + ".failed",
        body,
        {
          persistent: true,
          contentType: "application/json",
          messageId:
            "failed-" +
            createHash("sha256")
              .update(queue)
              .update(message.content)
              .digest("hex"),
          headers: {
            "x-openjob-failures": result.failures,
            "x-openjob-error": result.code || "MAX_ATTEMPTS",
          },
        },
        (error) => (error ? reject(error) : resolve()),
      ),
    );
  }
  // Retry scheduling is committed to PostgreSQL before acknowledging RabbitMQ.
  channel.ack(message);
}
async function start() {
  const mailer = transport();
  for (;;) {
    let connection;
    try {
      connection = await connect();
      const channel = await connection.createConfirmChannel();
      channel.on("error", (e) => console.error("Consumer channel:", e.message));
      for (const queue of [QUEUE, STATUS_QUEUE, RESET_QUEUE, VERIFY_QUEUE]) {
        await channel.assertQueue(queue, { durable: true });
        await channel.assertQueue(queue + ".failed", { durable: true });
      }
      await channel.prefetch(1);
      const closed = new Promise((resolve) => {
        connection.once("close", resolve);
        channel.once("close", resolve);
      });
      for (const [queue, kind] of [
        [QUEUE, "created"],
        [STATUS_QUEUE, "status"],
        [RESET_QUEUE, "reset"],
        [VERIFY_QUEUE, "verify"],
      ]) {
        await channel.consume(queue, async (message) => {
          try {
            await handleDelivery(channel, queue, kind, message, mailer);
          } catch (e) {
            console.error("Consumer infrastructure retry:", e.code || e.name);
            await new Promise((resolve) => setTimeout(resolve, 5000));
            try {
              channel.nack(message, false, true);
            } catch {}
          }
        });
      }
      console.log(
        "Consumer menunggu notifikasi; maksimum " +
          MAX_FAILURES +
          " kegagalan kirim.",
      );
      await closed;
      await connection.close().catch(() => {});
    } catch (e) {
      console.error("Consumer:", e.code || e.name);
      if (connection) await connection.close().catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
if (require.main === module)
  start().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = {
  notify,
  notifyStatus,
  notifyReset,
  notifyVerification,
  handleDelivery,
  start,
};
