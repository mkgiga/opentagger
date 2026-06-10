// In-process ONNX autotagger.
//
// Owns everything model-related in the main process: downloading
// model files into userData/models/<id>/ (with an interrupted-download
// guard), creating ONNX Runtime sessions with the best execution
// provider for the platform, and running inference on preprocessed
// pixel data sent from the renderer.
//
// The renderer does the image decoding/resizing (it has Canvas; the
// main process doesn't) and sends a Float32Array in the model's input
// layout. Tag mapping and thresholding happen here so the renderer
// gets back a plain list of tag names.

const { app } = require("electron");
const ort = require("onnxruntime-node");
const {
    existsSync,
    mkdirSync,
    rmSync,
    readFileSync,
    writeFileSync,
    createWriteStream,
} = require("node:fs");
const { join } = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

// Model registry. `null` marks a model the UI knows about but that has
// no ONNX build yet (JTP only ships PyTorch safetensors; see
// autotag/export_jtp_onnx.py for producing one).
const MODELS = {
    "wd-vit-tagger-v3": {
        label: "WD ViT Tagger v3",
        files: {
            "model.onnx":
                "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx",
            "selected_tags.csv":
                "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv",
        },
        approxDownloadMB: 400,
        inputSize: 448,
    },
    it_so400m_patch14_siglip_384: null,
};

// wd-tagger conventions: category ids in selected_tags.csv and the
// usual confidence thresholds for each.
const CATEGORY_GENERAL = 0;
const CATEGORY_CHARACTER = 4;
const GENERAL_THRESHOLD = 0.35;
const CHARACTER_THRESHOLD = 0.85;

// Tags that are kaomoji keep their underscores; everything else gets
// underscores converted to spaces (matching common wd-tagger usage).
const KAOMOJI = new Set([
    "0_0", "(o)_(o)", "+_+", "+_-", "._.", "<o>_<o>", "<|>_<|>",
    "=_=", ">_<", "3_3", "6_9", ">_o", "@_@", "^_^", "o_o", "u_u",
    "x_x", "|_|", "||_||",
]);

const sessions = new Map(); // modelId -> { session, tags }
let downloadPromise = null;

function modelDir(modelId) {
    return join(app.getPath("userData"), "models", modelId);
}
function completeFlagPath(modelId) {
    return join(modelDir(modelId), "download-complete.json");
}

function getStatus(modelId) {
    const spec = MODELS[modelId];
    return {
        supported: Boolean(spec),
        downloaded: Boolean(spec) && existsSync(completeFlagPath(modelId)),
        downloading: Boolean(downloadPromise),
        approxDownloadMB: spec ? spec.approxDownloadMB : 0,
        label: spec ? spec.label : modelId,
    };
}

async function downloadFile(url, destPath, label, progress) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
    }
    const total = Number(response.headers.get("content-length")) || 0;
    let received = 0;
    const body = Readable.fromWeb(response.body);
    body.on("data", (chunk) => {
        received += chunk.length;
        if (total) {
            progress({
                phase: "download",
                message: `Downloading ${label} (${(received / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB)…`,
                percent: Math.round((received / total) * 100),
            });
        }
    });
    await pipeline(body, createWriteStream(destPath));
}

// Downloads all files for a model. The completion flag is written only
// after every file finished, so a crash/quit mid-download leaves no
// flag and the next attempt starts clean.
function downloadModel(modelId, progress) {
    if (downloadPromise) return downloadPromise;
    const spec = MODELS[modelId];
    if (!spec) {
        return Promise.resolve({
            success: false,
            error: `Model "${modelId}" has no ONNX build available.`,
        });
    }
    downloadPromise = (async () => {
        try {
            const dir = modelDir(modelId);
            if (existsSync(dir) && !existsSync(completeFlagPath(modelId))) {
                rmSync(dir, { recursive: true, force: true });
            }
            mkdirSync(dir, { recursive: true });
            for (const [filename, url] of Object.entries(spec.files)) {
                await downloadFile(
                    url,
                    join(dir, filename),
                    `${spec.label}: ${filename}`,
                    progress
                );
            }
            writeFileSync(
                completeFlagPath(modelId),
                JSON.stringify(
                    { completedAt: new Date().toISOString() },
                    null,
                    2
                )
            );
            progress({
                phase: "done",
                message: `${spec.label} downloaded.`,
                percent: 100,
            });
            return { success: true };
        } catch (err) {
            console.error("[opentagger] Model download failed:", err);
            progress({
                phase: "error",
                message: `Download failed: ${err.message}`,
                percent: null,
            });
            return { success: false, error: err.message };
        } finally {
            downloadPromise = null;
        }
    })();
    return downloadPromise;
}

