const multer = require("multer");
const { storage } = require("../documentStore");

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, callback) => {
    if (file.mimetype !== "application/pdf") {
      return callback(new Error("File is required and must be a PDF"));
    }

    return callback(null, true);
  },
});

const uploadDocument = (req, res, next) => {
  upload.single("document")(req, res, (error) => {
    if (error) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "Ukuran file maksimal 5 MB"
          : error.message;

      return res.status(400).json({
        status: "failed",
        message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: "failed",
        message: "File is required",
      });
    }

    return next();
  });
};

module.exports = uploadDocument;
