// Preload bridge. Exposes the ONNX autotagger IPC to the renderer as
// window.opentaggerNative. The renderer feature-detects this object —
// it is absent when the frontend runs in a plain browser (Vite dev
// server / FastAPI serve), where only the legacy HTTP backend works.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opentaggerNative", {
    taggerStatus: (modelId) =>
        ipcRenderer.invoke("tagger:status", modelId),
    taggerDownload: (modelId) =>
        ipcRenderer.invoke("tagger:download", modelId),
    taggerRun: (modelId, pixels, options) =>
        ipcRenderer.invoke("tagger:run", modelId, pixels, options),
    onTaggerProgress: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("tagger:progress", listener);
        return () =>
            ipcRenderer.removeListener("tagger:progress", listener);
    },
    prefsLoad: () => ipcRenderer.invoke("prefs:load"),
    prefsSave: (overrides) =>
        ipcRenderer.invoke("prefs:save", overrides),
});
