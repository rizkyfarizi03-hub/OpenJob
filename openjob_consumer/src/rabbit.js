const amqp = require("amqplib");
const prefix = process.env.RABBITMQ_QUEUE_PREFIX || 'openjob';
const QUEUE = prefix + ".application.created";
const STATUS_QUEUE = prefix + ".application.status_changed";
const RESET_QUEUE = prefix + '.account.password_reset';
const VERIFY_QUEUE = prefix + '.account.email_verification';
function url() {
  if (process.env.AMQP_URL) return process.env.AMQP_URL;
  if (!process.env.RABBITMQ_HOST) throw new Error("RABBITMQ_HOST atau AMQP_URL wajib diisi");
  return (
    `amqp://${encodeURIComponent(process.env.RABBITMQ_USER || "guest")}:${encodeURIComponent(process.env.RABBITMQ_PASSWORD || "guest")}@${process.env.RABBITMQ_HOST}:${process.env.RABBITMQ_PORT || 5672}`
  );
}
async function connect() {
  const connection = await amqp.connect(url(), { timeout: 5000 });
  connection.on("error", (e) => console.error("RabbitMQ:", e.message));
  return connection;
}
module.exports = { QUEUE, STATUS_QUEUE, RESET_QUEUE, VERIFY_QUEUE, connect };
