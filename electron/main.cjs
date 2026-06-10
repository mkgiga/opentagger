// Electron main process.
//
// CommonJS rather than ESM because Electron 32 + Node 20 still trips
// over `import` of the `electron` module in some configurations. The
// renderer is unaffected -- it still loads the Vite ESM bundle.
//
// Responsibilities:
//   1. Open a BrowserWindow pointing at the Vite-built frontend
//      (dist/index.html), or at the dev server when ELECTRON_DEV=1.
//   2. Manage the Python autotag environment: on the renderer's
//      request, download uv, provision a Python 3.11 venv, and install
//      the autotag dependencies into the app's userData folder.
//   3. Spawn the FastAPI autotag backend as a child process when an
//      installed environment exists. Kill it on quit.
//
// The backend is optional: nothing is installed or spawned until the
// user opts into autotagging from the UI. We never block startup
// waiting on Python.

const { app, BrowserWindow, shell, ipcMain } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const {
    existsSync,
    mkdirSync,
    rmSync,
    readdirSync,
    readFileSync,
    writeFileSync,
    createWriteStream,
} = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

// ELECTRON_DEV is set by the `npm run electron:dev` script. In
// packaged builds app.isPackaged is true anyway, but the env var is
// the explicit signal that the Vite dev server is running.
const isDev = !app.isPackaged && process.env.ELECTRON_DEV === "1";

// The two roots disagree in packaged mode:
//   - distRoot is `..` relative to this file. In dev that's the
//     project root; in a packaged build __dirname is
//     `<app>/resources/app.asar/electron/`, so `..` is
//     `<app>/resources/app.asar/` -- which is where Forge put dist/.
//   - autotagRoot needs to live OUTSIDE the asar (Python can't read
//     files from inside an asar archive). The Forge `extraResource`
//     config copies it to `<app>/resources/autotag/`, which is what
//     process.resourcesPath points at.
const distRoot = join(__dirname, "..");
const autotagDir = app.isPackaged
    ? join(process.resourcesPath, "autotag")
    : join(__dirname, "..", "autotag");

let mainWindow = null;
let pythonProcess = null;
let installPromise = null;
const installChildren = new Set();

// --- Autotag environment paths ---
//
// The provisioned environment lives under userData, not next to the
// app: resources/ may be read-only and must survive app updates.
// `install-complete.json` is written only after a fully successful
// install -- a venv without it is a leftover from an interrupted
// install and gets wiped before retrying.

function envRoot() {
    return join(app.getPath("userData"), "autotag-env");
}
function managedVenvDir() {
    return join(envRoot(), ".venv");
}
function installFlagPath() {
    return join(envRoot(), "install-complete.json");
}
function venvPython(venvDir) {
    return process.platform === "win32"
        ? join(venvDir, "Scripts", "python.exe")
        : join(venvDir, "bin", "python");
}

// A developer-created venv in the repo (via run.ps1 / run.sh) takes
// precedence over the managed one.
function resolvePython() {
    const legacy = venvPython(join(autotagDir, ".venv"));
    if (existsSync(legacy)) return legacy;
    if (existsSync(installFlagPath())) {
        const managed = venvPython(managedVenvDir());
        if (existsSync(managed)) return managed;
    }
    return null;
}

// --- uv resolution / download ---

function uvExeName() {
    return process.platform === "win32" ? "uv.exe" : "uv";
}

function uvAssetName() {
    const arm = process.arch === "arm64";
    switch (process.platform) {
        case "win32":
            return arm
                ? "uv-aarch64-pc-windows-msvc.zip"
                : "uv-x86_64-pc-windows-msvc.zip";
        case "darwin":
            return arm
                ? "uv-aarch64-apple-darwin.tar.gz"
                : "uv-x86_64-apple-darwin.tar.gz";
        default:
            return arm
                ? "uv-aarch64-unknown-linux-gnu.tar.gz"
                : "uv-x86_64-unknown-linux-gnu.tar.gz";
    }
}

