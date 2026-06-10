// Layered user preferences.
//
// Three layers, most specific wins:
//   1. project overrides — travel inside the .loraproj (project.json),
//      cleared on New Project
//   2. global overrides  — persisted to ~/.opentagger/preferences.json
//      via the native bridge in the desktop app; plain browsers fall
//      back to localStorage
//   3. defaults          — the PREFERENCE_DEFAULTS tree below
//
// Overrides are flat { "dotted.path": value } maps; the defaults tree
// doubles as the schema (a leaf's type drives input rendering and
// value coercion; `@type: "select"` leaves carry their options).
//
// Call initPreferences() (and await it) before reading preferences at
// startup — it hydrates the global layer from disk.

export const PREFERENCE_DEFAULTS = {
    importingImages: {
        minimumHeight: 768,
        minimumWidth: 768,
        maximumHeight: 4096,
        maximumWidth: 4096,
        minimumPixelsSum: -1,
        maximumPixelsSum: -1,
    },
    tagging: {
        autocompleteSuggestions: {
            enabled: true,
            maxSuggestions: 10,
            // Booru CSV tag names use underscores; replace them with
            // spaces when a suggestion is inserted.
            replaceUnderscores: true,
            csvFile: {
                "@type": "select",
                value: "danbooru_e621_merged.csv",
                options: [
                    "e621.csv",
                    "danbooru.csv",
                    "danbooru_e621_merged.csv",
                ],
            },
        },
        autotagging: {
            enabled: true,
            timeout: 30000,
            // Model vocabularies use underscores (booru style);
            // replace them with spaces in added tags (kaomoji like
            // ">_<" are always kept as-is).
            replaceUnderscores: true,
            autotaggingModel: {
                "@type": "select",
                value: "wd-vit-tagger-v3",
                options: [
                    "wd-vit-tagger-v3",
                    "it_so400m_patch14_siglip_384",
                ],
            },
            // Per-model score cutoffs. Keys ending in "Threshold" map
            // to the tagger's threshold categories ("generalThreshold"
            // -> "general"); see src/io/tagger.js.
            models: {
                "wd-vit-tagger-v3": {
                    generalThreshold: 0.35,
                    characterThreshold: 0.85,
                },
                it_so400m_patch14_siglip_384: {
                    generalThreshold: 0.2,
                },
            },
        },
    },
};

const STORAGE_KEY = "opentagger.preferences";

const native =
    typeof window !== "undefined"
        ? (window.opentaggerNative ?? null)
        : null;

function loadFromLocalStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return typeof parsed === "object" && parsed !== null
            ? parsed
            : {};
    } catch {
        return {};
    }
}

let globalOverrides = {};
let projectOverrides = {};

/**
 * Hydrate the global layer from persistent storage: the desktop app
 * reads ~/.opentagger/preferences.json; browsers use localStorage.
 */
export async function initPreferences() {
    if (native?.prefsLoad) {
        const stored = await native.prefsLoad();
        globalOverrides =
            stored && typeof stored === "object" ? stored : {};
        return;
    }
    globalOverrides = loadFromLocalStorage();
}

function persistGlobalOverrides() {
    if (native?.prefsSave) {
        native
            .prefsSave({ ...globalOverrides })
            .catch((err) =>
                console.warn("Could not persist preferences:", err)
            );
        return;
    }
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(globalOverrides)
        );
    } catch (err) {
        console.warn("Could not persist preferences:", err);
    }
}

function isSelectNode(node) {
    return (
        typeof node === "object" &&
        node !== null &&
        node["@type"] === "select"
    );
}

/** The defaults-tree node at a dotted path (leaf or section). */
export function defaultNodeAt(path) {
    let node = PREFERENCE_DEFAULTS;
    for (const key of path.split(".")) {
        if (typeof node !== "object" || node === null) {
            return undefined;
        }
        node = node[key];
    }
    return node;
}

/** The default value of a leaf path (select nodes yield their value). */
export function defaultValueAt(path) {
    const node = defaultNodeAt(path);
    return isSelectNode(node) ? node.value : node;
}

function scopeMap(scope) {
    if (scope === "global") return globalOverrides;
    if (scope === "project") return projectOverrides;
    throw new Error(`Unknown preference scope: ${scope}`);
}

/** Effective value: project override ?? global override ?? default. */
export function getPreference(path) {
    if (path in projectOverrides) return projectOverrides[path];
    if (path in globalOverrides) return globalOverrides[path];
    return defaultValueAt(path);
}

/**
 * The value a given scope's settings UI should display: the project
 * scope sees the effective value, the global scope ignores project
 * overrides.
 */
export function getPreferenceAtScope(path, scope) {
    if (scope === "project") return getPreference(path);
    if (path in globalOverrides) return globalOverrides[path];
    return defaultValueAt(path);
}

export function hasOverride(path, scope) {
    return path in scopeMap(scope);
}

export function setPreference(path, value, scope = "global") {
    const defaultValue = defaultValueAt(path);
    if (defaultValue === undefined) {
        console.error(`Unknown preference path: ${path}`);
        return;
    }
    // Coerce to the default's type so widgets read back consistent
    // shapes regardless of what the input event delivered.
    let coerced = value;
    if (typeof defaultValue === "number") coerced = Number(value);
    else if (typeof defaultValue === "boolean")
        coerced = Boolean(value);

    scopeMap(scope)[path] = coerced;
    if (scope === "global") persistGlobalOverrides();
}

export function clearPreference(path, scope) {
    delete scopeMap(scope)[path];
    if (scope === "global") persistGlobalOverrides();
}

// --- Project override transport (used by project save/load) ---

export function getProjectOverrides() {
    return { ...projectOverrides };
}

/** Replace project overrides wholesale; unknown paths are dropped. */
export function setProjectOverrides(overrides) {
    projectOverrides = {};
    if (typeof overrides !== "object" || overrides === null) return;
    for (const [path, value] of Object.entries(overrides)) {
        if (defaultValueAt(path) !== undefined) {
            projectOverrides[path] = value;
        } else {
            console.warn(
                `Ignoring unknown project preference: ${path}`
            );
        }
    }
}

export function clearProjectOverrides() {
    projectOverrides = {};
}
