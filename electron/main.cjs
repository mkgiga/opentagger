// Electron main process.
//
// CommonJS rather than ESM because Electron 32 + Node 20 still trips
// over `import` of the `electron` module in some configurations. The
// renderer is unaffected -- it still loads the Vite ESM bundle.
//
// Responsibilities:
//   1. Open a BrowserWindow pointing at the Vite-built frontend
//      (dist/index.html), or at the dev server when ELECTRON_DEV=1.
//   2. Spawn the FastAPI autotag backend as a child process if a
//      Python venv is found alongside the app. Kill it on quit.
//
// The backend is optional: if no venv exists, autotag features will
// fail gracefully (the frontend already handles that). We never block
// startup waiting on Python.

const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

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

function pythonExecutablePath() {
    const venv = join(autotagDir, ".venv");
    return process.platform === "win32"
        ? join(venv, "Scripts", "python.exe")
        : join(venv, "bin", "python");
}

function startPythonBackend() {
    const python = pythonExecutablePath();
    if (!existsSync(python)) {
        console.warn(
            `[opentagger] Python venv not found at ${python}. ` +
                `Autotag features will be unavailable. ` +
                `Run run.ps1 / run.sh once to create the venv, then relaunch.`
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

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: "opentagger",
        backgroundColor: "#f0f0f0",
        webPreferences: {
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
    startPythonBackend();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    stopPythonBackend();
    if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
    stopPythonBackend();
});
