const router = require("express").Router();
const Joi = require("joi");
const { randomUUID } = require("crypto");
const pool = require("../database");
const verify = require("../middlewares/verifyToken");
const { identity, roles } = require("../middlewares/access");
const cachedResponse = require("../cachedResponse");
const scope = require("../cacheScope");
const multer = require("multer");
const LOGO_BYTES = 512 * 1024;
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_BYTES, files: 1 },
}).single("logo");
// Jenis gambar ditentukan dari isi berkas, bukan dari nama atau tipe kiriman browser.
function imageType(bytes) {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  return null;
}
const employer = [verify, identity, roles("employer", "admin")];
const schema = Joi.object({
  name: Joi.string().trim().max(255).required(),
  location: Joi.string().trim().max(255).required(),
  description: Joi.string().max(10000).allow(""),
});
const fail = (res, code, message) =>
  res.status(code).json({ status: "failed", message });
router.get("/mine", ...employer, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM companies WHERE owner_id=$1 ORDER BY created_at DESC",
      [req.userId],
    );
    res.json({ status: "success", data: { companies: rows } });
  } catch (e) {
    next(e);
  }
});
router.get("/", async (req, res, next) => {
  try {
    const { error, value: q } = Joi.object({
      name: Joi.string().allow("").max(255),
      location: Joi.string().allow("").max(255),
      page: Joi.number().integer().min(1).max(100000).default(1),
      limit: Joi.number()
        .integer()
        .min(1)
        .max(200)
        .default(
          req.query.name || req.query.location || req.query.page ? 12 : 200,
        ),
    }).validate(req.query);
    if (error) return fail(res, 400, "Filter perusahaan tidak valid");
    const where = [],
      values = [];
    const add = (sql, v) => {
      values.push(v);
      where.push(sql.replace("?", `$${values.length}`));
    };
    if (q.name) add("name ILIKE ?", `%${q.name}%`);
    if (q.location) add("location ILIKE ?", `%${q.location}%`);
    const clause = where.length ? " WHERE " + where.join(" AND ") : "";
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM companies${clause}`,
      values,
    );
    const { rows } = await pool.query(
      `SELECT id,name,location,description,logo_updated_at FROM companies${clause} ORDER BY name LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, q.limit, (q.page - 1) * q.limit],
    );
    res.json({
      status: "success",
      data: {
        companies: rows,
        pagination: {
          page: q.page,
          limit: q.limit,
          total: count.rows[0].total,
          pages: Math.ceil(count.rows[0].total / q.limit) || 1,
        },
      },
    });
  } catch (e) {
    next(e);
  }
});
router.get("/:id", async (req, res, next) => {
  try {
    const key =
      req.params.id.length <= 50
        ? await scope.key(scope.company(req.params.id), "detail")
        : null;
    await cachedResponse(
      res,
      key,
      async () => {
        const { rows } = await pool.query(
          "SELECT id,name,location,description,logo_updated_at FROM companies WHERE id=$1",
          [req.params.id],
        );
        return rows.length ? { status: "success", data: rows[0] } : null;
      },
      "Perusahaan tidak ditemukan",
    );
  } catch (e) {
    next(e);
  }
});
router.post("/", ...employer, async (req, res, next) => {
  try {
    const { error, value } = schema.validate(req.body);
    if (error) return fail(res, 400, error.details[0].message);
    const id = randomUUID();
    await pool.query(
      "INSERT INTO companies(id,name,location,description,owner_id) VALUES($1,$2,$3,$4,$5)",
      [id, value.name, value.location, value.description || "", req.userId],
    );
    res.status(201).json({ status: "success", data: { id } });
  } catch (e) {
    next(e);
  }
});
router.put("/:id", ...employer, async (req, res, next) => {
  try {
    const { error, value } = schema
      .fork(["name", "location"], (f) => f.optional())
      .min(1)
      .validate(req.body);
    if (error) return fail(res, 400, error.details[0].message);
    const result = await pool.query(
      "UPDATE companies SET name=COALESCE($1,name),location=COALESCE($2,location),description=COALESCE($3,description) WHERE id=$4 AND owner_id=$5 RETURNING id",
      [
        value.name ?? null,
        value.location ?? null,
        value.description ?? null,
        req.params.id,
        req.userId,
      ],
    );
    if (!result.rowCount)
      return fail(res, 404, "Perusahaan tidak ditemukan atau bukan milik Anda");
    await scope.companyChanged(req.params.id, req.userId);
    res.json({ status: "success", message: "Perusahaan diperbarui" });
  } catch (e) {
    next(e);
  }
});
router.delete("/:id", ...employer, async (req, res, next) => {
  try {
    const jobs = await pool.query(
      "SELECT id FROM jobs WHERE company_id=$1 LIMIT 1",
      [req.params.id],
    );
    if (jobs.rowCount)
      return fail(res, 409, "Perusahaan masih memiliki lowongan");
    const result = await pool.query(
      "DELETE FROM companies WHERE id=$1 AND owner_id=$2 RETURNING id",
      [req.params.id, req.userId],
    );
    if (!result.rowCount)
      return fail(res, 404, "Perusahaan tidak ditemukan atau bukan milik Anda");
    await scope.invalidate(scope.company(req.params.id));
    res.json({ status: "success", message: "Perusahaan dihapus" });
  } catch (e) {
    if (["23503", "23001"].includes(e.code))
      return fail(res, 409, "Data masih digunakan dan tidak dapat dihapus");
    next(e);
  }
});
router.get("/:id/logo", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      "SELECT mime_type,data FROM company_logos WHERE company_id=$1",
      [req.params.id],
    );
    if (!rows.length) return fail(res, 404, "Logo tidak ditemukan");
    res.set({
      "Content-Type": rows[0].mime_type,
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'",
      // Alamat logo memuat versi, jadi salinan berversi aman disimpan lama.
      "Cache-Control": req.query.v
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    res.send(Buffer.from(rows[0].data));
  } catch (e) {
    next(e);
  }
});
router.put(
  "/:id/logo",
  ...employer,
  (req, res, next) =>
    logoUpload(req, res, (error) => {
      if (error)
        return fail(
          res,
          400,
          error.code === "LIMIT_FILE_SIZE"
            ? "Ukuran logo maksimal 512 KB"
            : "Unggah satu berkas gambar",
        );
      next();
    }),
  async (req, res, next) => {
    let db;
    try {
      if (!req.file) return fail(res, 400, "Pilih berkas gambar");
      const type = imageType(req.file.buffer);
      if (!type)
        return fail(res, 400, "Logo harus berupa gambar PNG, JPG, atau WebP");
      db = await pool.connect();
      await db.query("BEGIN");
      const owned = await db.query(
        "UPDATE companies SET logo_updated_at=NOW() WHERE id=$1 AND owner_id=$2 RETURNING logo_updated_at",
        [req.params.id, req.userId],
      );
      if (!owned.rowCount) {
        await db.query("ROLLBACK");
        return fail(
          res,
          404,
          "Perusahaan tidak ditemukan atau bukan milik Anda",
        );
      }
      await db.query(
        "INSERT INTO company_logos(company_id,mime_type,data) VALUES($1,$2,$3) ON CONFLICT (company_id) DO UPDATE SET mime_type=EXCLUDED.mime_type,data=EXCLUDED.data",
        [req.params.id, type, req.file.buffer],
      );
      await db.query("COMMIT");
      db.release();
      db = undefined;
      await scope.companyChanged(req.params.id, req.userId);
      res.json({
        status: "success",
        data: { logo_updated_at: owned.rows[0].logo_updated_at },
        message: "Logo disimpan",
      });
    } catch (e) {
      if (db) await db.query("ROLLBACK").catch(() => {});
      next(e);
    } finally {
      db?.release();
    }
  },
);
router.delete("/:id/logo", ...employer, async (req, res, next) => {
  try {
    const owned = await pool.query(
      "UPDATE companies SET logo_updated_at=NULL WHERE id=$1 AND owner_id=$2 RETURNING id",
      [req.params.id, req.userId],
    );
    if (!owned.rowCount)
      return fail(res, 404, "Perusahaan tidak ditemukan atau bukan milik Anda");
    await pool.query("DELETE FROM company_logos WHERE company_id=$1", [
      req.params.id,
    ]);
    await scope.companyChanged(req.params.id, req.userId);
    res.json({ status: "success", message: "Logo dihapus" });
  } catch (e) {
    next(e);
  }
});
module.exports = router;
