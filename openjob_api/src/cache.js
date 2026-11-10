require("dotenv").config();

const { createClient } = require("redis");

const client = createClient({
  socket: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    // Tanpa Redis, coba lagi makin jarang agar log tidak penuh.
    reconnectStrategy: (retries) => Math.min(retries * 500, 30000),
  },
});

client.on("error", (error) => {
  console.error("Redis error:", error.message);
});

let connection;

async function getClient() {
  if (!connection) {
    connection = client.connect().catch((error) => {
      connection = undefined;
      throw error;
    });
  }

  await connection;
  return client;
}

module.exports = {
  async get(key) {
    const redis = await getClient();
    const value = await redis.get(`openjob:web-v1:${key}`);
    return value === null ? null : JSON.parse(value);
  },

  async set(key, value) {
    const redis = await getClient();
    await redis.set(`openjob:web-v1:${key}`, JSON.stringify(value), {
      EX: 3600,
    });
  },

  async delete(...keys) {
    if (keys.length === 0) return;

    const redis = await getClient();
    await redis.del(keys.map((key) => `openjob:web-v1:${key}`));
  },
};
