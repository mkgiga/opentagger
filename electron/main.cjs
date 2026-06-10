// Electron main process.
//
// CommonJS rather than ESM because Electron 32 + Node 20 still trips
// over `import` of the `electron` module in some configurations. The
// renderer is unaffected -- it still loads the Vite ESM bundle.
//
// Responsibilities:
//   1. Open a BrowserWindow pointing at the Vite-built frontend
//      (dist/index.html), or at the dev server when ELECTRON_DEV=1.
//   2. Serve the ONNX autotagger (electron/tagger.cjs) over IPC:
//      model status, on-demand model download, and inference.
//
// Autotagging runs in-process via onnxruntime-node — there is no
// Python sidecar. Models are downloaded into userData on the user's
// first request, never at startup.

const { app, BrowserWindow, shell, ipcMain } = require("electron");
const { existsSync, mkdirSync, readdirSync, renameSync } = require("node:fs");
const { join } = require("node:path");
const tagger = require("./tagger.cjs");
const { storage, modelsDir } = require("./storage.cjs");

// ELECTRON_DEV is set by the `npm run electron:dev` script. In
// packaged builds app.isPackaged is true anyway, but the env var is
// the explicit signal that the Vite dev server is running.
const isDev = !app.isPackaged && process.env.ELECTRON_DEV === "1";

// In dev this is the project root; in a packaged build __dirname is
// `<app>/resources/app.asar/electron/`, so `..` is the asar root --
// which is where Forge put dist/.
const distRoot = join(__dirname, "..");

let mainWindow = null;

function sendProgress(payload) {
    console.log(`[opentagger] tagger: ${payload.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("tagger:progress", payload);
    }
}

function registerIpcHandlers() {
    ipcMain.handle("tagger:status", (_event, modelId) =>
        tagger.getStatus(modelId)
    );
    ipcMain.handle("tagger:download", (_event, modelId) =>
        tagger.downloadModel(modelId, sendProgress)
    );
    ipcMain.handle("tagger:run", (_event, modelId, pixels, options) =>
        tagger.runAutotag(modelId, pixels, sendProgress, options)
    );

    // Global preferences persist under ~/.opentagger; the renderer
    // reads/writes them through this bridge.
    ipcMain.handle("prefs:load", () =>
        storage.getItem("preferences.json")
    );
    ipcMain.handle("prefs:save", (_event, overrides) =>
        storage.setItem("preferences.json", overrides ?? {})
    );
}

// Earlier versions stored models in Electron's userData dir; move
// anything found there into ~/.opentagger/models once.
function migrateLegacyModels() {
    const legacyDir = join(app.getPath("userData"), "models");
    if (!existsSync(legacyDir)) return;
    mkdirSync(modelsDir, { recursive: true });
    for (const entry of readdirSync(legacyDir, {
        withFileTypes: true,
    })) {
        if (!entry.isDirectory()) continue;
        const dest = join(modelsDir, entry.name);
        if (existsSync(dest)) continue;
        try {
            renameSync(join(legacyDir, entry.name), dest);
            console.log(
                `[opentagger] Migrated model "${entry.name}" to ${dest}`
            );
        } catch (err) {
            // Worst case the model re-downloads on next use.
            console.warn(
                `[opentagger] Could not migrate model "${entry.name}": ${err.message}`
            );
        }
    }
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
    migrateLegacyModels();
    registerIpcHandlers();
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
