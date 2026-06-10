// In-process ONNX autotagger.
//
// Owns everything model-related in the main process: downloading
// model files into userData/models/<id>/ (with an interrupted-download
// guard), creating ONNX Runtime sessions with the best execution
// provider for the platform, and running inference on preprocessed
// pixel data sent from the renderer.
//
// The renderer does the image decoding/resizing (it has Canvas; the
// main process doesn't) and sends a Float32Array built from the
// model's `input` spec, which it receives via getStatus. Tag mapping
// and thresholding happen here so the renderer gets back a plain list
// of tag names.
//
// Models are described declaratively in MODELS — one generic pipeline
// interprets the spec, so supporting a new tagger is (usually) just a
// new registry entry. If a model ever needs real logic that the spec
// can't express, give its entry an optional function field (e.g.
// `postprocess`) and call it from the pipeline — don't fork the
// pipeline per model.

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

// Model registry.
//
// Spec shape:
//   label             display name
//   approxDownloadMB  shown in the consent dialog
//   files             { filename: url } — all downloaded on first use
//   input             how the renderer must preprocess pixels:
//     size            square edge in px
//     layout          "nhwc" | "nchw"  (tensor dims [1,s,s,3] / [1,3,s,s])
//     channelOrder    "bgr" | "rgb"
//     padColor        0-255 grayscale fill behind non-square images
//     normalize       null = raw 0-255 floats, or { mean, std } applied
//                     to 0-1 scaled values, uniform across channels
//   output            { activation: "none" | "sigmoid" } — "none" means
//                     the graph already emits probabilities
//   vocabulary        { file, format: "wd-csv" | "jtp-json" }
//   thresholds        per-category score cutoffs; categories a model's
//                     vocabulary lacks are simply never matched
//
// `null` marks a model the UI knows about but that has no ONNX build
// yet (JTP only ships PyTorch safetensors; autotag/export_jtp_onnx.py
// produces one — host it, then fill in the entry like:
//   {
//     label: "RedRocket JTP PILOT",
//     approxDownloadMB: 1700,
//     files: { "model.onnx": "<hosted url>", "tags.json": "<hosted url>" },
//     input: { size: 384, layout: "nchw", channelOrder: "rgb",
//              padColor: 128, normalize: { mean: 0.5, std: 0.5 } },
//     output: { activation: "sigmoid" },
//     vocabulary: { file: "tags.json", format: "jtp-json" },
//     thresholds: { general: 0.2 },
//   }
const MODELS = {
    "wd-vit-tagger-v3": {
        label: "WD ViT Tagger v3",
        approxDownloadMB: 400,
        files: {
            "model.onnx":
                "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/model.onnx",
            "selected_tags.csv":
                "https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/main/selected_tags.csv",
        },
        input: {
            size: 448,
            layout: "nhwc",
            channelOrder: "bgr",
            padColor: 255,
            normalize: null,
        },
        output: { activation: "none" },
        vocabulary: { file: "selected_tags.csv", format: "wd-csv" },
        thresholds: { general: 0.35, character: 0.85 },
    },
    it_so400m_patch14_siglip_384: null,
};

// wd-csv category ids -> threshold keys. Category 9 (rating) has no
// entry on purpose: rating tags are never emitted.
const WD_CSV_CATEGORIES = { 0: "general", 4: "character" };

// Tags that are kaomoji keep their underscores; everything else gets
// underscores converted to spaces (matching common wd-tagger usage).
const KAOMOJI = new Set([
    "0_0", "(o)_(o)", "+_+", "+_-", "._.", "<o>_<o>", "<|>_<|>",
    "=_=", ">_<", "3_3", "6_9", ">_o", "@_@", "^_^", "o_o", "u_u",
    "x_x", "|_|", "||_||",
]);

const sessions = new Map(); // modelId -> { session, vocabulary }
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
        input: spec ? spec.input : null,
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

// Returns [{ name, category }] where category is a key of the model's
// `thresholds` (entries with unknown categories never match).
function loadVocabulary(modelId, spec) {
    const raw = readFileSync(
        join(modelDir(modelId), spec.vocabulary.file),
        "utf-8"
    );

    switch (spec.vocabulary.format) {
        case "wd-csv": {
            // tag_id,name,category,count
            const entries = [];
            const lines = raw.split("\n");
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                const parts = line.split(",");
                if (parts.length < 3) continue;
                entries.push({
                    name: parts[1],
                    category: WD_CSV_CATEGORIES[Number(parts[2])] ?? null,
                });
            }
            return entries;
        }
        case "jtp-json": {
            // { "tag_name": class_index } — flat, all "general"
            const map = JSON.parse(raw);
            const entries = [];
            for (const [name, index] of Object.entries(map)) {
                entries[index] = { name, category: "general" };
            }
            return entries;
        }
        default:
            throw new Error(
                `Unknown vocabulary format: ${spec.vocabulary.format}`
            );
    }
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

async function getSession(modelId, spec, progress) {
    if (sessions.has(modelId)) return sessions.get(modelId);

    const modelPath = join(modelDir(modelId), "model.onnx");
    progress({
        phase: "load",
        message: `Loading ${spec.label} (first run takes a moment)…`,
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

    const entry = { session, vocabulary: loadVocabulary(modelId, spec) };
    sessions.set(modelId, entry);
    return entry;
}

function prettifyTag(name) {
    return KAOMOJI.has(name) ? name : name.replaceAll("_", " ");
}

function tensorDims(input) {
    return input.layout === "nchw"
        ? [1, 3, input.size, input.size]
        : [1, input.size, input.size, 3];
}

// `pixels` is a Float32Array preprocessed by the renderer according to
// the model's `input` spec.
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
        const { session, vocabulary } = await getSession(
            modelId,
            spec,
            progress
        );
        const data =
            pixels instanceof Float32Array
                ? pixels
                : new Float32Array(pixels.buffer ?? pixels);
        const input = new ort.Tensor("float32", data, tensorDims(spec.input));

        const results = await session.run({
            [session.inputNames[0]]: input,
        });
        const scores = results[session.outputNames[0]].data;

        const matched = [];
        const count = Math.min(scores.length, vocabulary.length);
        for (let i = 0; i < count; i++) {
            const entry = vocabulary[i];
            if (!entry || entry.category === null) continue;
            const threshold = spec.thresholds[entry.category];
            if (threshold === undefined) continue;
            const score =
                spec.output.activation === "sigmoid"
                    ? 1 / (1 + Math.exp(-scores[i]))
                    : scores[i];
            if (score >= threshold) {
                matched.push({ name: prettifyTag(entry.name), score });
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
