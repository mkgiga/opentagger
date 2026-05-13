// Electron Forge configuration.
//
// We don't use the Vite plugin -- the Vite build runs as a separate
// `npm run build` step (chained from `package` / `make` in
// package.json), and Forge just consumes the resulting dist/.

export default {
    packagerConfig: {
        name: "opentagger",
        // Pack the JS app into resources/app.asar for faster startup
        // and a cleaner install footprint.
        asar: true,
        // The Python backend lives outside the JS app code. We ship
        // it as an extraResource so it lands at
        // `process.resourcesPath/autotag/` in the packaged build.
        // electron/main.cjs reads it from that exact location.
        extraResource: ["./autotag"],
        ignore: [
            // Source files -- the user runs dist/, not src/.
            /^\/src(\/.*)?$/,
            /^\/public(\/.*)?$/,
            /^\/index\.html$/,
            /^\/tagger\.html$/,
            /^\/vite\.config\.js$/,
            /^\/forge\.config\.js$/,
            // autotag/ is bundled via extraResource above; don't also
            // pack it into the asar.
            /^\/autotag(\/.*)?$/,
            // Repo metadata.
            /^\/\.git(\/.*)?$/,
            /^\/\.gitignore$/,
            /^\/README\.md$/,
            /^\/run\.(ps1|sh)$/,
            // Everything in node_modules is either bundled into
            // dist/index.html by vite-plugin-singlefile (jszip,
            // codemirror, file-saver) or provided by the Electron
            // runtime itself (the `electron` module). Nothing in
            // main.cjs needs it at runtime.
            /^\/node_modules(\/.*)?$/,
            /^\/\.vscode(\/.*)?$/,
            /^\/\.idea(\/.*)?$/,
            /^\/out(\/.*)?$/,
        ],
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
