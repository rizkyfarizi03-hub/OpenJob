const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("worker_threads");
if (!isMainThread) {
  (async () => {
    const { PDFDocument } = require("pdf-lib");
    const bytes = Buffer.from(workerData);
    if (
      !/^%PDF-\d\.\d/.test(bytes.subarray(0, 8).toString()) ||
      !/%%EOF\s*$/.test(bytes.subarray(-1024).toString())
    )
      throw Error("Invalid PDF");
    const pdf = await PDFDocument.load(bytes, {
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    const pages = pdf.getPages();
    if (!pages.length) throw Error("No pages");
    for (const page of pages) {
      const { width, height } = page.getSize();
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      )
        throw Error("Invalid page");
    }
    parentPort.postMessage(true);
  })().catch(() => parentPort.postMessage(false));
}
module.exports = (bytes) =>
  new Promise((resolve, reject) => {
    // Isolate malformed documents and bound CPU time and parser memory.
    const worker = new Worker(__filename, {
      workerData: bytes,
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    });
    const finish = (valid) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(valid);
    };
    const timer = setTimeout(() => {
      reject(
        Object.assign(new Error("PDF validation timed out"), {
          code: "PDF_VALIDATION_TIMEOUT",
        }),
      );
      worker.terminate();
    }, 5000);
    worker.once("message", finish);
    worker.once("error", () => finish(false));
    worker.once("exit", () => finish(false));
  });
