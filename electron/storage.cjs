// Persistent storage root: <home>/.opentagger
//
// Everything the app persists lives under this one directory:
//   preferences.json         global user preferences (via unstorage)
//   models/<id>/...          downloaded tagger models + metadata
//
// Small structured data goes through unstorage (fs driver, keys map
// "a:b:c" -> "<root>/a/b/c"). Large binaries (the ONNX models) are
// streamed straight to files under the same root — unstorage is a KV
// layer and would buffer whole values in memory.
//
// OPENTAGGER_DATA_DIR overrides the root (used by the test scripts so
// they never touch the real ~/.opentagger).

const { homedir } = require("node:os");
const { join } = require("node:path");
// fs-lite = the fs driver without watch support (and without its
// chokidar-family dependencies), which we don't use.
const { createStorage } = require("unstorage");
const fsDriver = require("unstorage/drivers/fs-lite");

const dataRoot =
    process.env.OPENTAGGER_DATA_DIR || join(homedir(), ".opentagger");

const storage = createStorage({
    driver: fsDriver({ base: dataRoot }),
});

module.exports = {
    dataRoot,
    storage,
    modelsDir: join(dataRoot, "models"),
};