// Returns a path (or PATH-resolvable name) to a usable uv binary,
// downloading one from GitHub releases if necessary.
async function ensureUv(progress) {
    const exe = uvExeName();
    const candidates = [
        // Optionally bundled with the app (resources/uv/).
        app.isPackaged
            ? join(process.resourcesPath, "uv", exe)
            : join(__dirname, "..", "uv", exe),
        // Downloaded by a previous install attempt.
        join(envRoot(), "uv", exe),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
    }
    if (spawnSync(exe, ["--version"]).status === 0) return exe;

    const asset = uvAssetName();
    const url = `https://github.com/astral-sh/uv/releases/latest/download/${asset}`;
    const destDir = join(envRoot(), "uv");
    mkdirSync(destDir, { recursive: true });
    const archivePath = join(destDir, asset);

    progress({ phase: "uv", message: "Downloading uv…", percent: 0 });
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`uv download failed: HTTP ${response.status}`);
    }
    const total = Number(response.headers.get("content-length")) || 0;
    let received = 0;
    const body = Readable.fromWeb(response.body);
    body.on("data", (chunk) => {
        received += chunk.length;
        if (total) {
            progress({
                phase: "uv",
                message: "Downloading uv…",
                percent: Math.round((received / total) * 100),
            });
        }
    });
    await pipeline(body, createWriteStream(archivePath));

    progress({ phase: "uv", message: "Extracting uv…", percent: null });
    // tar on every supported platform handles both .zip (Windows
    // bsdtar) and .tar.gz archives.
    const extract = spawnSync("tar", ["-xf", archivePath, "-C", destDir]);
    if (extract.status !== 0) {
        throw new Error(
            `Failed to extract uv archive: ${extract.stderr || extract.error}`
        );
    }
    rmSync(archivePath, { force: true });

    // The binary sits at the archive root (Windows zip) or inside a
    // single platform-named subdirectory (unix tarballs).
    let binary = join(destDir, exe);
    if (!existsSync(binary)) {
        for (const entry of readdirSync(destDir, { withFileTypes: true })) {
            const nested = join(destDir, entry.name, exe);
            if (entry.isDirectory() && existsSync(nested)) {
                binary = nested;
                break;
            }
        }
    }
    if (!existsSync(binary)) {
        throw new Error("uv binary not found after extraction.");
    }
    return binary;
}

// --- Environment provisioning ---

function runUvStep(uvPath, args, progress, phase, label) {
    return new Promise((resolve, reject) => {
        progress({ phase, message: label, percent: null });
        const child = spawn(uvPath, args, {
            env: { ...process.env, UV_NO_COLOR: "1" },
        });
        installChildren.add(child);
        let recentOutput = "";
        const onData = (buffer) => {
            const text = buffer.toString();
            recentOutput = (recentOutput + text).slice(-4000);
            const line = text
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean)
                .pop();
            if (line) {
                progress({
                    phase,
                    message: `${label} ${line}`,
                    percent: null,
                });
            }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", (err) => {
            installChildren.delete(child);
            reject(err);
        });
        child.on("exit", (code) => {
            installChildren.delete(child);
            if (code === 0) {
                resolve();
            } else {
                reject(
                    new Error(
                        `${label} failed (exit ${code}): ${recentOutput.slice(-500)}`
                    )
                );
            }
        });
    });
}

async function installAutotagEnv(progress) {
    const requirements = join(autotagDir, "requirements.txt");
    if (!existsSync(requirements)) {
        throw new Error(`requirements.txt not found at ${requirements}`);
    }

    // A venv without the completion flag is an interrupted install.
    if (existsSync(managedVenvDir()) && !existsSync(installFlagPath())) {
        progress({
            phase: "python",
            message: "Removing incomplete previous install…",
            percent: null,
        });
        rmSync(managedVenvDir(), { recursive: true, force: true });
    }
    rmSync(installFlagPath(), { force: true });

    const uvPath = await ensureUv(progress);
    await runUvStep(
        uvPath,
        ["venv", "--python", "3.11", managedVenvDir()],
        progress,
        "python",
        "Installing Python 3.11…"
    );
    await runUvStep(
        uvPath,
        [
            "pip",
            "install",
            "-r",
            requirements,
            "--python",
            venvPython(managedVenvDir()),
        ],
        progress,
        "deps",
        "Installing dependencies (several GB, this can take a while)…"
    );

    writeFileSync(
        installFlagPath(),
        JSON.stringify(
            {
                completedAt: new Date().toISOString(),
                requirementsHash: createHash("sha256")
                    .update(readFileSync(requirements))
                    .digest("hex"),
            },
            null,
            2
        )
    );
}

