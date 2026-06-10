// Autotagger client.
//
// Two engines, picked automatically:
//   1. Native (preferred): in the desktop app, window.opentaggerNative
//      (electron/preload.cjs) runs ONNX inference in the main process.
//      The model is downloaded on first use after a consent flow.
//      This module does the image preprocessing — decode, white-pad to
//      a square, resize, RGBA→BGR float — because the renderer has
//      Canvas and the main process doesn't.
//   2. Legacy HTTP: the Python FastAPI backend on localhost:8081, for
//      plain-browser contexts or models the native engine lacks.

import { state } from "../core/state.js";
import { preferences } from "../core/preferences.js";
import { showConfirmationModal } from "../ui/modal.js";
import {
    setStatus,
    showProgress,
    hideProgress,
} from "../ui/statusBar.js";

const native = window.opentaggerNative ?? null;

// True while a model download is in flight; autotag entry points bail
// out (with feedback) instead of stacking concurrent setups.
let busy = false;

const BROWSER_UNAVAILABLE_MESSAGE =
    "Autotagging is unavailable in the browser: no backend is running.\n\n" +
    "Use the opentagger desktop app (autotagging is built in), or start " +
    "the legacy Python backend on localhost:8081 by running run.ps1 " +
    "(Windows) or run.sh (Linux/macOS) from the opentagger folder.";

const FEATURE_INTRO_MESSAGE =
    "Autotagging analyzes your images with a local AI tagger model and " +
    "adds the tags it detects to each entry automatically.\n\n" +
    "Everything runs on your own machine — no images are uploaded " +
    "anywhere. Before the first use, the app needs to download the " +
    "tagger model.\n\n" +
    "Set up autotagging now?";

function downloadConfirmMessage(label, sizeMB) {
    return (
        `Setup will download the ${label} model (about ${sizeMB} MB) ` +
        "into the app's data folder.\n\n" +
        "This is a one-time download. You can keep tagging manually " +
        "while it runs; autotag buttons are disabled until it finishes.\n\n" +
        "Download now?"
    );
}

function selectedModelId() {
    return preferences.tagging.autotagging.autotaggingModel.value;
}

function legacyEndpointPath(modelId) {
    switch (modelId) {
        case "wd-vit-tagger-v3":
            return "wd-vit-tagger-v3";
        case "it_so400m_patch14_siglip_384":
            return "redrocket-joint-tagger";
        default:
            return null;
    }
}

