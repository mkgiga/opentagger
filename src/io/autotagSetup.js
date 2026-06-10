// Autotag backend availability and first-run environment setup.
//
// In the Electron app, window.opentaggerNative (see
// electron/preload.cjs) lets us install the Python environment on
// demand: first use walks the user through a two-step consent flow,
// then the main process downloads uv, provisions Python + dependencies
// into userData, and starts the backend. In a plain browser there is
// no native bridge, so we can only point the user at run.ps1/run.sh.

import { state } from "../core/state.js";
import { showConfirmationModal } from "../ui/modal.js";
import {
    setStatus,
    showProgress,
    hideProgress,
} from "../ui/statusBar.js";

const native = window.opentaggerNative ?? null;

// True while an install or backend start is in flight anywhere in the
// app; autotag entry points bail out (with feedback) instead of
// stacking concurrent setups.
let busy = false;

export const BACKEND_UNAVAILABLE_MESSAGE =
    "Autotagging is unavailable: the autotag backend is not running.\n\n" +
    "Autotagging needs a local Python server (autotag/api.py) listening " +
    "on localhost:8081. To set it up, run run.ps1 (Windows) or run.sh " +
    "(Linux/macOS) from the opentagger folder once — it creates a Python " +
    "virtual environment, installs the dependencies, and starts the " +
    "server. Once the venv exists, the desktop app starts the backend " +
    "automatically on launch.";

const FEATURE_INTRO_MESSAGE =
    "Autotagging analyzes your images with a local AI tagger model " +
    "(wd-vit-tagger-v3 or RedRocket JTP) and adds the tags it detects " +
    "to each entry automatically.\n\n" +
    "Everything runs on your own machine — no images are uploaded " +
    "anywhere. Before the first use, the app needs to set up a local " +
    "Python environment for the tagger.\n\n" +
    "Set up autotagging now?";

const DOWNLOAD_CONFIRM_MESSAGE =
    "Setup will download a private Python runtime and the AI " +
    "dependencies (PyTorch and friends) into the app's data folder — " +
    "roughly 3-6 GB. The tagger model itself (another 1-2 GB) is " +
    "downloaded the first time the backend starts.\n\n" +
    "This is a one-time setup. You can keep tagging manually while it " +
    "installs; autotag buttons are disabled until it finishes.\n\n" +
    "Download and install now?";

/**
 * Single quick probe of the backend /health endpoint. Returns the
 * health JSON when the backend is up, or null when it is unreachable.
 */
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

/** Poll /health until the backend responds. The first start can take
 * minutes — the server downloads its tagger model before listening. */
async function waitForBackend(maxRetries = 150, delayMs = 2000) {
    for (let i = 0; i < maxRetries; i++) {
        if (await probeBackend(1500)) return true;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return false;
}

function onInstallProgress(payload) {
    if (payload.phase === "done" || payload.phase === "error") {
        hideProgress();
        setStatus(
            payload.phase === "done"
                ? "Autotag environment installed"
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
export function initAutotagSetup() {
    if (!native) return;
    native.onAutotagProgress(onInstallProgress);
    // If the renderer was reloaded mid-install, re-enter the
    // installing UI state; the progress listener takes it from there.
    native.autotagStatus().then((status) => {
        if (status.installing) {
            busy = true;
            setAutotagButtonsDisabled(true);
            showProgress("Setting up autotagging…", null);
        }
    });
}

async function runInstall() {
    busy = true;
    setAutotagButtonsDisabled(true);
    setStatus("Setting up autotagging…");
    showProgress("Setting up autotagging…", null);

    const result = await native.autotagInstall();

    if (!result.success) {
        // onInstallProgress already reset the UI on the error event.
        showConfirmationModal(
            `Autotag setup failed:\n${result.error}\n\n` +
                "You can retry by clicking any autotag button again.",
            [{ text: "OK" }]
        );
        return;
    }

    // The main process starts the backend right after installing; the
    // first start downloads the tagger model before it can respond.
    busy = true;
    showProgress(
        "Starting autotag backend (first run downloads the tagger model)…",
        null
    );
    const ready = await waitForBackend();
    busy = false;
    hideProgress();
    setStatus(
        ready ? "Autotagging ready" : "Autotag backend not responding"
    );
    showConfirmationModal(
        ready
            ? "Autotagging is ready! Click an autotag button to tag your images."
            : "Setup finished, but the backend has not responded yet. It may " +
                  "still be downloading its model — try again in a few minutes.",
        [{ text: "OK" }]
    );
}

/**
 * Make sure the autotag backend is reachable, walking the user
 * through first-run setup when needed. Returns true when the caller
 * may proceed with an autotag request.
 */
export async function ensureAutotagReady() {
    if (await probeBackend()) return true;

    if (!native) {
        showConfirmationModal(BACKEND_UNAVAILABLE_MESSAGE, [
            { text: "OK" },
        ]);
        return false;
    }

    if (busy) {
        showConfirmationModal(
            "Autotagging setup is already in progress — progress is shown " +
                "in the status bar at the bottom of the window.",
            [{ text: "OK" }]
        );
        return false;
    }

    const status = await native.autotagStatus();

    if (!status.installed) {
        if (!(await ask(FEATURE_INTRO_MESSAGE, "Yes, autotag", "Not now"))) {
            return false;
        }
        if (
            !(await ask(
                DOWNLOAD_CONFIRM_MESSAGE,
                "Download & Install",
                "Cancel"
            ))
        ) {
            return false;
        }
        runInstall();
        return false;
    }

    // Installed but the backend isn't responding — (re)start it.
    busy = true;
    setStatus("Starting autotag backend…");
    showProgress(
        "Starting autotag backend (first run downloads the tagger model)…",
        null
    );
    const started = await native.autotagStart();
    const ready = started && (await waitForBackend());
    busy = false;
    hideProgress();
    setStatus(
        ready ? "Autotagging ready" : "Autotag backend not responding"
    );
    if (!ready) {
        showConfirmationModal(
            "The autotag backend could not be started. Check the application " +
                "logs for details.",
            [{ text: "OK" }]
        );
    }
    return ready;
}
