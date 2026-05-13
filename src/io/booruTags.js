// Booru tag database loader.
//
// The CSV is shipped under public/assets/ and lazy-loaded on demand
// (first time the autocomplete dropdown wants suggestions). Results
// are cached on state.booruTags so subsequent calls are free.

import { state } from "../core/state.js";

export async function loadBooruTags() {
    if (state.booruTags.length > 0) return state.booruTags;
    if (state.booruTagsLoadingPromise) return state.booruTagsLoadingPromise;

    console.log("Initiating booru tag loading...");
    // Relative path so this works under all three loaders:
    //   - http://localhost:5173 (vite dev)
    //   - http://localhost:8081 (FastAPI direct serve)
    //   - file:///path/to/dist/index.html (Electron production)
    state.booruTagsLoadingPromise = fetch(
        "assets/csv/danbooru_e621_merged.csv"
    )
        .then((response) => {
            if (!response.ok) {
                throw new Error(
                    `HTTP error! status: ${response.status} while fetching tags.`
                );
            }
            return response.text();
        })
        .then((csvText) => {
            const lines = csvText.split("\n");
            const loadedTags = [];
            // Assuming the first line is a header: "tag_name,type_n,image_count,aliases"
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const parts = [];
                let currentPart = "";
                let inQuotes = false;
                for (const char of line) {
                    if (char === "," && !inQuotes) {
                        parts.push(currentPart);
                        currentPart = "";
                    } else if (char === '"') {
                        inQuotes = !inQuotes;
                        // Don't add quotes to the part itself for aliases,
                        // but respect them for parsing
                    } else {
                        currentPart += char;
                    }
                }
                parts.push(currentPart);

                if (parts.length >= 3) {
                    const tagName = parts[0].trim();
                    const typeN = parseInt(parts[1], 10);
                    const imageCount = parseInt(parts[2], 10);
                    // const aliases = parts[3] ? parts[3].trim() : ''; // Aliases raw string

                    if (
                        tagName &&
                        !isNaN(typeN) &&
                        !isNaN(imageCount)
                    ) {
                        loadedTags.push({
                            name: tagName,
                            type: typeN,
                            count: imageCount,
                        });
                    }
                }
            }
            state.booruTags = loadedTags;
            // Sort once after loading, by count descending for general use
            state.booruTags.sort((a, b) => b.count - a.count);
            console.log(
                `Loaded and sorted ${state.booruTags.length} booru tags.`
            );
            return state.booruTags;
        })
        .catch((error) => {
            console.error(
                "Failed to load or parse booru tags:",
                error
            );
            state.booruTagsLoadingPromise = null;
            state.booruTags = [];
            return [];
        });
    return state.booruTagsLoadingPromise;
}
