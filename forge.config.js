// Electron Forge configuration.
//
// We don't use the Vite plugin -- the Vite build runs as a separate
// `npm run build` step (chained from `package` / `make` in
// package.json), and Forge just consumes the resulting dist/.

// The only runtime node_modules the packaged app needs: the ONNX
// runtime used by electron/tagger.cjs and the unstorage KV layer
// (electron/storage.cjs; destr is its JSON parser). Everything else
// is either bundled into dist/index.html by Vite or provided by
// Electron.
const RUNTIME_NODE_MODULES = [
    "onnxruntime-node",
    "onnxruntime-common",
    "unstorage",
    "destr",
];

// Paths (relative to project root, leading "/") that never ship.
const IGNORED_PATHS =
    /^\/(src|public|autotag|scripts|out|\.cache|\.git|\.vscode|\.idea)(\/.*)?$|^\/(index\.html|tagger\.html|vite\.config\.js|forge\.config\.js|package-lock\.json|bun\.lock|\.gitignore|README\.md|run\.(ps1|sh))$/;

export default {
    packagerConfig: {
        name: "opentagger",
        // Pack the JS app into resources/app.asar for faster startup
        // and a cleaner install footprint. onnxruntime-node is native
        // and must live outside the archive.
        asar: {
            unpack: "**/node_modules/onnxruntime-node/**",
        },
        ignore: (path) => {
            if (!path) return false;
            const p = path.replace(/\\/g, "/");

            if (p.startsWith("/node_modules")) {
                if (p === "/node_modules") return false;
                const top = p.match(/^\/node_modules\/([^/]+)/)[1];
                if (!RUNTIME_NODE_MODULES.includes(top)) return true;
                // onnxruntime-node bundles binaries for every OS;
                // ship only the platform being packaged.
                const bin = p.match(
                    /^\/node_modules\/onnxruntime-node\/bin\/napi-v\d+\/([^/]+)/
                );
                if (bin && bin[1] !== process.platform) return true;
                return false;
            }

            return IGNORED_PATHS.test(p);
        },
    },
    rebuildConfig: {},
    makers: [
        {
            // Cross-platform fallback: a plain zip of the unpacked app.
            name: "@electron-forge/maker-zip",
            platforms: ["darwin", "linux", "win32"],
        },
        {
            // Windows: classic Squirrel installer with auto-update hooks.
            name: "@electron-forge/maker-squirrel",
            config: {
                name: "opentagger",
            },
        },
    ],
    plugins: [],
};
