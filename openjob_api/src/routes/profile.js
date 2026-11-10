const express = require("express");

const pool = require("../database");

const router = express.Router();

// Middleware Authentication
const verifyToken = require("../middlewares/verifyToken");

// Semua endpoint Profile wajib login
router.use(verifyToken);

// GET /profile
router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, created_at,email_verified_at
       FROM users
       WHERE id = $1`,
      [req.userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "failed",
        message: "Pengguna tidak ditemukan",
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

// GET /profile/applications
router.get("/applications", async (req, res, next) => {
  try {
    const result = await pool.query(
      `${require("../applicationQuery").replace("FROM applications", ", j.description AS job_description, j.experience_level FROM applications")} WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
      [req.userId],
    );

    return res.status(200).json({
      status: "success",
      data: {
        applications: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /profile/bookmarks
router.get("/bookmarks", async (req, res, next) => {
  try {
    const result = await pool.query(
      `${require("../bookmarkQuery")} WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
      [req.userId],
    );

    return res.status(200).json({
      status: "success",
      data: {
        bookmarks: result.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
