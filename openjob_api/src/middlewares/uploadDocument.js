const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const uploadDirectory = process.env.OPENJOB_UPLOAD_DIRECTORY || path.resolve(__dirname, "../../uploads/documents");

fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, uploadDirectory);
  },
  filename: (req, file, callback) => {
    callback(null, `${randomUUID()}.pdf`);
  },
});

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
