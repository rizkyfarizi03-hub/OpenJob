const router = require("express").Router();
const Joi = require("joi");
const { randomUUID } = require("crypto");
const pool = require("../database");
const verify = require("../middlewares/verifyToken");
const { identity, roles } = require("../middlewares/access");
const cachedResponse = require("../cachedResponse");
const scope = require("../cacheScope");
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
      `SELECT id,name,location,description FROM companies${clause} ORDER BY name LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
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
          "SELECT id,name,location,description FROM companies WHERE id=$1",
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
module.exports = router;