/** Probe the legacy HTTP backend. Returns health JSON or null. */
export async function probeBackend(timeoutMs = 2500) {
    try {
        const response = await fetch(state.HEALTH_CHECK_URL, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

function ask(message, yesText, noText) {
    return new Promise((resolve) => {
        showConfirmationModal(
            message,
            [
                { text: yesText, onClick: () => resolve(true) },
                {
                    text: noText,
                    class: "modal-button-default",
                    onClick: () => resolve(false),
                },
            ],
            () => resolve(false) // overlay dismissed
        );
    });
}

function setAutotagButtonsDisabled(disabled) {
    const allButton = document.getElementById("autotag-all-button");
    if (allButton) allButton.disabled = disabled;
    for (const button of document.querySelectorAll(
        "dataset-entry .autotag-entry"
    )) {
        button.disabled = disabled;
    }
}

function onTaggerProgress(payload) {
    if (payload.phase === "done" || payload.phase === "error") {
        hideProgress();
        setStatus(
            payload.phase === "done"
                ? "Autotagging ready"
                : "Autotag setup failed"
        );
        setAutotagButtonsDisabled(false);
        busy = false;
    } else {
        showProgress(
            payload.message ?? "Setting up autotagging…",
            payload.percent ?? null
        );
    }
}

/** Wire up progress display. Call once on app startup. */
export function initTagger() {
    if (!native) return;
    native.onTaggerProgress(onTaggerProgress);
    // If the renderer was reloaded mid-download, re-enter the busy UI
    // state; the progress listener takes it from there.
    native.taggerStatus(selectedModelId()).then((status) => {
        if (status.downloading) {
            busy = true;
            setAutotagButtonsDisabled(true);
            showProgress("Downloading tagger model…", null);
        }
    });
}

/**
 * Make sure some autotag engine is usable for the currently selected
 * model, walking the user through the first-run model download when
 * needed. Returns "native", "http", or null (not available / declined).
 */
export async function ensureAutotagReady() {
    const modelId = selectedModelId();

    if (native) {
        if (busy) {
            showConfirmationModal(
                "A tagger model is still downloading — progress is shown " +
                    "in the status bar at the bottom of the window.",
                [{ text: "OK" }]
            );
            return null;
        }
        const status = await native.taggerStatus(modelId);

        if (!status.supported) {
            // No ONNX build for this model — the legacy Python backend
            // is the only way to run it.
            if (await probeBackend()) return "http";
            showConfirmationModal(
                `The "${status.label}" model is not available in the ` +
                    "built-in tagger yet. Select wd-vit-tagger-v3 in " +
                    "Preferences, or run the legacy Python backend " +
                    "(run.ps1 / run.sh) to use it.",
                [{ text: "OK" }]
            );
            return null;
        }

        if (status.downloaded) return "native";

        if (!(await ask(FEATURE_INTRO_MESSAGE, "Yes, autotag", "Not now"))) {
            return null;
        }
        if (
            !(await ask(
                downloadConfirmMessage(
                    status.label,
                    status.approxDownloadMB
                ),
                "Download",
                "Cancel"
            ))
        ) {
            return null;
        }

        busy = true;
        setAutotagButtonsDisabled(true);
        setStatus("Downloading tagger model…");
        showProgress("Downloading tagger model…", null);
        const result = await native.taggerDownload(modelId);
        // onTaggerProgress resets busy/buttons on the done/error event.
        if (!result.success) {
            showConfirmationModal(
                `Model download failed:\n${result.error}\n\n` +
                    "You can retry by clicking any autotag button again.",
                [{ text: "OK" }]
            );
            return null;
        }
        return "native";
    }

    // Plain browser: only the legacy HTTP backend is possible.
    if (await probeBackend()) return "http";
    showConfirmationModal(BROWSER_UNAVAILABLE_MESSAGE, [{ text: "OK" }]);
    return null;
}

/**
 * Decode an image Blob and produce the model's input tensor data,
 * driven entirely by the `input` spec the main process serves with
 * taggerStatus: { size, layout, channelOrder, padColor, normalize }.
 */
async function preprocess(blob, input) {
    const {
        size,
        layout = "nhwc",
        channelOrder = "rgb",
        padColor = 255,
        normalize = null,
    } = input;

    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = `rgb(${padColor}, ${padColor}, ${padColor})`;
    ctx.fillRect(0, 0, size, size);

    const scale = Math.min(
        size / bitmap.width,
        size / bitmap.height
    );
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    bitmap.close();

    const { data } = ctx.getImageData(0, 0, size, size); // RGBA
    // Per-channel offsets into each RGBA pixel, in output order.
    const channels =
        channelOrder === "bgr" ? [2, 1, 0] : [0, 1, 2];
    const pixelCount = size * size;
    const out = new Float32Array(pixelCount * 3);

    for (let p = 0; p < pixelCount; p++) {
        for (let c = 0; c < 3; c++) {
            let value = data[p * 4 + channels[c]];
            if (normalize) {
                value =
                    (value / 255 - normalize.mean) / normalize.std;
            }
            // nhwc: [pixel][channel]; nchw: [channel][pixel]
            const index =
                layout === "nchw"
                    ? c * pixelCount + p
                    : p * 3 + c;
            out[index] = value;
        }
    }
    return out;
}

async function autotagNative(imageBlob, modelId, inputSpec) {
    const pixels = await preprocess(imageBlob, inputSpec);
    const result = await native.taggerRun(modelId, pixels);
    if (!result.success) {
        throw new Error(result.error || "Autotagging failed.");
    }
    return { tags: result.tags };
}

async function autotagHttp(imageBlob, imageName, modelId) {
    const endpointPath = legacyEndpointPath(modelId);
    if (!endpointPath) {
        throw new Error(`Unknown autotagging model: ${modelId}`);
    }
    const formData = new FormData();
    formData.append("image_upload", imageBlob, imageName || "image.png");

    const response = await fetch(
        `${state.AUTOTAG_API_URL}${endpointPath}`,
        { method: "POST", body: formData }
    );
    if (!response.ok) {
        let errorDetail = `HTTP error ${response.status}`;
        try {
            const errorJson = await response.json();
            errorDetail = errorJson.detail || errorDetail;
        } catch {
            errorDetail = (await response.text()) || errorDetail;
        }
        throw new Error(`Autotagging failed: ${errorDetail}`);
    }
    const result = await response.json();
    if (!Array.isArray(result.tags)) {
        throw new Error(
            "Autotagger returned an unexpected response format."
        );
    }
    return { tags: result.tags };
}

/**
 * Run the selected tagger on an image Blob/File. Returns { tags }.
 * Callers should gate user-initiated runs behind ensureAutotagReady().
 */
export async function autotagImage(imageBlob, imageName) {
    const modelId = selectedModelId();
    if (native) {
        const status = await native.taggerStatus(modelId);
        if (status.supported && status.downloaded) {
            return autotagNative(imageBlob, modelId, status.input);
        }
    }
    return autotagHttp(imageBlob, imageName, modelId);
}
