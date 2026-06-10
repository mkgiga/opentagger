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

const ort = require("onnxruntime-node");
const {
    existsSync,
    mkdirSync,
    rmSync,
    readFileSync,
    createWriteStream,
} = require("node:fs");
const { join } = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable, Transform } = require("node:stream");
const { storage, modelsDir } = require("./storage.cjs");

// Model registry.
//
// Spec shape:
//   label             display name
//   approxDownloadMB  shown in the consent dialog
//   files             { filename: url } — all downloaded on first use
//   input             how the renderer must preprocess pixels:
//     mode            "square" (default): pad to a size×size square;
//                     "fit": aspect-preserving resize, no padding,
//                     dims snapped to patchMultiple (needs a model
//                     with dynamic height/width axes)
//     size            square edge in px (square mode)
//     patchMultiple   dim snap granularity (fit mode)
//     maxSize         long-edge cap in px (fit mode)
//     layout          "nhwc" | "nchw"
//     channelOrder    "bgr" | "rgb"
//     padColor        0-255 grayscale fill behind non-square images
//     normalize       null = raw 0-255 floats, or { mean, std } applied
//                     to 0-1 scaled values; scalars apply uniformly,
//                     arrays are per-channel in RGB order
//   output            { activation: "none" | "sigmoid" } — "none" means
//                     the graph already emits probabilities
//   executionProviders optional EP list overriding the platform
//                     default (e.g. ["webgpu", "cpu"] for graphs whose
//                     dynamic shapes break DirectML)
//   vocabulary        { file, format: "wd-csv" | "jtp-json" |
//                     "idx2tag-json" }
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
    // DINOv3 ViT-H/16+ booru/furry tagger by lodestones. No official
    // ONNX; this is the community full-precision export of the same
    // checkpoint (silveroxides/tagger-experiment-onnx — the model's
    // pre-rename repo): a small graph plus 5.27GB external weights
    // that ORT loads from the adjacent model.onnx.data. Dynamic input
    // dims, so it runs the reference aspect-preserving preprocessing.
    // (The repo also has a 1.3GB int8 quantization, but it fails on
    // DirectML at run time and is, well, heavily quantized.)
    taggerine: {
        label: "Taggerine (DINOv3 ViT-H)",
        approxDownloadMB: 5400,
        files: {
            "model.onnx":
                "https://huggingface.co/silveroxides/tagger-experiment-onnx/resolve/main/tagger/model.onnx",
            "model.onnx.data":
                "https://huggingface.co/silveroxides/tagger-experiment-onnx/resolve/main/tagger/model.onnx.data",
            "vocab.json":
                "https://huggingface.co/lodestones/taggerine/resolve/main/tagger_vocab_with_categories.json",
        },
        input: {
            mode: "fit",
            patchMultiple: 16,
            maxSize: 1024,
            layout: "nchw",
            channelOrder: "rgb",
            normalize: {
                mean: [0.485, 0.456, 0.406],
                std: [0.229, 0.224, 0.225],
            },
        },
        output: { activation: "sigmoid" },
        // DirectML compiles fixed operator plans and dies at run time
        // on this graph's dynamic-dim Reshape; WebGPU handles dynamic
        // shapes (and is ~37x faster than CPU here).
        executionProviders: ["webgpu", "cpu"],
        vocabulary: { file: "vocab.json", format: "idx2tag-json" },
        thresholds: { general: 0.4 },
    },
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
const downloads = new Map(); // modelId -> in-flight download Promise

function modelDir(modelId) {
    return join(modelsDir, modelId);
}
// unstorage key for the completion flag; maps to
// <root>/models/<id>/download-complete.json on disk, so wiping the
// model directory removes it too.
function completeFlagKey(modelId) {
    return `models:${modelId}:download-complete.json`;
}
function isDownloaded(modelId) {
    return storage.hasItem(completeFlagKey(modelId));
}

async function getStatus(modelId) {
    const spec = MODELS[modelId];
    return {
        supported: Boolean(spec),
        downloaded: Boolean(spec) && (await isDownloaded(modelId)),
        downloading: downloads.has(modelId),
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
    // Progress is counted INSIDE the pipeline. Do not attach a `data`
    // listener to the body alongside pipeline() — two consumers on one
    // stream wrote chunks out of order under Electron, corrupting the
    // file while keeping its size correct.
    const counter = new Transform({
        transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (total) {
                progress({
                    phase: "download",
                    message: `Downloading ${label} (${(received / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB)…`,
                    percent: Math.round((received / total) * 100),
                });
            }
            callback(null, chunk);
        },
    });
    await pipeline(
        Readable.fromWeb(response.body),
        counter,
        createWriteStream(destPath)
    );
}

// Downloads all files for a model. The completion flag is written only
// after every file finished, so a crash/quit mid-download leaves no
// flag and the next attempt starts clean.
function downloadModel(modelId, progress) {
    if (downloads.has(modelId)) return downloads.get(modelId);
    const spec = MODELS[modelId];
    if (!spec) {
        return Promise.resolve({
            success: false,
            error: `Model "${modelId}" has no ONNX build available.`,
        });
    }
    const downloadPromise = (async () => {
        try {
            const dir = modelDir(modelId);
            if (existsSync(dir) && !(await isDownloaded(modelId))) {
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
            await storage.setItem(completeFlagKey(modelId), {
                completedAt: new Date().toISOString(),
            });
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
            downloads.delete(modelId);
        }
    })();
    downloads.set(modelId, downloadPromise);
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
        case "idx2tag-json": {
            // { "idx2tag": ["tag", ...] } — index-aligned with the
            // logits vector, all "general"
            return JSON.parse(raw).idx2tag.map((name) => ({
                name,
                category: "general",
            }));
        }
        default:
            throw new Error(
                `Unknown vocabulary format: ${spec.vocabulary.format}`
            );
    }
}

