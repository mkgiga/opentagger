// Tagger smoke test that runs INSIDE Electron's runtime — the
// environment where the stream-corruption download bug actually
// manifested (plain Node masked it). Downloads the model through the
// real code path into .cache/electron-tagger-test/, verifies the file
// hash-loads as a session, and runs the red-image probe.
//
//   bunx electron scripts/electron-tagger-test.cjs

const { app } = require("electron");
const { join } = require("node:path");

process.env.OPENTAGGER_DATA_DIR = join(
    __dirname,
    "..",
    ".cache",
    "electron-tagger-test"
);

const tagger = require("../electron/tagger.cjs");

const MODEL = "wd-vit-tagger-v3";
const SIZE = 448;

async function main() {
    const progress = (p) => {
        if (p.percent === null || p.percent % 25 === 0) {
            console.log(`[progress] ${p.message}`);
        }
    };

    if (!(await tagger.getStatus(MODEL)).downloaded) {
        console.log("downloading model through Electron runtime…");
        const result = await tagger.downloadModel(MODEL, progress);
        if (!result.success) {
            throw new Error(`download failed: ${result.error}`);
        }
    }

    // Solid red in BGR layout — expects "red theme"/"red background";
    // also proves the downloaded file parses as a valid model.
    const px = new Float32Array(SIZE * SIZE * 3);
    for (let i = 0; i < px.length; i += 3) px[i + 2] = 255;

    const result = await tagger.runAutotag(MODEL, px, progress);
    if (!result.success) throw new Error(result.error);
    console.log("tags:", result.tags.join(", "));
    if (!result.tags.some((t) => t.includes("red"))) {
        throw new Error("expected red-related tags");
    }
    console.log("ELECTRON TAGGER TEST OK");
}

app.whenReady().then(() =>
    main().then(
        () => app.exit(0),
        (err) => {
            console.error("FAILED:", err);
            app.exit(1);
        }
    )
);
