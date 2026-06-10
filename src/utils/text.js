// Pure string / parsing helpers.

// Tags that are kaomoji keep their underscores when prettifying.
// Mirrors the list in electron/tagger.cjs (main process; the module
// formats can't be shared across the boundary).
const KAOMOJI = new Set([
    "0_0", "(o)_(o)", "+_+", "+_-", "._.", "<o>_<o>", "<|>_<|>",
    "=_=", ">_<", "3_3", "6_9", ">_o", "@_@", "^_^", "o_o", "u_u",
    "x_x", "|_|", "||_||",
]);

/** Booru-style tag name -> display form ("red_background" -> "red
 * background"), leaving kaomoji untouched. No-op when `enabled` is
 * false. */
export function prettifyBooruTag(name, enabled = true) {
    if (!enabled || KAOMOJI.has(name)) return name;
    return name.replaceAll("_", " ");
}

/** Convert "minimumPixelsSum" -> "Minimum Pixels Sum" for UI labels. */
export function keyToLabel(key) {
    if (typeof key !== "string") return "";
    const result = key.replace(/([A-Z])/g, " $1");
    return result.charAt(0).toUpperCase() + result.slice(1);
}

/**
 * Coerce a filename into something safe for ZIP archives. Preserves
 * the extension and replaces unsafe characters in the base name with
 * underscores; falls back to "untitled_image" / "image" when input is
 * empty.
 */
export function sanitizeFilename(name) {
    if (!name || typeof name !== "string") return "untitled_image";
    const baseName = name.includes(".")
        ? name.substring(0, name.lastIndexOf("."))
        : name;
    const extension = name.includes(".")
        ? name.substring(name.lastIndexOf("."))
        : "";
    const sanitizedBase = baseName.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const finalBase = sanitizedBase || "image";
    return finalBase + extension;
}

/**
 * Reflect a function's parameter list for help text / autocomplete.
 * Returns "(a, b = 1, ...rest)" -- a best-effort extraction from the
 * source string of arrow and classic functions.
 */
export function parseFunctionSignature(func) {
    if (typeof func !== "function") {
        return "";
    }
    const funcStr = func.toString();
    let paramsMatch = funcStr.match(
        /^(?:async\s*)?(?:function(?:\s+\w*)?\s*\(|\((?!\))|\w+\s*=>\s*\()([^)]*)\)\s*=>|\)\s*{/
    );
    if (!paramsMatch) {
        paramsMatch = funcStr.match(
            /^(?:async\s*)?(?:\w+\s*=>|(\w+)\s*=>)/
        );
        if (paramsMatch && paramsMatch[1])
            return `(${paramsMatch[1]})`;
        if (funcStr.match(/^(?:async\s*)?\(\s*\)\s*=>/))
            return "()";
        return "";
    }
    let paramsStr = paramsMatch[1] || "";
    if (!paramsStr && funcStr.includes("() =>")) return "()";
    const params = [];
    let currentParam = "";
    let openBrackets = 0;
    let openParens = 0;
    for (let i = 0; i < paramsStr.length; i++) {
        const char = paramsStr[i];
        currentParam += char;
        if (char === "{") openBrackets++;
        else if (char === "}") openBrackets--;
        else if (char === "(") openParens++;
        else if (char === ")") openParens--;
        else if (
            char === "," &&
            openBrackets === 0 &&
            openParens === 0
        ) {
            params.push(currentParam.slice(0, -1).trim());
            currentParam = "";
        }
    }
    if (currentParam.trim()) {
        params.push(currentParam.trim());
    }
    if (params.length === 0 && paramsStr.trim() !== "") {
        params.push(paramsStr.trim());
    }
    const formattedParams = params.map((p) => {
        let param = p.trim();
        param = param.replace(/\/\*.*?\*\//g, "").trim();
        if (param.includes("=")) {
            const parts = param.split("=");
            const name = parts[0].trim();
            let defVal = parts.slice(1).join("=").trim();
            if (defVal.startsWith("{") && defVal.endsWith("}"))
                defVal = "{...}";
            else if (defVal.startsWith("[") && defVal.endsWith("]"))
                defVal = "[...]";
            else if (defVal.length > 15) defVal = "...";
            return `${name} = ${defVal}`;
        }
        return param;
    });

    return `(${formattedParams.join(", ")})`;
}

/**
 * Split a raw comma-separated tag string into trimmed tags, honoring
 * `\,` as an escape so tags can legitimately contain commas.
 */
export function parseRawTagInput(rawText) {
    if (typeof rawText !== "string") return [];
    const segments = rawText.split(/(?<!\\),/g);
    return segments
        .map((segment) => {
            const tempPlaceholder = "##TEMP_BACKSLASH##";
            return segment
                .replace(/\\\\/g, tempPlaceholder)
                .replace(/\\,/g, ",")
                .replace(
                    new RegExp(
                        tempPlaceholder.replace(
                            /[.*+?^${}()|[\]\\]/g,
                            "\\$&"
                        ),
                        "g"
                    ),
                    "\\"
                )
                .trim();
        })
        .filter((tagText) => tagText.length > 0);
}
