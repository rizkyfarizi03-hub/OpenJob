const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

/** Compile an unchanged CommonJS module with explicitly injected dependencies. */
function loadWithMocks(file, mocks) {
  const filename = path.resolve(__dirname, file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = (name) => {
    if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
    return require(name);
  };
  instance._compile(fs.readFileSync(filename, "utf8"), filename);
  return instance.exports;
}
module.exports = loadWithMocks;
