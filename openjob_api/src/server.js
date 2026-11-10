require("dotenv").config();

const express = require("express");
const path = require("path");

const usersRoutes = require("./routes/users");
const authenticationsRoutes = require("./routes/authentications");
const companiesRoutes = require("./routes/companies");
const categoriesRoutes = require("./routes/categories");
const jobsRoutes = require("./routes/jobs");
const applicationsRoutes = require("./routes/applications");
const bookmarksRoutes = require("./routes/bookmarks");
const profileRoutes = require("./routes/profile");
const documentsRoutes = require("./routes/documents");

const app = express();

// Middleware JSON
app.use(express.json());
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  res.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
  if (req.headers.authorization) res.set("Cache-Control", "no-store");
  next();
});
const api = express.Router();
api.use("/users", usersRoutes);
api.use("/authentications", authenticationsRoutes);
api.use("/password-resets", require("./routes/passwordResets"));
api.use("/email-verifications", require("./routes/emailVerifications"));
api.use("/companies", companiesRoutes);
api.use("/categories", categoriesRoutes);
api.use("/jobs", jobsRoutes);
api.use("/applications", applicationsRoutes);
api.use("/profile", profileRoutes);
api.use("/documents", documentsRoutes);
api.use("/", bookmarksRoutes);
api.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    status: "success",
    demo: process.env.OPENJOB_DEMO === "1",
    localQa: process.env.OPENJOB_LOCAL_QA === "1",
    features: {
      passwordReset: true,
      emailVerification: true,
      demoMail: process.env.OPENJOB_DEMO_MAIL === "1",
    },
  });
});
api.use((req, res) =>
  res
    .status(404)
    .json({ status: "failed", message: "Endpoint tidak ditemukan" }),
);
app.use("/api", api);
app.use(
  "/assets",
  express.static(path.resolve(__dirname, "../../openjob_web/assets"), {
    setHeaders: (res) => res.set("Cache-Control", "no-cache"),
  }),
);
app.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.resolve(__dirname, "../../openjob_web/index.html"));
});

// Routes Documents
app.use("/documents", documentsRoutes);

// Routes Users
app.use("/users", usersRoutes);

// Routes Authentications
app.use("/authentications", authenticationsRoutes);

// Routes Companies
app.use("/companies", companiesRoutes);

// Routes Categories
app.use("/categories", categoriesRoutes);

// Routes Jobs
app.use("/jobs", jobsRoutes);

// Routes Applications
app.use("/applications", applicationsRoutes);

// Routes Bookmarks
app.use("/", bookmarksRoutes);

// Routes Profile
app.use("/profile", profileRoutes);

// Halaman Utama
app.get("/health", (req, res) => {
  return res.status(200).json({
    status: "success",
    message: "OpenJob RESTful API berhasil dijalankan!",
  });
});

// Middleware untuk endpoint yang tidak ditemukan
app.use((req, res) => {
  return res.status(404).json({
    status: "failed",
    message: "Endpoint tidak ditemukan",
  });
});

// Middleware Error Handling
app.use((err, req, res, next) => {
  console.error("Server Error:", err);

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      status: "failed",
      message: "Format JSON tidak valid",
    });
  }

  return res.status(500).json({
    status: "failed",
    message: "Terjadi kesalahan pada server",
  });
});

// Konfigurasi Server
const HOST = process.env.HOST || "localhost";
const PORT = process.env.PORT || 3000;

// Menjalankan HTTP Server
if (require.main === module) {
  require("./documentCleanup").start();
  app.listen(PORT, HOST, () => {
    console.log(`Server berjalan di http://${HOST}:${PORT}`);
    require("./publisher").start().catch(console.error);
  });
}
module.exports = app;
