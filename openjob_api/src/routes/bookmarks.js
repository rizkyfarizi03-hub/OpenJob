const express = require("express");

const { randomUUID } = require("crypto");
const pool = require("../database");

const router = express.Router();
const bookmarkQuery = require("../bookmarkQuery");
const cachedResponse = require("../cachedResponse");
const scope = require("../cacheScope");

// Middleware Authentication & Authorization
const verifyToken = require("../middlewares/verifyToken");
const { identity, roles } = require("../middlewares/access");
const auth = [verifyToken, identity, roles('user')];

const failure = (res, code, message) => {
  return res.status(code).json({
    status: "failed",
    message,
  });
};

// Tambah Bookmark
router.post("/jobs/:jobId/bookmark", ...auth, async (req, res, next) => {
  try {
    const { jobId } = req.params;

    const job = await pool.query("SELECT id FROM jobs WHERE id = $1", [jobId]);

    if (job.rows.length === 0) {
      return failure(res, 404, "Job tidak ditemukan");
    }

    const id = randomUUID();

    await pool.query(
      `INSERT INTO bookmarks (id, user_id, job_id)
       VALUES ($1, $2, $3)`,
      [id, req.userId, jobId],
    );
    await scope.invalidateAccounts(req.userId);

    return res.status(201).json({
      status: "success",
      data: { id },
    });
  } catch (error) {
    if (error.code === "23505") {
      return failure(res, 400, "Bookmark sudah ada");
    }

    return next(error);
  }
});

// Lihat Detail Bookmark
router.get("/jobs/:jobId/bookmark/:id", ...auth, async (req, res, next) => {
  try {
    const { jobId, id } = req.params;

    const result = await pool.query(
      `SELECT * FROM bookmarks
       WHERE id = $1 AND job_id = $2 AND user_id = $3`,
      [id, jobId, req.userId],
    );

    if (result.rows.length === 0) {
      return failure(res, 404, "Bookmark tidak ditemukan");
    }

    return res.status(200).json({
      status: "success",
      data: result.rows[0],
    });
  } catch (error) {
    return next(error);
  }
});

// Hapus Bookmark Berdasarkan Job dan User Login
router.delete("/jobs/:jobId/bookmark", ...auth, async (req, res, next) => {
  try {
    const { jobId } = req.params;

    const result = await pool.query(
      `DELETE FROM bookmarks
       WHERE job_id = $1 AND user_id = $2
       RETURNING id`,
      [jobId, req.userId],
    );

    if (result.rows.length === 0) {
      return failure(res, 404, "Bookmark tidak ditemukan");
    }
    await scope.invalidateAccounts(req.userId);

    return res.status(200).json({
      status: "success",
      message: "Bookmark berhasil dihapus",
    });
  } catch (error) {
    return next(error);
  }
});

// Lihat Semua Bookmark User yang Login
router.get("/bookmarks", ...auth, async (req, res, next) => {
  try {
    // Salary visibility and job status must reflect the latest employer edit:
    // job and company changes invalidate the cache of every account that saved the job.
    const key = await scope.key(scope.account(req.userId), 'bookmarks');
    return await cachedResponse(res, key, async () => {
      const result = await pool.query(
        `${bookmarkQuery} WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.userId],
      );
      return { status: 'success', data: { bookmarks: result.rows } };
    });
  } catch (e) {
    next(e);
  }
});
module.exports = router;