// --- Backend process management ---

function startPythonBackend() {
    if (pythonProcess && !pythonProcess.killed) return;

    const python = resolvePython();
    if (!python) {
        console.log(
            "[opentagger] Autotag environment not installed; backend not started."
        );
        return;
    }

    const apiScript = join(autotagDir, "api.py");
    if (!existsSync(apiScript)) {
        console.warn(
            `[opentagger] autotag/api.py not found at ${apiScript}; skipping backend.`
        );
        return;
    }

    console.log(`[opentagger] Starting Python backend: ${python} ${apiScript}`);
    pythonProcess = spawn(python, [apiScript], {
        cwd: autotagDir,
        stdio: "inherit",
        env: { ...process.env, OPENTAGGER_NO_BROWSER: "1" },
    });

    pythonProcess.on("error", (err) => {
        console.error("[opentagger] Failed to start Python backend:", err);
        pythonProcess = null;
    });

    pythonProcess.on("exit", (code, signal) => {
        console.log(
            `[opentagger] Python backend exited (code=${code}, signal=${signal}).`
        );
        pythonProcess = null;
    });
}

function stopPythonBackend() {
    if (!pythonProcess || pythonProcess.killed) return;
    console.log("[opentagger] Stopping Python backend...");
    pythonProcess.kill();
    pythonProcess = null;
}

function killInstallChildren() {
    for (const child of installChildren) {
        try {
            child.kill();
        } catch {
            // already gone
        }
    }
    installChildren.clear();
}

// --- IPC ---

function sendProgress(payload) {
    console.log(`[opentagger] autotag setup: ${payload.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("autotag:progress", payload);
    }
}

function registerIpcHandlers() {
    ipcMain.handle("autotag:status", () => ({
        installed: Boolean(resolvePython()),
        installing: Boolean(installPromise),
        backendRunning: Boolean(pythonProcess && !pythonProcess.killed),
    }));

    ipcMain.handle("autotag:install", () => {
        if (installPromise) return installPromise;
        installPromise = (async () => {
            try {
                await installAutotagEnv(sendProgress);
                sendProgress({
                    phase: "done",
                    message: "Autotag environment installed.",
                    percent: 100,
                });
                startPythonBackend();
                return { success: true };
            } catch (err) {
                console.error("[opentagger] Autotag install failed:", err);
                sendProgress({
                    phase: "error",
                    message: `Setup failed: ${err.message}`,
                    percent: null,
                });
                return { success: false, error: err.message };
            } finally {
                installPromise = null;
            }
        })();
        return installPromise;
    });

    ipcMain.handle("autotag:start", () => {
        if (!resolvePython()) return false;
        startPythonBackend();
        return true;
    });
}

// --- Window ---

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: "opentagger",
        backgroundColor: "#f0f0f0",
        webPreferences: {
            preload: join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    if (isDev) {
        mainWindow.loadURL("http://localhost:5173");
        mainWindow.webContents.openDevTools({ mode: "detach" });
    } else {
        mainWindow.loadFile(join(distRoot, "dist", "index.html"));
    }

    // Open external links in the user's browser instead of in-app.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            shell.openExternal(url);
            return { action: "deny" };
        }
        return { action: "allow" };
    });
}

app.whenReady().then(() => {
    registerIpcHandlers();
    startPythonBackend();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    stopPythonBackend();
    killInstallChildren();
    if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
    stopPythonBackend();
    killInstallChildren();
});