function preferredExecutionProviders(spec) {
    if (spec.executionProviders) return spec.executionProviders;
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
    let cpuOnly = false;
    const providers = preferredExecutionProviders(spec);
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
        try {
            session = await ort.InferenceSession.create(modelPath, {
                executionProviders: ["cpu"],
            });
            cpuOnly = true;
        } catch (cpuErr) {
            if (/protobuf parsing failed|load model/i.test(cpuErr.message)) {
                // The file on disk is unreadable as a model — wipe it
                // so the next attempt re-downloads instead of failing
                // forever.
                rmSync(modelDir(modelId), {
                    recursive: true,
                    force: true,
                });
                throw new Error(
                    `The downloaded ${spec.label} model file was corrupted ` +
                        "and has been removed. Click an autotag button " +
                        "to download it again."
                );
            }
            throw cpuErr;
        }
    }

    const entry = {
        session,
        cpuOnly,
        vocabulary: loadVocabulary(modelId, spec),
    };
    sessions.set(modelId, entry);
    // Terminal event so the renderer's progress bar doesn't stay
    // stuck on the "Loading…" message.
    progress({
        phase: "done",
        message: `${spec.label} loaded.`,
        percent: null,
    });
    return entry;
}

function prettifyTag(name, replaceUnderscores) {
    if (!replaceUnderscores || KAOMOJI.has(name)) return name;
    return name.replaceAll("_", " ");
}

function tensorDims(input, width, height) {
    return input.layout === "nchw"
        ? [1, 3, height, width]
        : [1, height, width, 3];
}

// `pixels` is { data: Float32Array, width, height } preprocessed by
// the renderer according to the model's `input` spec. User
// preferences arrive via `options`: `thresholds` ({ category: cutoff })
// overrides the spec's defaults, `replaceUnderscores` (default true)
// controls tag-name prettifying.
async function runAutotag(modelId, pixels, progress, options = {}) {
    const spec = MODELS[modelId];
    if (!spec) {
        return {
            success: false,
            error: `Model "${modelId}" has no ONNX build available.`,
        };
    }
    if (!(await isDownloaded(modelId))) {
        return {
            success: false,
            error: `Model "${modelId}" is not downloaded.`,
        };
    }

    try {
        let entry = await getSession(modelId, spec, progress);
        const { width, height } = pixels;
        const data =
            pixels.data instanceof Float32Array
                ? pixels.data
                : new Float32Array(pixels.data);
        if (data.length !== width * height * 3) {
            throw new Error(
                `Pixel data length ${data.length} does not match ${width}x${height}x3.`
            );
        }
        const input = new ort.Tensor(
            "float32",
            data,
            tensorDims(spec.input, width, height)
        );

        let results;
        try {
            results = await entry.session.run({
                [entry.session.inputNames[0]]: input,
            });
        } catch (runErr) {
            // Some models create a session fine on a GPU EP but fail
            // at run time (unsupported ops, dynamic shapes). Retry
            // once on CPU and keep the CPU session for future runs.
            if (entry.cpuOnly) throw runErr;
            console.warn(
                `[opentagger] ${modelId} failed at run time on GPU EP (${runErr.message}); retrying on CPU.`
            );
            progress({
                phase: "load",
                message: `Reloading ${spec.label} on CPU…`,
                percent: null,
            });
            const cpuSession = await ort.InferenceSession.create(
                join(modelDir(modelId), "model.onnx"),
                { executionProviders: ["cpu"] }
            );
            entry = {
                session: cpuSession,
                cpuOnly: true,
                vocabulary: entry.vocabulary,
            };
            sessions.set(modelId, entry);
            progress({
                phase: "done",
                message: `${spec.label} loaded (CPU).`,
                percent: null,
            });
            results = await entry.session.run({
                [entry.session.inputNames[0]]: input,
            });
        }
        const { vocabulary } = entry;
        const scores = results[entry.session.outputNames[0]].data;

        const thresholds = {
            ...spec.thresholds,
            ...(options?.thresholds ?? {}),
        };
        const replaceUnderscores = options?.replaceUnderscores ?? true;
        const matched = [];
        const count = Math.min(scores.length, vocabulary.length);
        for (let i = 0; i < count; i++) {
            const entry = vocabulary[i];
            if (!entry || entry.category === null) continue;
            const threshold = thresholds[entry.category];
            if (threshold === undefined) continue;
            const score =
                spec.output.activation === "sigmoid"
                    ? 1 / (1 + Math.exp(-scores[i]))
                    : scores[i];
            if (score >= threshold) {
                matched.push({
                    name: prettifyTag(entry.name, replaceUnderscores),
                    score,
                });
            }
        }
        matched.sort((a, b) => b.score - a.score);
        return { success: true, tags: matched.map((t) => t.name) };
    } catch (err) {
        console.error("[opentagger] Autotag inference failed:", err);
        // Terminal event in case a "load" progress message is showing.
        progress({
            phase: "error",
            message: `Autotagging failed: ${err.message}`,
            percent: null,
        });
        return { success: false, error: err.message };
    }
}

module.exports = { getStatus, downloadModel, runAutotag };
