const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
(async () => {
  const directory = path.resolve(__dirname, "../.qa-postgres");
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(
      path.join(directory, "docker.env"),
      "POSTGRES_PASSWORD=" + randomBytes(32).toString("hex") + "\n",
      { flag: "wx", mode: 0o600 },
    );
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const child = spawn(
    "docker",
    [
      "compose",
      "-p",
      "openjob-qa",
      "-f",
      path.resolve(__dirname, "../../compose.qa.yml"),
      "up",
      "-d",
      "--wait",
      "postgres-qa",
    ],
    { stdio: "inherit", windowsHide: true },
  );
  child.on("error", (e) => {
    console.error("DOCKER_QA_FAILED", e.code);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
})().catch((e) => {
  console.error("DOCKER_QA_FAILED", e.code || e.name);
  process.exitCode = 1;
});
