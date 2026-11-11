const express = require("express");
const Joi = require("joi");

const { randomUUID } = require("crypto");
const pool = require("../database");
const validate = require("../middlewares/validate");

const router = express.Router();
const { identity, roles } = require("../middlewares/access");
router.use((req, res, next) => {
  if (req.method === "GET") return next();
  require("../middlewares/verifyToken")(req, res, (error) =>
    error
      ? next(error)
      : identity(req, res, () => roles("admin")(req, res, next)),
  );
});

// Middleware Authentication
const verifyToken = require("../middlewares/verifyToken");

// Validasi Category dengan Joi
const categorySchema = Joi.object({
  name: Joi.string().trim().min(1).required(),
});

// Tambah Category
router.post(
  "/",
  verifyToken,
  validate(categorySchema),
  async (req, res, next) => {
    try {
      const { name } = req.validatedBody;
      const id = randomUUID();

      await pool.query("INSERT INTO categories (id, name) VALUES ($1, $2)", [
        id,
        name,
      ]);

      return res.status(201).json({
        status: "success",
        data: { id },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Lihat Semua Categories
router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, created_at, updated_at FROM categories ORDER BY created_at DESC",
    );

    return res.status(200).json({
      status: "success",
      data: {
        categories: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Lihat Category Berdasarkan ID
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, created_at, updated_at FROM categories WHERE id = $1",
      [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "failed",
        message: "Category tidak ditemukan",
      });
    }

    return res.status(200).json({
      status: "success",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// Update Category
router.put(
  "/:id",
  verifyToken,
  validate(categorySchema),
  async (req, res, next) => {
    try {
      const { name } = req.validatedBody;

      const result = await pool.query(
        `UPDATE categories
         SET name = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id`,
        [name, req.params.id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          status: "failed",
          message: "Category tidak ditemukan",
        });
      }

      return res.status(200).json({
        status: "success",
        message: "Category berhasil diperbarui",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Hapus Category
router.delete("/:id", verifyToken, async (req, res, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM categories WHERE id = $1 RETURNING id",
      [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "failed",
        message: "Category tidak ditemukan",
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Category berhasil dihapus",
    });
  } catch (error) {
    if (["23503", "23001"].includes(error.code))
      return res.status(409).json({
        status: "failed",
        message: "Kategori masih digunakan oleh lowongan",
      });
    next(error);
  }
});

module.exports = router;
