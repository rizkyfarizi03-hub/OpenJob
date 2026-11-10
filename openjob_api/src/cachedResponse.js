const { read, write } = require("./cacheScope");

// `key` null berarti cache dilewati dan data selalu diambil dari database.
module.exports = async function cachedResponse(
  res,
  key,
  load,
  notFound = "Data tidak ditemukan",
) {
  const hit = key === null ? null : await read(key);
  if (hit != null)
    return res.set("X-Data-Source", "cache").status(200).json(hit);
  const response = await load();
  if (response === null)
    return res.status(404).json({ status: "failed", message: notFound });
  if (key !== null) await write(key, response);
  return res.set("X-Data-Source", "database").status(200).json(response);
};
