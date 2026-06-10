// Preload bridge. Exposes the autotag-environment management IPC to
// the renderer as window.opentaggerNative. The renderer feature-detects
// this object — it is absent when the frontend runs in a plain browser
// (Vite dev server / FastAPI serve), where setup must be done manually.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opentaggerNative", {
    autotagStatus: () => ipcRenderer.invoke("autotag:status"),
    autotagInstall: () => ipcRenderer.invoke("autotag:install"),
    autotagStart: () => ipcRenderer.invoke("autotag:start"),
    onAutotagProgress: (callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("autotag:progress", listener);
        return () =>
            ipcRenderer.removeListener("autotag:progress", listener);
    },
});
