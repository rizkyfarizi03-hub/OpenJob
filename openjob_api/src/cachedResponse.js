const cache = require("./cache");
module.exports = async function cachedResponse(res, key, load) {
  const hit = await cache.get(key);
  if (hit !== null)
    return res.set("X-Data-Source", "cache").status(200).json(hit);
  const response = await load();
  if (response === null)
    return res
      .status(404)
      .json({ status: "failed", message: "Data tidak ditemukan" });
  await cache.set(key, response);
  return res.set("X-Data-Source", "database").status(200).json(response);
};