// selected_tags.csv: tag_id,name,category,count
function loadTags(modelId) {
    const csv = readFileSync(
        join(modelDir(modelId), "selected_tags.csv"),
        "utf-8"
    );
    const tags = [];
    const lines = csv.split("\n");
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(",");
        if (parts.length < 3) continue;
        tags.push({
            name: parts[1],
            category: Number(parts[2]),
        });
    }
    return tags;
}

function preferredExecutionProviders() {
    switch (process.platform) {
        case "win32":
            return ["dml", "cpu"];
        case "darwin":
            return ["coreml", "cpu"];
        default:
            return ["cuda", "cpu"];
    }
}

async function getSession(modelId, progress) {
    if (sessions.has(modelId)) return sessions.get(modelId);

    const modelPath = join(modelDir(modelId), "model.onnx");
    progress({
        phase: "load",
        message: `Loading ${MODELS[modelId].label} (first run takes a moment)…`,
        percent: null,
    });

    let session;
    const providers = preferredExecutionProviders();
    try {
        session = await ort.InferenceSession.create(modelPath, {
            executionProviders: providers,
        });
        console.log(
            `[opentagger] ONNX session for ${modelId} created (EPs: ${providers.join(", ")})`
        );
    } catch (err) {
        console.warn(
            `[opentagger] EPs [${providers.join(", ")}] failed (${err.message}); falling back to CPU.`
        );
        session = await ort.InferenceSession.create(modelPath, {
            executionProviders: ["cpu"],
        });
    }

    const entry = { session, tags: loadTags(modelId) };
    sessions.set(modelId, entry);
    return entry;
}

function prettifyTag(name) {
    return KAOMOJI.has(name) ? name : name.replaceAll("_", " ");
}

// `pixels` is Float32Array NHWC BGR 0-255, length inputSize².3,
// produced by the renderer's preprocessing.
async function runAutotag(modelId, pixels, progress) {
    const spec = MODELS[modelId];
    if (!spec) {
        return {
            success: false,
            error: `Model "${modelId}" has no ONNX build available.`,
        };
    }
    if (!existsSync(completeFlagPath(modelId))) {
        return {
            success: false,
            error: `Model "${modelId}" is not downloaded.`,
        };
    }

    try {
        const { session, tags } = await getSession(modelId, progress);
        const size = spec.inputSize;
        const data =
            pixels instanceof Float32Array
                ? pixels
                : new Float32Array(pixels.buffer ?? pixels);
        const input = new ort.Tensor("float32", data, [1, size, size, 3]);

        const results = await session.run({
            [session.inputNames[0]]: input,
        });
        const scores = results[session.outputNames[0]].data;

        const matched = [];
        const count = Math.min(scores.length, tags.length);
        for (let i = 0; i < count; i++) {
            const { name, category } = tags[i];
            const score = scores[i];
            if (
                (category === CATEGORY_GENERAL &&
                    score >= GENERAL_THRESHOLD) ||
                (category === CATEGORY_CHARACTER &&
                    score >= CHARACTER_THRESHOLD)
            ) {
                matched.push({ name: prettifyTag(name), score });
            }
        }
        matched.sort((a, b) => b.score - a.score);
        return { success: true, tags: matched.map((t) => t.name) };
    } catch (err) {
        console.error("[opentagger] Autotag inference failed:", err);
        return { success: false, error: err.message };
    }
}

module.exports = { getStatus, downloadModel, runAutotag };
