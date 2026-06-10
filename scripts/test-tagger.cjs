// Standalone smoke test for electron/tagger.cjs, runnable under plain
// Node. Stubs the electron `app` module so the real download/session/
// inference code path runs. Downloads the wd-vit-tagger-v3 model
// (~400MB, cached in .cache/tagger-test/) on first run.
//
//   node scripts/test-tagger.cjs

const Module = require("node:module");
const { join } = require("node:path");

const cacheDir = join(__dirname, "..", ".cache", "tagger-test");
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
    if (request === "electron") {
        return { app: { getPath: () => cacheDir } };
    }
    return originalLoad.call(this, request, ...rest);
};

const tagger = require("../electron/tagger.cjs");

const MODEL = "wd-vit-tagger-v3";
const SIZE = 448;

function syntheticImage() {
    // Plain white canvas — the tagger should report things like
    // "white background" / "simple background" / "no humans".
    return new Float32Array(SIZE * SIZE * 3).fill(255);
}

async function main() {
    const progress = (p) =>
        console.log(`[progress] ${p.message} ${p.percent ?? ""}`);

    let status = tagger.getStatus(MODEL);
    console.log("status:", status);

    if (!status.downloaded) {
        console.log("downloading model…");
        const result = await tagger.downloadModel(MODEL, progress);
        if (!result.success) {
            throw new Error(`download failed: ${result.error}`);
        }
    }

    console.log("running inference on a white image…");
    const t0 = Date.now();
    const result = await tagger.runAutotag(
        MODEL,
        syntheticImage(),
        progress
    );
    console.log(`inference took ${Date.now() - t0}ms`);
    if (!result.success) throw new Error(result.error);
    console.log("tags:", result.tags.join(", "));

    const t1 = Date.now();
    const second = await tagger.runAutotag(
        MODEL,
        syntheticImage(),
        progress
    );
    console.log(
        `second run took ${Date.now() - t1}ms (session cached): ${second.tags.length} tags`
    );
}

main().then(
    () => {
        console.log("OK");
        process.exit(0);
    },
    (err) => {
        console.error("FAILED:", err);
        process.exit(1);
    }
);
