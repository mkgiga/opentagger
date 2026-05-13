// User preferences (data + mutator).
//
// The UI that renders this tree lives in src/ui/preferencesPanel.js;
// this module is just the source of truth. Future work: load/save
// these to localStorage so they survive a reload.

export const preferences = {
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
            autotaggingModel: {
                "@type": "select",
                value: "wd-vit-tagger-v3",
                options: [
                    "wd-vit-tagger-v3",
                    "it_so400m_patch14_siglip_384",
                ],
            },
        },
    },
};

/**
 * Set a preference by dotted path, coercing the assigned value to the
 * existing slot's type so widgets always read back consistent shapes.
 */
export function updatePreference(path, value) {
    const keys = path.split(".");
    let obj = preferences;
    for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
        if (typeof obj !== "object" || obj === null) {
            console.error(
                `Invalid path for preference update: ${path}`
            );
            return;
        }
    }
    const lastKey = keys[keys.length - 1];
    const currentValue = obj[lastKey];

    if (typeof currentValue === "number") {
        obj[lastKey] = Number(value);
    } else if (typeof currentValue === "boolean") {
        obj[lastKey] = Boolean(value);
    } else {
        obj[lastKey] = value;
    }

    console.log(
        `Preference updated: ${path} =`,
        obj[lastKey],
        preferences
    );
    // TODO: actually apply the preference here if it requires an
    // immediate effect (e.g. swap the autocomplete CSV).
}
