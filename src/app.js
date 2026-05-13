"use strict";

import { state } from "./core/state.js";
import { preferences, updatePreference } from "./core/preferences.js";
import { opentaggerAPI } from "./core/api.js";
import { slashCommands } from "./core/slashCommands.js";
import { evaluateExpression, getQueryLeafTerms } from "./core/search.js";
import { getTagText, createTimerLabelElement } from "./utils/dom.js";
import {
    keyToLabel,
    sanitizeFilename,
    parseFunctionSignature,
    parseRawTagInput,
} from "./utils/text.js";
import { debounce, startTimer } from "./utils/timing.js";
import { getTagColor } from "./utils/color.js";

// Web components extracted into their own modules. Each module
// registers its custom element on import, so just pulling these in
// for side effects is sufficient.
import "./components/TabContainer.js";
import "./components/AutocompleteDropdown.js";
import "./components/MenuItem.js";
import "./components/ContextMenu.js";


function generatePreferencesUI(
    config,
    parentElement,
    currentPath = "",
    level = 0
) {
    for (const [key, value] of Object.entries(config)) {
        const itemPath = currentPath
            ? `${currentPath}.${key}`
            : key;
        const labelText = keyToLabel(key);

        if (
            typeof value === "object" &&
            value !== null &&
            !value["@type"]
        ) {
            const section = document.createElement("div");
            section.className = "preferences-section";

            const title = document.createElement(
                level === 0 ? "h3" : "h4"
            );
            title.textContent = labelText;
            section.appendChild(title);

            generatePreferencesUI(
                value,
                section,
                itemPath,
                level + 1
            );
            parentElement.appendChild(section);
        } else {
            const itemDiv = document.createElement("div");
            itemDiv.className = "preference-item";

            const label = document.createElement("label");
            label.textContent = labelText;
            label.htmlFor = `pref-${itemPath}`;
            itemDiv.appendChild(label);

            if (
                typeof value === "object" &&
                value !== null &&
                value["@type"] === "select"
            ) {
                const select = document.createElement("select");
                select.id = `pref-${itemPath}`;
                select.value = value.value;
                value.options.forEach((opt) => {
                    const option = document.createElement("option");
                    option.value = opt;
                    option.textContent = opt;
                    if (opt === value.value) option.selected = true;
                    select.appendChild(option);
                });
                select.addEventListener("change", (e) =>
                    updatePreference(
                        itemPath + ".value",
                        e.target.value
                    )
                );
                itemDiv.appendChild(select);
            } else if (typeof value === "boolean") {
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.id = `pref-${itemPath}`;
                checkbox.checked = value;
                checkbox.addEventListener("change", (e) =>
                    updatePreference(itemPath, e.target.checked)
                );
                itemDiv.appendChild(checkbox);
            } else if (typeof value === "number") {
                const numInput = document.createElement("input");
                numInput.type = "number";
                numInput.id = `pref-${itemPath}`;
                numInput.value = value;
                if (key.toLowerCase().includes("pixels"))
                    numInput.step = 1000; // Example specific step
                else if (key.toLowerCase().includes("timeout"))
                    numInput.step = 1000;
                else if (key.toLowerCase().includes("suggestions"))
                    numInput.step = 1;
                else numInput.step = 1; // Default step for numbers
                numInput.addEventListener("change", (e) =>
                    updatePreference(
                        itemPath,
                        parseFloat(e.target.value)
                    )
                );
                itemDiv.appendChild(numInput);
            } else if (typeof value === "string") {
                const textInput = document.createElement("input");
                textInput.type = "text";
                textInput.id = `pref-${itemPath}`;
                textInput.value = value;
                textInput.addEventListener("change", (e) =>
                    updatePreference(itemPath, e.target.value)
                );
                itemDiv.appendChild(textInput);
            }
            parentElement.appendChild(itemDiv);
        }
    }
}

/**
 * @type {{ [id: string]: HTMLAudioElement }}
 */
const sfx = {
    sfxWelcome: null,
    sfxGood1: null,
    sfxGood2: null,
    sfxGood3: null,
    sfxBad: null,
    sfxGoodnight: null,
    sfxPop: null,
};

const fadeOutAudioContext = new AudioContext({
    sampleRate: 44100,
    latencyHint: "interactive",
});

for (const key in sfx) {
    const audio = document.getElementById(key);
    audio.volume = 0.1;
    sfx[key] = audio;
}

// Autocomplete for Booru Tags

async function loadBooruTags() {
    if (state.booruTags.length > 0) return state.booruTags;
    if (state.booruTagsLoadingPromise) return state.booruTagsLoadingPromise;

    console.log("Initiating booru tag loading...");
    state.booruTagsLoadingPromise = fetch(
        "/assets/csv/danbooru_e621_merged.csv"
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

async function checkBackendReady(maxRetries = 30, delay = 1000) {
    console.log(
        `Checking backend readiness at ${state.HEALTH_CHECK_URL}...`
    );
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(state.HEALTH_CHECK_URL);
            if (response.ok) {
                const data = await response.json();
                console.log("Python backend is ready:", data);
                return true;
            } else {
                console.warn(
                    `Backend health check failed with status ${
                        response.status
                    }. Attempt ${i + 1}/${maxRetries}.`
                );
            }
        } catch (err) {
            console.warn(
                `Backend not ready yet (attempt ${
                    i + 1
                }/${maxRetries}): ${err.message}. Retrying in ${
                    delay / 1000
                }s...`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    console.error(
        "Python backend did not become ready after multiple retries."
    );
    return false;
}


function customCodeMirrorHints(editor, options) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const token = editor.getTokenAt(cursor);

    if (line.trim().startsWith("/") && cursor.ch > 0) {
        let currentSlashCommandPart = "";
        const textBeforeCursor = line.substring(0, cursor.ch);
        const match = /^\/([^\s]*)/.exec(textBeforeCursor);

        if (match && cursor.ch <= 1 + match[1].length) {
            currentSlashCommandPart = match[1];

            const suggestions = Object.keys(slashCommands)
                .filter((cmd) =>
                    cmd.startsWith(currentSlashCommandPart)
                )
                .map((cmd) => {
                    const commandObject = slashCommands[cmd];
                    let displaySignature = "";

                    if (
                        commandObject &&
                        commandObject.signature !== undefined
                    ) {
                        displaySignature =
                            commandObject.signature.trim()
                                ? ` ${commandObject.signature.trim()}`
                                : "";
                    } else {
                        let funcToParseForSig = commandObject.func;
                        if (
                            commandObject.apiRef &&
                            typeof opentaggerAPI[
                                commandObject.apiRef
                            ] === "function"
                        ) {
                            funcToParseForSig =
                                opentaggerAPI[commandObject.apiRef];
                        }
                        const parsedSig =
                            parseFunctionSignature(
                                funcToParseForSig
                            );
                        if (parsedSig && parsedSig !== "()") {
                            const paramsString = parsedSig
                                .slice(1, -1)
                                .trim();
                            if (paramsString === "") {
                                displaySignature = "";
                            } else {
                                const paramsList = [];
                                let currentParam = "";
                                let p_openBrackets = 0;
                                let p_openParens = 0;
                                for (
                                    let i = 0;
                                    i < paramsString.length;
                                    i++
                                ) {
                                    const char = paramsString[i];
                                    currentParam += char;
                                    if (char === "{")
                                        p_openBrackets++;
                                    else if (char === "}")
                                        p_openBrackets--;
                                    else if (char === "(")
                                        p_openParens++;
                                    else if (char === ")")
                                        p_openParens--;
                                    else if (
                                        char === "," &&
                                        p_openBrackets === 0 &&
                                        p_openParens === 0
                                    ) {
                                        paramsList.push(
                                            currentParam
                                                .slice(0, -1)
                                                .trim()
                                        );
                                        currentParam = "";
                                    }
                                }
                                if (currentParam.trim()) {
                                    paramsList.push(
                                        currentParam.trim()
                                    );
                                }
                                const transformedParams = paramsList
                                    .map((p_str) => {
                                        let p = p_str.trim();
                                        if (p.startsWith("...")) {
                                            return `[${p}]`;
                                        } else if (
                                            p.includes("=")
                                        ) {
                                            const name = p
                                                .split("=")[0]
                                                .trim();
                                            return `[${name}]`;
                                        } else if (p) {
                                            return `<${p}>`;
                                        }
                                        return "";
                                    })
                                    .filter((p) => p)
                                    .join(" ");
                                displaySignature = transformedParams
                                    ? ` ${transformedParams}`
                                    : "";
                            }
                        } else {
                            displaySignature = "";
                        }
                    }
                    return {
                        text: "/" + cmd + " ",
                        displayText: `/${cmd}${displaySignature}`,
                        render: function (element, self, data) {
                            const cmdNameEl =
                                document.createElement("span");
                            cmdNameEl.textContent = "/" + cmd;
                            cmdNameEl.style.fontWeight = "bold";
                            element.appendChild(cmdNameEl);
                            if (displaySignature.trim()) {
                                const sigEl =
                                    document.createElement("span");
                                sigEl.textContent =
                                    displaySignature;
                                sigEl.style.color = "#777";
                                sigEl.style.marginLeft = "5px";
                                element.appendChild(sigEl);
                            }
                        },
                        className: "CodeMirror-hint-slash-command",
                    };
                });
            if (suggestions.length > 0) {
                return {
                    list: suggestions,
                    from: CodeMirror.Pos(
                        cursor.line,
                        textBeforeCursor.lastIndexOf("/")
                    ),
                    to: CodeMirror.Pos(cursor.line, cursor.ch),
                };
            }
        }
    }

    const jsGlobals = {};

    for (const key of Object.keys(opentaggerAPI)) {
        if (typeof opentaggerAPI[key] === "function") {
            jsGlobals[key] = opentaggerAPI[key];
        }
    }
    const commonBrowserGlobals = [
        "document",
        "window",
        "console",
        "Math",
        "JSON",
        "localStorage",
        "sessionStorage",
        "navigator",
        "location",
        "alert",
        "prompt",
        "confirm",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "fetch",
        "Promise",
        "URL",
        "Image",
        "File",
        "Blob",
        "FileReader",
        "FormData",
        "Date",
    ];

    for (const g of commonBrowserGlobals) {
        if (typeof window[g] !== "undefined") {
            jsGlobals[g] = window[g];
        }
    }
    const currentWord = token.string.trim().toLowerCase();
    const topLevelSuggestions = [];
    if (!token.string.includes(".")) {
        for (const key of Object.keys(jsGlobals)) {
            if (key.toLowerCase().startsWith(currentWord)) {
                const val = jsGlobals[key];
                let displayText = key;
                let signature = "";
                if (typeof val === "function") {
                    signature = parseFunctionSignature(val);
                    displayText = `${key}${signature}`;
                }
                topLevelSuggestions.push({
                    text: key,
                    displayText: displayText,
                    render: function (element, self, data) {
                        const nameEl =
                            document.createElement("span");
                        nameEl.textContent = key;
                        nameEl.style.fontWeight = "bold";
                        element.appendChild(nameEl);
                        if (signature) {
                            const sigEl =
                                document.createElement("span");
                            sigEl.textContent = signature;
                            sigEl.style.color = "#555";
                            sigEl.style.marginLeft = "6px";
                            element.appendChild(sigEl);
                        }
                    },
                });
            }
        }
    }
    const cmJsHintOptions = { ...options, globalVars: jsGlobals };
    let cmJsHintResult = CodeMirror.hint.javascript(
        editor,
        cmJsHintOptions
    );
    if (cmJsHintResult && cmJsHintResult.list.length > 0) {
        const combinedList = [...topLevelSuggestions];
        const topLevelTexts = new Set(
            topLevelSuggestions.map((s) => s.text)
        );

        for (const cmHint of cmJsHintResult.list) {
            const hintText =
                typeof cmHint === "string" ? cmHint : cmHint.text;
            if (!topLevelTexts.has(hintText)) {
                if (typeof cmHint === "string") {
                    combinedList.push({
                        text: cmHint,
                        displayText: cmHint,
                    });
                } else {
                    combinedList.push(cmHint);
                }
            }
        }
        cmJsHintResult.list = combinedList;
        if (token.string.length > 0 && token.start < cursor.ch) {
            cmJsHintResult.from = CodeMirror.Pos(
                cursor.line,
                token.start
            );
            cmJsHintResult.to = CodeMirror.Pos(
                cursor.line,
                token.end
            );
        }
        return cmJsHintResult;
    } else if (topLevelSuggestions.length > 0) {
        return {
            list: topLevelSuggestions,
            from: CodeMirror.Pos(cursor.line, token.start),
            to: CodeMirror.Pos(cursor.line, token.end),
        };
    }
    return cmJsHintResult;
}












/**
 * Generates submenu items for adding group tags to selected entries.
 * @param {Array<DatasetEntry>} targetEntries - The array of entries the action will apply to.
 * @returns {Array<Object>} Menu item definitions.
 */
function getGroupSubmenuItems(targetEntries) {
    const cats = document.querySelectorAll(
        "#tag-group-list tag-group"
    );
    const items = [];
    const targetCount = targetEntries.length;

    for (const cat of cats) {
        const name = cat.getAttribute("group-name") || "...";
        const tags = cat.getGroupTags();
        if (tags.length > 0)
            items.push({
                label: `Add All from "${name}"`,
                callback: () => {
                    for (const entry of targetEntries) {
                        for (const tag of tags) {
                            entry.addTag(tag);
                        }
                    }
                },
            });
    }
    if (items.length === 0)
        items.push({
            label: "(No groups with tags)",
            callback: null,
            disabled: true,
        });
    return items;
}


class DatasetTag extends HTMLElement {
    constructor() {
        super();
        this._boundHandleDeleteClick =
            this._handleDeleteClick.bind(this);
        this._boundHandleDeleteMouseDown =
            this._handleDeleteMouseDown.bind(this);
        this._boundHandleSpanDblClick =
            this._handleSpanDblClick.bind(this);
        this._boundHandleSpanKeyDown =
            this._handleSpanKeyDown.bind(this);
        this._boundHandleSpanBlur = this._handleSpanBlur.bind(this);
        this._boundHandleDragStart =
            this._handleDragStart.bind(this);
        this._boundHandleDragEnd = this._handleDragEnd.bind(this);
        this._boundHandleContextMenu =
            this._handleContextMenu.bind(this);
        this._originalText = "";

        // For autocomplete
        this._boundHandleAutocompleteSelection =
            this._handleAutocompleteSelection.bind(this);
        this._boundHandleAutocompleteEscape =
            this._handleAutocompleteEscape.bind(this);
        this._boundHandleSpanInput =
            this._handleSpanInput.bind(this);
        this._debouncedHandleSpanInput = debounce(
            this._boundHandleSpanInput,
            200
        ); // Debounce input for suggestions
    }
    connectedCallback() {
        let initialText = "";
        const existingSpan = this.querySelector(
            "span[contenteditable]"
        );
        if (existingSpan) {
            initialText = existingSpan.textContent.trim();
        } else {
            initialText = this.textContent.trim();
        }
        this._originalText = initialText || "empty_tag";
        this.innerHTML = "";
        this.draggable = true;
        const span = document.createElement("span");
        span.setAttribute("contenteditable", "false");
        span.setAttribute("translate", "no");
        span.textContent = this._originalText;
        const button = document.createElement("button");
        button.classList.add("delete-tag", "material-icons");
        button.speaker = "Delete Tag";
        button.textContent = "close";

        this.appendChild(span);
        this.appendChild(button);
        this.addEventListeners();
    }
    disconnectedCallback() {
        this.removeEventListeners();
        if (
            state.globalTagAutocompleteDropdown &&
            state.globalTagAutocompleteDropdown.classList.contains(
                "visible"
            ) &&
            state.globalTagAutocompleteDropdown._targetElement ===
                this.querySelector("span")
        ) {
            state.globalTagAutocompleteDropdown.hide();
        }
    }
    addEventListeners() {
        const d = this.querySelector(".delete-tag");
        const s = this.querySelector("span[contenteditable]");
        if (d) {
            d.addEventListener(
                "click",
                this._boundHandleDeleteClick
            );
            d.addEventListener(
                "mousedown",
                this._boundHandleDeleteMouseDown
            );
        }
        if (s) {
            s.addEventListener(
                "dblclick",
                this._boundHandleSpanDblClick
            );
            s.addEventListener(
                "keydown",
                this._boundHandleSpanKeyDown
            );
            s.addEventListener("blur", this._boundHandleSpanBlur);
            s.addEventListener(
                "input",
                this._debouncedHandleSpanInput
            ); // Use debounced handler
        }
        this.addEventListener(
            "dragstart",
            this._boundHandleDragStart
        );
        this.addEventListener("dragend", this._boundHandleDragEnd);
        this.addEventListener(
            "contextmenu",
            this._boundHandleContextMenu
        );

        if (state.globalTagAutocompleteDropdown) {
            state.globalTagAutocompleteDropdown.addEventListener(
                "suggestion-selected",
                this._boundHandleAutocompleteSelection
            );
            state.globalTagAutocompleteDropdown.addEventListener(
                "dropdown-escaped",
                this._boundHandleAutocompleteEscape
            );
        }
    }
    removeEventListeners() {
        const d = this.querySelector(".delete-tag");
        const s = this.querySelector("span[contenteditable]");
        if (d) {
            d.removeEventListener(
                "click",
                this._boundHandleDeleteClick
            );
            d.removeEventListener(
                "mousedown",
                this._boundHandleDeleteMouseDown
            );
        }
        if (s) {
            s.removeEventListener(
                "dblclick",
                this._boundHandleSpanDblClick
            );
            s.removeEventListener(
                "keydown",
                this._boundHandleSpanKeyDown
            );
            s.removeEventListener(
                "blur",
                this._boundHandleSpanBlur
            );
            s.removeEventListener(
                "input",
                this._debouncedHandleSpanInput
            );
        }
        this.removeEventListener(
            "dragstart",
            this._boundHandleDragStart
        );
        this.removeEventListener(
            "dragend",
            this._boundHandleDragEnd
        );
        this.removeEventListener(
            "contextmenu",
            this._boundHandleContextMenu
        );
        if (state.globalTagAutocompleteDropdown) {
            state.globalTagAutocompleteDropdown.removeEventListener(
                "suggestion-selected",
                this._boundHandleAutocompleteSelection
            );
            state.globalTagAutocompleteDropdown.removeEventListener(
                "dropdown-escaped",
                this._boundHandleAutocompleteEscape
            );
        }
    }

    _handleSpanDblClick(e) {
        e.stopPropagation();
        const span = e.target;
        this._originalText = getTagText(this);
        span.contentEditable = "true";
        span.focus();
        window.getSelection().selectAllChildren(span);
    }

    _handleSpanInput(e) {
        const span = e.target;
        if (
            span.contentEditable !== "true" ||
            !state.globalTagAutocompleteDropdown ||
            state.booruTags.length === 0
        ) {
            state.globalTagAutocompleteDropdown?.hide();
            return;
        }

        const inputText = span.textContent.trim().toLowerCase();
        if (inputText.length < 1) {
            state.globalTagAutocompleteDropdown.hide();
            return;
        }

        const matchedTags = state.booruTags
            .filter((tag) =>
                tag.name.toLowerCase().startsWith(inputText)
            )
            // .sort((a, b) => b.count - a.count) // Tags are already pre-sorted by count
            .slice(0, state.MAX_SUGGESTIONS);

        if (matchedTags.length > 0) {
            // Pass the span itself as the target for positioning
            state.globalTagAutocompleteDropdown.show(matchedTags, span);
        } else {
            state.globalTagAutocompleteDropdown.hide();
        }
    }

    _handleSpanKeyDown(e) {
        const span = e.target;
        if (span.contentEditable === "true") {
            if (
                state.globalTagAutocompleteDropdown &&
                state.globalTagAutocompleteDropdown.classList.contains(
                    "visible"
                ) &&
                e.defaultPrevented
            ) {
                // Autocomplete handled the key (Up, Down, Enter, Esc, Tab)
                return;
            }

            // If autocomplete is NOT visible, or it is visible but didn't handle the key
            if (e.key === "Enter") {
                e.preventDefault();
                state.globalTagAutocompleteDropdown.hide();
                span.blur();
            } else if (e.key === "Escape") {
                e.preventDefault();
                state.globalTagAutocompleteDropdown.hide();
                span.textContent = this._originalText;
                span.blur();
            }
        }
    }

    _handleSpanBlur(e) {
        const span = e.target;
        if (!this.isConnected) return;

        setTimeout(() => {
            if (span.contentEditable === "false") {
                // Already finalized by autocomplete selection or escape
                return;
            }

            state.globalTagAutocompleteDropdown.hide();

            span.contentEditable = "false";
            const newRawText = span.textContent;

            if (newRawText === this._originalText) {
                span.textContent =
                    this._originalText || "empty_tag";
                return;
            }
            this._processEditedText(newRawText);
        }, 50);
    }

    _handleAutocompleteSelection(e) {
        // Check if this event is relevant to this specific tag instance
        const span = this.querySelector(
            "span[contenteditable='true']"
        );
        if (
            span &&
            state.globalTagAutocompleteDropdown._targetElement === span &&
            e.target === state.globalTagAutocompleteDropdown
        ) {
            const selectedTag = e.detail;
            span.textContent = selectedTag.name;

            span.contentEditable = "false";
            // state.globalTagAutocompleteDropdown.hide(); // Already hidden by dropdown's _selectItem

            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(span);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);

            this._processEditedText(span.textContent);
        }
    }

    _handleAutocompleteEscape(e) {
        const span = this.querySelector(
            "span[contenteditable='true']"
        );
        // Check if this event is relevant to this specific tag instance
        if (
            span &&
            state.globalTagAutocompleteDropdown._targetElement === span &&
            e.target === state.globalTagAutocompleteDropdown
        ) {
            span.textContent = this._originalText;
            span.contentEditable = "false";
            // state.globalTagAutocompleteDropdown.hide(); // Already hidden by dropdown's Escape handler
        }
    }

    _handleDeleteClick(e) {
        e.stopPropagation();
        const parentTagList = this.closest("tag-list");
        this.remove();
        if (parentTagList) {
            parentTagList.dispatchEvent(
                new CustomEvent("tag-list-changed-internally", {
                    bubbles: true,
                    composed: true,
                })
            );
            parentTagList.dispatchEvent(
                new CustomEvent("tag-updated", {
                    bubbles: true,
                    composed: true,
                })
            );
        }
    }
    _handleDeleteMouseDown(e) {
        e.stopPropagation();
    }

    _processEditedText(rawText) {
        const finalTagTexts = parseRawTagInput(rawText);
        const parentTagList = this.closest("tag-list");
        const span = this.querySelector("span[contenteditable]");
        if (span) {
            span.setAttribute("translate", "no");
        }

        if (!parentTagList) {
            const span = this.querySelector(
                "span[contenteditable]"
            );
            if (finalTagTexts.length === 1) {
                const newText = finalTagTexts[0];
                if (newText !== this._originalText) {
                    span.textContent = newText;
                    this._originalText = newText;
                    this.dispatchEvent(
                        new CustomEvent("tag-updated", {
                            bubbles: true,
                            composed: true,
                        })
                    );
                } else {
                    span.textContent =
                        this._originalText || "empty_tag";
                }
            } else if (finalTagTexts.length === 0) {
                if (this.parentElement) this.remove();
                else
                    span.textContent =
                        this._originalText || "empty_tag";
            } else {
                // Multiple tags entered, keep first in this tag, add others to list (if applicable)
                const firstTagText = finalTagTexts[0];
                let originalTextChanged =
                    firstTagText !== this._originalText;
                span.textContent = firstTagText;
                this._originalText = firstTagText;
                if (originalTextChanged) {
                    this.dispatchEvent(
                        new CustomEvent("tag-updated", {
                            bubbles: true,
                            composed: true,
                        })
                    );
                }
            }
            return;
        }

        let changeOccurred = false;

        if (finalTagTexts.length === 0) {
            this.remove();
            changeOccurred = true;
        } else if (finalTagTexts.length === 1) {
            const newText = finalTagTexts[0];
            if (newText === this._originalText) {
                this.querySelector(
                    "span[contenteditable]"
                ).textContent = this._originalText;
                return; // No actual change
            }

            let isDuplicateOfSibling = false;
            const siblings = Array.from(
                parentTagList.querySelectorAll("dataset-tag")
            );
            for (const sibling of siblings) {
                if (
                    sibling !== this &&
                    getTagText(sibling).toLowerCase() ===
                        newText.toLowerCase()
                ) {
                    isDuplicateOfSibling = true;
                    break;
                }
            }

            if (isDuplicateOfSibling) {
                this.remove(); // Remove this tag as it's now a duplicate
            } else {
                this.querySelector(
                    "span[contenteditable]"
                ).textContent = newText;
                this._originalText = newText;
            }
            changeOccurred = true;
        } else {
            // Multiple tags entered via editing one
            const firstTagText = finalTagTexts.shift(); // Take the first for the current tag

            let isFirstDuplicateOfSibling = false;
            const siblings = Array.from(
                parentTagList.querySelectorAll("dataset-tag")
            );
            for (const sibling of siblings) {
                if (
                    sibling !== this &&
                    getTagText(sibling).toLowerCase() ===
                        firstTagText.toLowerCase()
                ) {
                    isFirstDuplicateOfSibling = true;
                    break;
                }
            }

            if (isFirstDuplicateOfSibling) {
                this.remove(); // Current tag becomes a duplicate, remove it
            } else {
                this.querySelector(
                    "span[contenteditable]"
                ).textContent = firstTagText;
                this._originalText = firstTagText;
            }

            // Add the rest as new tags to the list
            for (const text of finalTagTexts) {
                parentTagList.addTag(text); // addTag handles its own duplication checks within the list
            }
            changeOccurred = true;
        }

        if (changeOccurred && parentTagList.isConnected) {
            parentTagList.dispatchEvent(
                new CustomEvent("tag-list-changed-internally", {
                    bubbles: true,
                    composed: true,
                })
            );
            parentTagList.dispatchEvent(
                new CustomEvent("tag-updated", {
                    bubbles: true,
                    composed: true,
                })
            );
        }
    }

    _handleDragStart(e) {
        const s = this.querySelector("span[contenteditable]");
        if (s && s.contentEditable === "true") {
            e.preventDefault();
            return;
        }
        if (e.target instanceof DatasetTag) {
            const t = getTagText(this);
            state.draggedElement = this;
            e.dataTransfer.setData("text/plain", t);
            e.dataTransfer.effectAllowed = "copyMove";
            e.target.classList.add("dragging");
        } else {
            e.preventDefault();
        }
    }
    _handleDragEnd(e) {
        if (
            e.target instanceof DatasetTag &&
            e.target.classList.contains("dragging")
        ) {
            e.target.classList.remove("dragging");
        }
        if (state.draggedElement === e.target) {
            state.draggedElement = null;
        }
    }

    _handleContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        const tagText = getTagText(this);
        const isInGroup = !!this.closest("tag-group");
        const selectedCount =
            opentaggerAPI.getSelectedEntries().length;

        const items = [
            {
                label: `Add "${tagText}" to Selection (${selectedCount})`,
                callback: () => {
                    const resultMsg =
                        opentaggerAPI.addTagsToSelected([tagText]);
                    logToConsole(resultMsg, "info");
                },
                disabled: () => selectedCount === 0,
            },
            {
                label: `Remove "${tagText}" from Selection (${selectedCount})`,
                callback: () => {
                    const resultMsg =
                        opentaggerAPI.removeTagsFromSelected([
                            tagText,
                        ]);
                    logToConsole(resultMsg, "info");
                },
                disabled: () => selectedCount === 0,
            },
            { type: "divider" },
            {
                label: "Edit Tag (Double Click)",
                callback: null,
                disabled: true,
            },
            {
                label: "Delete Tag",
                callback: () => this._handleDeleteClick(e),
            },
        ];

        createContextMenu(items, e);
    }

    setHighlight(color) {
        this.style.setProperty("--highlight-border-color", color);
        this.classList.add("searched-highlight");
    }
    clearHighlight() {
        this.classList.remove("searched-highlight");
        this.style.removeProperty("--highlight-border-color");
        this.style.order = "";
    }
}
customElements.define("dataset-tag", DatasetTag);

class TagList extends HTMLElement {
    constructor() {
        super();
        this.addTagButtonElement = null;
        this.addTagInputElement = null;
        this.isEditingNewTag = false;
        this._boundHandleAddTagButtonClick =
            this._handleAddTagButtonClick.bind(this);
        this._boundHandleAddTagInputKeyDown =
            this._handleAddTagInputKeyDown.bind(this);
        this._boundHandleAddTagInputBlur =
            this._handleAddTagInputBlur.bind(this);
    }
    static observedAttributes = ["direction"];
    connectedCallback() {
        this.setDirection();
        this.addEventListeners();
        if (this.closest("dataset-entry")) {
            this._createAddTagButton();
        }
    }
    disconnectedCallback() {
        if (this.addTagButtonElement) {
            this.addTagButtonElement.removeEventListener(
                "click",
                this._boundHandleAddTagButtonClick
            );
        }
        if (this.addTagInputElement) {
            this.addTagInputElement.removeEventListener(
                "keydown",
                this._boundHandleAddTagInputKeyDown
            );
            this.addTagInputElement.removeEventListener(
                "blur",
                this._boundHandleAddTagInputBlur
            );
            this.addTagInputElement.remove();
            this.addTagInputElement = null;
        }
        this.isEditingNewTag = false;
    }
    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "direction") {
            this.setDirection();
        }
    }
    _createAddTagButton() {
        if (
            this.addTagButtonElement &&
            this.contains(this.addTagButtonElement)
        ) {
            this.appendChild(this.addTagButtonElement);
            return;
        }
        this.addTagButtonElement = document.createElement("button");
        this.addTagButtonElement.className = "add-tag-button";
        this.addTagButtonElement.type = "button";
        this.addTagButtonElement.title = "Add a new tag";
        const icon = document.createElement("span");
        icon.className = "material-icons";
        icon.textContent = "add_circle_outline";
        this.addTagButtonElement.appendChild(icon);
        this.addTagButtonElement.addEventListener(
            "click",
            this._boundHandleAddTagButtonClick
        );
        this.appendChild(this.addTagButtonElement);
    }
    _handleAddTagButtonClick(event) {
        event.stopPropagation();
        if (this.isEditingNewTag || !this.addTagButtonElement) {
            return;
        }
        this.isEditingNewTag = true;
        this.addTagButtonElement.style.display = "none";
        this.addTagInputElement = document.createElement("span");
        this.addTagInputElement.setAttribute(
            "contenteditable",
            "true"
        );
        this.addTagInputElement.className = "add-tag-input";
        this.insertBefore(
            this.addTagInputElement,
            this.addTagButtonElement
        );
        this.addTagInputElement.addEventListener(
            "keydown",
            this._boundHandleAddTagInputKeyDown
        );
        this.addTagInputElement.addEventListener(
            "blur",
            this._boundHandleAddTagInputBlur
        );
        requestAnimationFrame(() => {
            this.addTagInputElement.focus();

            window
                .getSelection()
                .selectAllChildren(this.addTagInputElement);
        });
    }
    _handleAddTagInputKeyDown(event) {
        if (!this.isEditingNewTag || !this.addTagInputElement)
            return;
        if (event.key === "Enter") {
            event.preventDefault();
            this.addTagInputElement.blur();
        } else if (event.key === "Escape") {
            event.preventDefault();
            this._revertAddTagButtonToPlaceholder(false);
        }
    }
    _handleAddTagInputBlur() {
        if (!this.isEditingNewTag || !this.addTagInputElement)
            return;

        queueMicrotask(() => {
            if (!this.isEditingNewTag || !this.addTagInputElement)
                return;
            this._revertAddTagButtonToPlaceholder(true);
        });
    }
    _revertAddTagButtonToPlaceholder(shouldProcessTags = false) {
        if (!this.isEditingNewTag && !this.addTagInputElement) {
            if (
                this.addTagButtonElement &&
                this.closest("dataset-entry")
            ) {
                this.addTagButtonElement.style.display = "";
            }
            return;
        }

        let rawInputText = "";
        if (this.addTagInputElement) {
            rawInputText = this.addTagInputElement.textContent;
            this.addTagInputElement.removeEventListener(
                "keydown",
                this._boundHandleAddTagInputKeyDown
            );
            this.addTagInputElement.removeEventListener(
                "blur",
                this._boundHandleAddTagInputBlur
            );
            this.addTagInputElement.remove();
            this.addTagInputElement = null;
        }

        if (this.addTagButtonElement) {
            this.addTagButtonElement.style.display = "";

            if (this.contains(this.addTagButtonElement)) {
                this.appendChild(this.addTagButtonElement);
            } else if (this.closest("dataset-entry")) {
                this._createAddTagButton();
            }
        } else if (this.closest("dataset-entry")) {
            this._createAddTagButton();
        }

        this.isEditingNewTag = false;

        if (shouldProcessTags && rawInputText.trim()) {
            const finalTagTexts = parseRawTagInput(rawInputText);
            for (const tagText of finalTagTexts) {
                this.addTag(tagText);
            }
        }
    }

    setDirection() {
        const d = this.getAttribute("direction") || "row";
        this.style.flexDirection = d;
        this.style.alignItems =
            d === "column" ? "flex-start" : "center";
        this.style.flexWrap = d === "column" ? "nowrap" : "wrap";
    }
    addEventListeners() {
        this.addEventListener("dragover", (e) => {
            if (
                !state.draggedElement ||
                state.draggedElement.tagName !== "DATASET-TAG"
            ) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (
                state.draggedElement.closest("tag-list") !== this ||
                this.contains(state.draggedElement)
            ) {
                e.dataTransfer.dropEffect =
                    this.determineDropEffect(state.draggedElement);
                this.classList.add("drag-over");
            } else {
                e.dataTransfer.dropEffect = "none";
            }
        });
        this.addEventListener("dragleave", (e) => {
            if (
                state.draggedElement &&
                state.draggedElement.tagName === "DATASET-TAG"
            ) {
                const r = this.getBoundingClientRect();

                if (
                    !this.contains(e.relatedTarget) ||
                    e.clientX < r.left ||
                    e.clientX >= r.right ||
                    e.clientY < r.top ||
                    e.clientY >= r.bottom
                ) {
                    this.classList.remove("drag-over");
                }
            }
        });
        this.addEventListener("drop", (e) => {
            if (
                !state.draggedElement ||
                state.draggedElement.tagName !== "DATASET-TAG"
            )
                return;
            e.preventDefault();
            e.stopPropagation();
            this.classList.remove("drag-over");

            const tagText = e.dataTransfer.getData("text/plain");
            if (!tagText) return;

            const amInDatasetEntry =
                !!this.closest("dataset-entry");
            const selectedEntries =
                opentaggerAPI.getSelectedEntries();
            const sourceList = state.draggedElement.closest("tag-list");
            const isSourceGroup =
                !!state.draggedElement.closest("tag-group");

            let eventHandledBySelection = false;

            if (
                amInDatasetEntry &&
                selectedEntries.length > 0 &&
                (isSourceGroup ||
                    (sourceList && sourceList !== this))
            ) {
                let anyTagAddedToSelection = false;
                for (const entry of selectedEntries) {
                    if (entry.addTag(tagText)) {
                        anyTagAddedToSelection = true;
                    }
                }
                eventHandledBySelection = true;
            }

            if (!eventHandledBySelection || sourceList === this) {
                const effect =
                    this.determineDropEffect(state.draggedElement);
                const dropTargetUiElement = this.findDropTarget(
                    e.clientX,
                    e.clientY
                );

                if (
                    this.addTagButtonElement &&
                    (e.target === this.addTagButtonElement ||
                        this.addTagButtonElement.contains(e.target))
                )
                    return;
                if (
                    this.addTagInputElement &&
                    (e.target === this.addTagInputElement ||
                        this.addTagInputElement.contains(e.target))
                )
                    return;

                let actionPerformedLocally = false;
                if (effect === "copy") {
                    if (this.addTag(tagText)) {
                        const newTag = Array.from(
                            this.querySelectorAll("dataset-tag")
                        ).find((t) => getTagText(t) === tagText);
                        if (
                            newTag &&
                            dropTargetUiElement &&
                            (!this.addTagButtonElement ||
                                dropTargetUiElement !==
                                    this.addTagButtonElement)
                        ) {
                            this.insertBefore(
                                newTag,
                                dropTargetUiElement
                            );
                        }
                        actionPerformedLocally = true;
                    }
                } else if (effect === "move") {
                    if (
                        state.draggedElement.parentElement === this &&
                        dropTargetUiElement !==
                            state.draggedElement.nextElementSibling
                    ) {
                        this.insertBefore(
                            state.draggedElement,
                            dropTargetUiElement
                        );
                        actionPerformedLocally = true;
                    }
                }

                if (
                    actionPerformedLocally &&
                    !eventHandledBySelection
                ) {
                    this.dispatchEvent(
                        new CustomEvent("tag-updated", {
                            bubbles: true,
                            composed: true,
                        })
                    );
                    this.dispatchEvent(
                        new CustomEvent(
                            "tag-list-changed-internally",
                            { bubbles: true, composed: true }
                        )
                    );
                }
                sfx.sfxPop.volume = 1.0;
                sfx.sfxPop.play();
            }
        });
    }
    determineDropEffect(el) {
        const sourceList = el.closest("tag-list");
        const sourceGroup = el.closest("tag-group");
        const targetEntry = this.closest("dataset-entry");

        if (sourceGroup && targetEntry) return "copy";
        if (sourceList === this) return "move";
        return "copy";
    }
    findDropTarget(clientX, clientY) {
        const children = Array.from(this.children).filter(
            (c) =>
                c.tagName === "DATASET-TAG" &&
                !c.classList.contains("dragging")
        );
        let closest = null;
        let minDist = Infinity;

        for (const c of children) {
            const b = c.getBoundingClientRect();
            const dx = clientX - (b.left + b.width / 2);
            const dy = clientY - (b.top + b.height / 2);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) {
                minDist = d;
                closest = c;
            }
        }

        if (closest) {
            const b = closest.getBoundingClientRect();
            const col = this.getAttribute("direction") === "column";
            if (col)
                return clientY < b.top + b.height / 2
                    ? closest
                    : closest.nextElementSibling;
            else
                return clientX < b.left + b.width / 2
                    ? closest
                    : closest.nextElementSibling;
        }

        if (
            this.addTagButtonElement &&
            this.contains(this.addTagButtonElement)
        ) {
            return this.addTagButtonElement;
        }
        return null;
    }
    getTags() {
        return Array.from(this.querySelectorAll("dataset-tag")).map(
            (tag) => getTagText(tag)
        );
    }
    getTagsAsString(separator = ", ") {
        return this.getTags().join(separator);
    }
    setTagsFromArray(tagsArray) {
        for (const tag of this.querySelectorAll("dataset-tag")) {
            tag.remove();
        }

        if (this.addTagInputElement) {
            this.addTagInputElement.removeEventListener(
                "keydown",
                this._boundHandleAddTagInputKeyDown
            );
            this.addTagInputElement.removeEventListener(
                "blur",
                this._boundHandleAddTagInputBlur
            );
            this.addTagInputElement.remove();
            this.addTagInputElement = null;
        }
        this.isEditingNewTag = false;

        if (this.addTagButtonElement) {
            this.addTagButtonElement.removeEventListener(
                "click",
                this._boundHandleAddTagButtonClick
            );
            this.addTagButtonElement.remove();
            this.addTagButtonElement = null;
        }

        let changed = false;
        if (Array.isArray(tagsArray)) {
            const uniqueTags = new Set();
            for (const tagText of tagsArray) {
                if (tagText && typeof tagText === "string") {
                    const trimmedTag = tagText.trim();
                    if (
                        trimmedTag &&
                        !uniqueTags.has(trimmedTag.toLowerCase())
                    ) {
                        const newTag =
                            document.createElement("dataset-tag");
                        newTag.textContent = trimmedTag;
                        this.appendChild(newTag);
                        uniqueTags.add(trimmedTag.toLowerCase());
                        changed = true;
                    }
                }
            }
        }
        if (this.closest("dataset-entry")) {
            this._createAddTagButton();
        }

        if (changed) {
            this.dispatchEvent(
                new CustomEvent("tag-updated", {
                    bubbles: true,
                    composed: true,
                })
            );
            this.dispatchEvent(
                new CustomEvent("tag-list-changed-internally", {
                    bubbles: true,
                    composed: true,
                })
            );
        }
    }
    addTag(tagText) {
        tagText = tagText.trim();
        if (!tagText) return false;

        const currentTags = Array.from(
            this.querySelectorAll("dataset-tag")
        );
        if (
            currentTags.some(
                (existingTag) =>
                    getTagText(existingTag).toLowerCase() ===
                    tagText.toLowerCase()
            )
        ) {
            return false;
        }

        const newTag = document.createElement("dataset-tag");
        newTag.textContent = tagText;

        if (
            this.addTagButtonElement &&
            this.contains(this.addTagButtonElement)
        ) {
            this.insertBefore(newTag, this.addTagButtonElement);
        } else {
            this.appendChild(newTag);
        }

        this.dispatchEvent(
            new CustomEvent("tag-list-changed-internally", {
                bubbles: true,
                composed: true,
            })
        );
        this.dispatchEvent(
            new CustomEvent("tag-updated", {
                bubbles: true,
                composed: true,
            })
        );
        return true;
    }
    applyHighlightingAndOrder(searchTerms, termColors) {
        const children = Array.from(this.children);

        for (const [
            originalDOMIndex,
            element,
        ] of children.entries()) {
            if (!(element instanceof DatasetTag)) continue;

            const tagText = getTagText(element).toLowerCase();
            let matchedSearchTerm = null;
            let termIndexOfMatch = -1;

            for (let i = 0; i < searchTerms.length; i++) {
                if (tagText.includes(searchTerms[i])) {
                    matchedSearchTerm = searchTerms[i];
                    termIndexOfMatch = i;
                    break;
                }
            }

            if (matchedSearchTerm !== null) {
                element.setHighlight(termColors[matchedSearchTerm]);

                element.style.order = termIndexOfMatch;
            } else {
                element.clearHighlight();

                element.style.order =
                    searchTerms.length + originalDOMIndex;
            }
        }

        if (
            this.addTagButtonElement &&
            this.contains(this.addTagButtonElement)
        ) {
            this.addTagButtonElement.style.order =
                children.length + 1;
        }
    }
    clearHighlightingAndOrder() {
        for (const element of this.children) {
            if (element instanceof DatasetTag) {
                element.clearHighlight();
            }
            element.style.order = "";
        }
    }
}
customElements.define("tag-list", TagList);

class DatasetEntry extends HTMLElement {
    constructor() {
        super();
        this.imageSrc = "";
        this.imageData = null;
        this.originalImageName = "";
        this._selected = false;
        this._boundCheckAndUpdate =
            this.checkGroupRequirementsAndUpdateVisuals.bind(this);
        this._boundHandleImageClick =
            this._handleImageClick.bind(this);
        this._boundHandleAutotagClick =
            this._handleAutotagClick.bind(this);
        this._boundHandleEntryClick =
            this._handleEntryClick.bind(this);
        this._boundHandleContextMenu =
            this._handleContextMenu.bind(this);
    }
    get selected() {
        return this.hasAttribute("selected");
    }
    set selected(value) {
        const isSelected = Boolean(value);
        if (isSelected) {
            this.setAttribute("selected", "");
            this._selected = true;
        } else {
            this.removeAttribute("selected");
            this._selected = false;
        }
    }
    toggleSelected() {
        this.selected = !this.selected;
    }
    connectedCallback() {
        this.classList.add("dataset-entry");
        if (!this.querySelector(".entry-content")) {
            this.innerHTML = `
    <div class="entry-content">
        <img src="${this.imageSrc || ""}" alt="${
                this.originalImageName || ""
            }" title="Click to preview">
        <tag-list direction="row"></tag-list>
    </div>
    <div class="entry-buttons">
        <button class="autotag-entry material-icons" title="Autotag Image (AI)" speaker="Autotag Image">auto_awesome</button>
    </div>
    <button class="delete-entry material-icons" title="Delete Entry" speaker="Delete Entry">delete_forever</button>`;
        }
        this.style.position = "relative";

        const delBtn = this.querySelector(".delete-entry");
        delBtn.addEventListener("click", () => this.deleteEntry());

        const autotagBtn = this.querySelector(".autotag-entry");
        autotagBtn?.addEventListener(
            "click",
            this._boundHandleAutotagClick
        );

        this.addEventListener(
            "tag-updated",
            this._boundCheckAndUpdate
        );

        this.addEventListener(
            "tag-list-changed-internally",
            this._boundCheckAndUpdate
        );

        const img = this.querySelector("img");
        img?.addEventListener("click", this._boundHandleImageClick);

        this.addEventListener("click", this._boundHandleEntryClick);
        this.addEventListener(
            "contextmenu",
            this._boundHandleContextMenu
        );

        this.checkGroupRequirementsAndUpdateVisuals();
        this.addDragDropListeners();

        if (img && this.imageSrc && !img.src) {
            img.src = this.imageSrc;
            img.alt = this.originalImageName;
            img.title = "Click to preview";
        }
    }
    disconnectedCallback() {
        const img = this.querySelector("img");
        if (img?.src.startsWith("blob:")) {
            URL.revokeObjectURL(img.src);
        }
        this.removeEventListener(
            "tag-updated",
            this._boundCheckAndUpdate
        );
        this.removeEventListener(
            "tag-list-changed-internally",
            this._boundCheckAndUpdate
        );
        img?.removeEventListener(
            "click",
            this._boundHandleImageClick
        );
        this.querySelector(".autotag-entry")?.removeEventListener(
            "click",
            this._boundHandleAutotagClick
        );
        this.removeEventListener(
            "click",
            this._boundHandleEntryClick
        );
        this.removeEventListener(
            "contextmenu",
            this._boundHandleContextMenu
        );
    }

    _handleEntryClick(event) {
        const clickedEntry = this;
        const wasSelected = clickedEntry.selected;
        const isCtrlPressed = event.ctrlKey || event.metaKey; // metaKey for macOS
        const isShiftPressed = event.shiftKey;

        const targetTagName = event.target.tagName.toLowerCase();
        if (
            targetTagName !== "input" &&
            targetTagName !== "textarea" &&
            !event.target.isContentEditable &&
            event.target !== clickedEntry.querySelector("img")
        ) {
            event.preventDefault();
        }

        const target = event.target;
        if (
            target.closest("button") ||
            target.closest("dataset-tag") || // Allow click on tag to propagate if needed by tag itself
            target.closest('span[contenteditable="true"]') ||
            target.tagName === "IMG"
        ) {
            // If the dataset-tag was clicked, and it wasn't the editable span or delete button,
            // it might be for initiating drag. Let the event propagate for that.
            // If it was span/button, those have their own handlers.
            if (
                target.closest("dataset-tag") &&
                !target.closest("span[contenteditable]") &&
                !target.closest(".delete-tag")
            ) {
                // Fine, could be drag start
            } else {
                return; // Otherwise, specific interactive element was clicked.
            }
        }

        event.stopPropagation();

        if (
            isShiftPressed &&
            state.globalLastClickedEntryForShiftSelect &&
            state.mainContentAreaElement
        ) {
            const allVisibleEntries = Array.from(
                state.mainContentAreaElement.querySelectorAll(
                    'dataset-entry:not([style*="display: none"])'
                )
            );
            const currentIndex =
                allVisibleEntries.indexOf(clickedEntry);
            const lastIndex = allVisibleEntries.indexOf(
                state.globalLastClickedEntryForShiftSelect
            );

            if (currentIndex !== -1 && lastIndex !== -1) {
                const start = Math.min(currentIndex, lastIndex);
                const end = Math.max(currentIndex, lastIndex);

                if (!isCtrlPressed) {
                    for (const entry of state.mainContentAreaElement.querySelectorAll(
                        "dataset-entry[selected]"
                    )) {
                        entry.selected = false;
                    }
                }

                for (let i = start; i <= end; i++) {
                    if (allVisibleEntries[i]) {
                        allVisibleEntries[i].selected = true;
                    }
                }
            } else {
                clickedEntry.selected = !wasSelected;
                state.globalLastClickedEntryForShiftSelect =
                    clickedEntry.selected ? clickedEntry : null;
            }
        } else if (isCtrlPressed) {
            clickedEntry.selected = !wasSelected;
            if (clickedEntry.selected) {
                state.globalLastClickedEntryForShiftSelect = clickedEntry;
            } else if (
                state.globalLastClickedEntryForShiftSelect ===
                clickedEntry
            ) {
                state.globalLastClickedEntryForShiftSelect = null;
            }
        } else {
            const currentlySelected =
                opentaggerAPI.getSelectedEntries();
            const isAlreadySolelySelected =
                currentlySelected.length === 1 &&
                currentlySelected[0] === clickedEntry;

            if (isAlreadySolelySelected && wasSelected) {
                clickedEntry.selected = false;
                state.globalLastClickedEntryForShiftSelect = null;
            } else {
                for (const entry of currentlySelected) {
                    entry.selected = false;
                }
                clickedEntry.selected = true;
                state.globalLastClickedEntryForShiftSelect = clickedEntry;
            }
        }
    }

    _handleContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        const entry = this;
        const targetEntries = entry.selected
            ? opentaggerAPI.getSelectedEntries()
            : [entry];
        const targetCount = targetEntries.length;

        const contextMenuItems = [
            {
                label: "Preview Image",
                callback: () => entry._handleImageClick(e),
            },
            {
                label: "Autotag Image (AI)",
                callback: () => entry.triggerAutotag(false),
            },
            { type: "divider" },
            {
                label: `Copy Tags (${targetCount} selected) (NYI)`,
                disabled: true,
            },
            {
                label: `Paste Tags (${targetCount} selected) (NYI)`,
                disabled: true,
            },
            { type: "divider" },
            {
                label: `Add Tags to ${targetCount} Selected... (NYI via UI)`,
                disabled: () => targetCount === 0,
                callback: () => {
                    /* TODO: Prompt for tags */
                },
            },
            {
                label: `Remove Tags from ${targetCount} Selected... (NYI via UI)`,
                disabled: () => targetCount === 0,
                callback: () => {
                    /* TODO: Prompt for tags */
                },
            },
            { type: "divider" },
            {
                label: "Apply Group Tags",
                items: getGroupSubmenuItems(targetEntries),
                disabled: () => targetCount === 0,
            },
            { type: "divider" },
            {
                label: "Check Requirements",
                callback: () =>
                    entry.checkGroupRequirementsAndUpdateVisuals(),
            },
            { type: "divider" },
            {
                label: "Delete Entry",
                callback: () => entry.deleteEntry(),
            },
        ];

        if (targetCount > 1) {
            contextMenuItems.push({ type: "divider" });
            contextMenuItems.push({
                label: `Delete ${targetCount} Selected Entries`,
                callback: () => {
                    showConfirmationModal(
                        `Are you sure you want to delete ${targetCount} selected entries?`,
                        [
                            {
                                text: "Delete",
                                class: "modal-button-confirm",
                                onClick: () => {
                                    const entriesToDelete = [
                                        ...targetEntries,
                                    ];
                                    for (const en of entriesToDelete)
                                        en.deleteEntry();
                                    state.globalLastClickedEntryForShiftSelect =
                                        null;
                                },
                            },
                            {
                                text: "Cancel",
                                class: "modal-button-cancel",
                            },
                        ]
                    );
                },
                disabled: () => targetCount === 0,
            });
        }

        createContextMenu(contextMenuItems, e);
    }

    _handleImageClick(e) {
        e.stopPropagation();
        if (this.imageSrc) {
            showImagePreviewModal(
                this.imageSrc,
                this.originalImageName
            );
        }
    }
    deleteEntry() {
        const img = this.querySelector("img");
        if (img?.src.startsWith("blob:") && URL.revokeObjectURL) {
            URL.revokeObjectURL(img.src);
        }
        this.remove();
        this.dispatchEvent(
            new CustomEvent("entry-deleted", { bubbles: true })
        );
    }
    async _handleAutotagClick(e) {
        e.stopPropagation();
        await this.triggerAutotag(false);
    }
    async triggerAutotag(silent = false) { // Changed: Modified fetch URL logic
        const autotagButton = this.querySelector(".autotag-entry");
        const buttonWrapper = this.querySelector(".entry-buttons");

        if (!autotagButton) {
            console.error(
                `Autotag button not found for ${this.originalImageName}.`
            );
            return {
                success: false,
                message: "Autotag button not found.",
                tagsAddedCount: 0,
                elapsedTime: 0,
            };
        }
        if (!buttonWrapper && !silent) {
            console.error(
                `Button wrapper not found for ${this.originalImageName} for timer placement.`
            );
        }

        if (autotagButton.disabled) {
            if (!silent) {
                console.warn(
                    `Autotag for ${this.originalImageName} skipped as button is disabled.`
                );
            }
            return {
                success: false,
                message: "Autotag action disabled.",
                tagsAddedCount: 0,
                elapsedTime: 0,
            };
        }

        let timer = null;
        let timerLabel = null;
        let operationResult = {
            success: false,
            message: "Operation not fully completed.",
            tagsAddedCount: 0,
            elapsedTime: 0,
        };

        if (!silent && buttonWrapper) {
            buttonWrapper
                .querySelector(".autotag-timer-label")
                ?.remove();
            timerLabel = createTimerLabelElement();
            buttonWrapper.appendChild(timerLabel);
            timer = startTimer((timeString) => {
                if (timerLabel) timerLabel.textContent = timeString;
            }, 100);
        }

        const originalIcon = autotagButton.textContent;
        const originalTitle = autotagButton.getAttribute("title");

        autotagButton.disabled = true;
        if (!silent) {
            autotagButton.textContent = "sync";
            autotagButton.setAttribute(
                "title",
                "Autotagging in progress..."
            );
            autotagButton.classList.add("loading");
        }

        try {
            const imageData = await this.getImageData();
            if (!imageData) {
                throw new Error(
                    "No image data available for autotagging."
                );
            }

            const formData = new FormData();
            formData.append(
                "image_upload",
                imageData,
                this.originalImageName || "image.png"
            );

            const selectedModel =
                preferences.tagging.autotagging.autotaggingModel
                    .value;
            let endpointPath = "";

            switch (selectedModel) {
                case "wd-vit-tagger-v3":
                    endpointPath = "wd-vit-tagger-v3";
                    break;
                case "it_so400m_patch14_siglip_384":
                    endpointPath = "redrocket-joint-tagger";
                    break;
                default:
                    throw new Error(
                        `Unknown autotagging model selected: ${selectedModel}`
                    );
            }

            const fullApiUrl = `${state.AUTOTAG_API_URL}${endpointPath}`;

            const response = await fetch(fullApiUrl, {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                let errorDetail = `HTTP error ${response.status}`;
                try {
                    const errorJson = await response.json();
                    errorDetail = errorJson.detail || errorDetail;
                } catch (jsonError) {
                    const errorText = await response.text();
                    errorDetail = errorText || errorDetail;
                }
                if (!silent)
                    console.error(
                        `Autotagging HTTP error ${
                            response.status
                        } for ${
                            this.originalImageName
                        }. Details: ${errorDetail}. Full response text: ${await response
                            .text()
                            .catch(
                                () => "Could not read response text"
                            )}`
                    );
                throw new Error(
                    `Autotagging failed: ${errorDetail}`
                );
            }

            const result = await response.json();
            const tags = result.tags;
            let tagsAddedCount = 0;

            if (Array.isArray(tags)) {
                for (const tag of tags) {
                    if (this.addTag(tag)) {
                        tagsAddedCount++;
                    }
                }
                if (!silent) {
                    console.log(
                        `Autotag for ${
                            this.originalImageName || "untitled"
                        } complete. ${tagsAddedCount} new tag(s) added. Total AI tags: ${
                            tags.length
                        }.`
                    );
                }
                operationResult = {
                    success: true,
                    tagsAddedCount: tagsAddedCount,
                    totalAiTags: tags.length,
                    elapsedTime: 0,
                };
            } else {
                throw new Error(
                    "Autotagger returned an unexpected response format."
                );
            }
        } catch (error) {
            console.error(
                `Autotagging error for ${
                    this.originalImageName || "untitled"
                }:`,
                error
            );
            operationResult = {
                success: false,
                message: error.message,
                tagsAddedCount: 0,
                elapsedTime: 0,
            };
        } finally {
            if (timer) {
                operationResult.elapsedTime = timer.stop();
            }
            if (!silent && timerLabel) {
                const finalMessage = operationResult.success
                    ? `Done: ${operationResult.elapsedTime.toFixed(
                          1
                      )}s`
                    : `Error: ${operationResult.elapsedTime.toFixed(
                          1
                      )}s`;
                timerLabel.textContent = finalMessage;
                timerLabel.classList.add("fade-out");
                setTimeout(() => timerLabel.remove(), 2500);
            }

            if (!silent) {
                autotagButton.textContent = originalIcon;
                autotagButton.setAttribute("title", originalTitle);
                autotagButton.classList.remove("loading");
            }

            if (!state.autotagAllButton.classList.contains("loading")) {
                autotagButton.disabled = false;
            }
        }
        return operationResult;
    }
    addDragDropListeners() {
        const tagList = this.querySelector("tag-list");

        this.addEventListener("dragenter", (e) => {
            if (
                state.draggedElement?.tagName === "DATASET-TAG" &&
                tagList
            ) {
                const listRect = tagList.getBoundingClientRect();
                if (
                    e.clientX >= listRect.left &&
                    e.clientX <= listRect.right &&
                    e.clientY >= listRect.top &&
                    e.clientY <= listRect.bottom
                ) {
                    tagList.classList.add("drag-over");
                }
            }
        });

        this.addEventListener("dragover", (e) => {
            if (
                state.draggedElement?.tagName === "DATASET-TAG" &&
                tagList
            ) {
                const listRect = tagList.getBoundingClientRect();
                if (
                    e.clientX >= listRect.left &&
                    e.clientX <= listRect.right &&
                    e.clientY >= listRect.top &&
                    e.clientY <= listRect.bottom
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect =
                        tagList.determineDropEffect(state.draggedElement);
                    tagList.classList.add("drag-over");
                } else {
                    tagList.classList.remove("drag-over");
                }
            } else if (e.dataTransfer.types.includes("Files")) {
            } else {
                e.dataTransfer.dropEffect = "none";
            }
        });

        this.addEventListener("dragleave", (e) => {
            if (
                state.draggedElement?.tagName === "DATASET-TAG" &&
                tagList
            ) {
                const entryRect = this.getBoundingClientRect();
                if (
                    !this.contains(e.relatedTarget) ||
                    e.clientX < entryRect.left ||
                    e.clientX >= entryRect.right ||
                    e.clientY < entryRect.top ||
                    e.clientY >= entryRect.bottom
                ) {
                    tagList.classList.remove("drag-over");
                } else {
                    const listRect =
                        tagList.getBoundingClientRect();
                    if (
                        e.clientX < listRect.left ||
                        e.clientX >= listRect.right ||
                        e.clientY < listRect.top ||
                        e.clientY >= listRect.bottom
                    ) {
                        tagList.classList.remove("drag-over");
                    }
                }
            }
        });

        this.addEventListener("drop", (e) => {
            if (
                state.draggedElement?.tagName === "DATASET-TAG" &&
                tagList
            ) {
                tagList.classList.remove("drag-over");
            } else if (e.dataTransfer.files?.length > 0) {
                tagList?.classList.remove("drag-over");
            } else {
                tagList?.classList.remove("drag-over");
            }
        });
    }
    setImage(blobUrl, fileObject) {
        const img = this.querySelector("img");
        if (
            img?.src.startsWith("blob:") &&
            img.src !== blobUrl &&
            URL.revokeObjectURL
        ) {
            URL.revokeObjectURL(img.src);
        }
        this.imageSrc = blobUrl;
        this.imageData = fileObject;
        this.originalImageName =
            fileObject?.name || `image_${Date.now()}.png`;
        if (img) {
            img.src = this.imageSrc;
            img.alt = this.originalImageName;
            img.title = "Click to preview";
        }
        this.checkGroupRequirementsAndUpdateVisuals();
    }
    async getImageData() {
        if (
            this.imageData instanceof Blob ||
            this.imageData instanceof File
        ) {
            return this.imageData;
        }

        if (
            this.imageSrc.startsWith("data:") ||
            this.imageSrc.startsWith("blob:")
        ) {
            try {
                console.warn(
                    `Attempting to fetch image data from src for ${this.originalImageName}. Direct Blob/File preferred.`
                );
                const response = await fetch(this.imageSrc);
                if (!response.ok)
                    throw new Error(
                        `HTTP error! status: ${response.status}`
                    );
                this.imageData = await response.blob();

                const name =
                    this.originalImageName ||
                    `fetched_image_${Date.now()}.png`;
                if (this.imageData instanceof Blob) {
                    this.imageData = new File(
                        [this.imageData],
                        name,
                        { type: this.imageData.type }
                    );
                } else {
                    console.error(
                        "Fetched data was not a Blob, cannot create File."
                    );
                    return null;
                }
                return this.imageData;
            } catch (e) {
                console.error(
                    `Error fetching image data from src (${this.imageSrc}):`,
                    e
                );
                return null;
            }
        }
        console.error(
            `Could not get image data for entry: ${this.originalImageName}`
        );
        return null;
    }
    addTag(text) {
        const list = this.querySelector("tag-list");
        const added = list ? list.addTag(text) : false;

        return added;
    }
    setTags(tagsArray) {
        const list = this.querySelector("tag-list");
        if (list) {
            list.setTagsFromArray(tagsArray);
        } else {
            console.warn(
                "setTags called on dataset-entry, but internal <tag-list> not found. Tags not set for:",
                this.originalImageName
            );
        }
    }
    getTagsAsString(sep = ", ") {
        const list = this.querySelector("tag-list");
        return list ? list.getTagsAsString(sep) : "";
    }
    getTags() {
        const list = this.querySelector("tag-list");
        return list ? list.getTags() : [];
    }
    getNormalizedTags() {
        return this.getTags().map((tag) => tag.toLowerCase());
    }
    checkGroupRequirements() {
        const groups = document.querySelectorAll(
            "#tag-group-list tag-group"
        );
        const entryTagsLower = this.getNormalizedTags();

        for (const group of groups) {
            const minRequired = group.minimumTags;
            if (minRequired <= 0) continue;

            const groupTagsLower = group
                .getGroupTags()
                .map((t) => t.toLowerCase());
            if (groupTagsLower.length === 0) continue;

            let count = 0;
            for (const entryTag of entryTagsLower) {
                if (groupTagsLower.includes(entryTag)) {
                    count++;
                }
            }
            if (count < minRequired) {
                return false;
            }
        }
        return true;
    }
    checkGroupRequirementsAndUpdateVisuals() {
        const requirementsMet = this.checkGroupRequirements();
        if (requirementsMet) {
            this.classList.remove("requirement-not-met");
        } else {
            this.classList.add("requirement-not-met");
        }
    }
    applyTagHighlighting(searchTerms, termColors) {
        const tagList = this.querySelector("tag-list");
        tagList?.applyHighlightingAndOrder(searchTerms, termColors);
    }
    clearTagHighlighting() {
        const tagList = this.querySelector("tag-list");
        tagList?.clearHighlightingAndOrder();
    }
}
customElements.define("dataset-entry", DatasetEntry);

class TagGroup extends HTMLElement {
    constructor() {
        super();
        this._minimumTags = 0;
        this._boundUpdateMinTags = this._updateMinTags.bind(this);
        this._boundHandleContextMenu =
            this._handleContextMenu.bind(this);
    }
    static observedAttributes = ["group-name"];
    get minimumTags() {
        return this._minimumTags;
    }
    set minimumTags(value) {
        const newMin = Math.max(0, parseInt(value, 10) || 0);
        if (newMin !== this._minimumTags) {
            this._minimumTags = newMin;
            this.updateMinTagsDisplay();

            document.dispatchEvent(
                new CustomEvent("group-min-tags-changed", {
                    detail: { group: this },
                })
            );
        }
    }
    connectedCallback() {
        const name = this.getAttribute("group-name") || "New Group";
        const tags = Array.from(
            this.querySelectorAll("dataset-tag")
        );
        this.innerHTML = `
<div class="group-header">
    <span class="group-name" contenteditable="true">${name}</span>
     <div class="min-tags-control">
         <span>Min:</span>
         <button class="min-tags-decrement material-icons" speaker="Decrease Minimum Tags">remove</button>
         <span class="min-tags-value">0</span>
         <button class="min-tags-increment material-icons" speaker="Increase Minimum Tags">add</button>
     </div>
     <button class="btn-new-tag material-icons" speaker="Add New Tag">add_circle_outline</button>
</div>
 <tag-list direction="column"></tag-list>
 <button class="delete-group material-icons" speaker="Delete Group">delete</button>`;
        this.style.position = "relative";

        const delBtn = this.querySelector(".delete-group");
        delBtn.style.cssText = `position: absolute; bottom: 5px; right: 5px; background: none; border: none; cursor: pointer; color: #aaa; font-size: 18px;`;
        delBtn.addEventListener("click", () => {
            this.remove();

            document.dispatchEvent(
                new CustomEvent("group-min-tags-changed", {
                    detail: { group: null },
                })
            );
        });

        const list = this.querySelector("tag-list");

        for (const t of tags) {
            list.appendChild(t);
        }
        this.addEventListeners();
        this.updateMinTagsDisplay();
    }
    disconnectedCallback() {}
    attributeChangedCallback(name, oldV, newV) {
        if (name === "group-name") {
            const s = this.querySelector(".group-name");
            if (s) s.textContent = newV;
        }
    }
    addEventListeners() {
        const addBtn = this.querySelector(".btn-new-tag");
        const list = this.querySelector("tag-list");
        const nameSpan = this.querySelector(".group-name");
        const incBtn = this.querySelector(".min-tags-increment");
        const decBtn = this.querySelector(".min-tags-decrement");

        if (addBtn && list) {
            addBtn.addEventListener("click", () => {
                const added = list.addTag("new_tag");
                if (added) {
                    const tagElements =
                        list.querySelectorAll("dataset-tag");
                    const tag = tagElements[tagElements.length - 1];
                    if (tag) {
                        const s = tag.querySelector(
                            "span[contenteditable]"
                        );
                        if (s) {
                            s.setAttribute(
                                "contenteditable",
                                "true"
                            );
                            tag._originalText = getTagText(tag); // Set original text before focus
                            s.focus();

                            window
                                .getSelection()
                                .selectAllChildren(s);
                        }
                    }
                }
            });
        }
        if (nameSpan) {
            nameSpan.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    nameSpan.blur();
                } else if (e.key === "Escape") {
                    nameSpan.textContent =
                        this.getAttribute("group-name") ||
                        "New Cat";
                    nameSpan.blur();
                }
            });
            nameSpan.addEventListener("blur", () => {
                const n = nameSpan.textContent.trim();
                if (
                    n &&
                    n !==
                        (this.getAttribute("group-name") ||
                            "New Cat")
                ) {
                    this.setAttribute("group-name", n);
                } else {
                    nameSpan.textContent =
                        this.getAttribute("group-name") ||
                        "New Cat";
                }
            });
        }
        incBtn?.addEventListener("click", () =>
            this._updateMinTags(1)
        );
        decBtn?.addEventListener("click", () =>
            this._updateMinTags(-1)
        );

        addBtn?.addEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        incBtn?.addEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        decBtn?.addEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        nameSpan?.addEventListener("mousedown", (e) =>
            e.stopPropagation()
        );

        this.addEventListener(
            "contextmenu",
            this._boundHandleContextMenu
        );
    }
    removeEventListeners() {
        const addBtn = this.querySelector(".btn-new-tag");
        const nameSpan = this.querySelector(".group-name");
        const incBtn = this.querySelector(".min-tags-increment");
        const decBtn = this.querySelector(".min-tags-decrement");

        addBtn?.removeEventListener(
            "click",
            this._handleAddTagButtonClick
        ); // Assuming this was a typo for actual method
        nameSpan?.removeEventListener(
            "keydown",
            this._handleSpanKeyDown
        );
        nameSpan?.removeEventListener("blur", this._handleSpanBlur);
        incBtn?.removeEventListener(
            "click",
            this._boundUpdateMinTags
        ); // This should be correct
        decBtn?.removeEventListener(
            "click",
            this._boundUpdateMinTags
        ); // This should be correct

        addBtn?.removeEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        incBtn?.removeEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        decBtn?.removeEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        nameSpan?.removeEventListener("mousedown", (e) =>
            e.stopPropagation()
        );

        this.removeEventListener(
            "contextmenu",
            this._boundHandleContextMenu
        );
    }
    _updateMinTags(delta) {
        this.minimumTags += delta;
    }
    updateMinTagsDisplay() {
        const valueSpan = this.querySelector(".min-tags-value");
        if (valueSpan) {
            valueSpan.textContent = this._minimumTags;
        }
    }
    getGroupTags() {
        const list = this.querySelector("tag-list");
        return list ? list.getTags() : [];
    }
    setTags(tagsArray) {
        const list = this.querySelector("tag-list");
        list?.setTagsFromArray(tagsArray);
    }

    _handleContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        const items = [
            {
                label: "Rename Group (Double Click Name)",
                callback: null,
                disabled: true,
            },
            {
                label: "Add New Tag",
                callback: () =>
                    this.querySelector(".btn-new-tag")?.click(),
            },
            { type: "divider" },
            {
                label: "Delete Group",
                callback: () =>
                    this.querySelector(".delete-group")?.click(),
            },
        ];

        createContextMenu(items, e);
    }
}
customElements.define("tag-group", TagGroup);



function createContextMenu(items, triggerElementOrEvent) {
    state.currentContextMenu?.remove();
    state.currentContextMenu = null;

    const menu = document.createElement("context-menu");

    for (const item of items) {
        if (item.type === "divider") {
            menu.appendChild(document.createElement("hr"));
        } else {
            const menuItem = document.createElement("menu-item");
            menuItem.textContent = item.label || "Item";

            let isHidden = false;
            if (typeof item.hidden === "function") {
                isHidden = item.hidden(triggerElementOrEvent);
            } else if (typeof item.hidden === "boolean") {
                isHidden = item.hidden;
            }
            if (isHidden) {
                menuItem.style.display = "none";
            }

            let isDisabled = false;
            if (typeof item.disabled === "function") {
                isDisabled = item.disabled(triggerElementOrEvent);
            } else if (typeof item.disabled === "boolean") {
                isDisabled = item.disabled;
            }

            if (isDisabled) {
                menuItem.classList.add("disabled");
            } else {
                if (
                    item.callback &&
                    typeof item.callback === "function"
                ) {
                    menuItem.callback = item.callback;
                } else if (!item.items) {
                    menuItem.style.opacity = "0.5";
                    menuItem.style.pointerEvents = "none";
                }
            }

            if (item.dataAction)
                menuItem.dataset.action = item.dataAction;

            if (item.items && item.items.length > 0) {
                const subMenu =
                    document.createElement("context-menu");

                for (const subItem of item.items) {
                    if (subItem.type === "divider") {
                        subMenu.appendChild(
                            document.createElement("hr")
                        );
                    } else {
                        const subMenuItem =
                            document.createElement("menu-item");
                        subMenuItem.textContent =
                            subItem.label || "Sub Item";

                        let isSubHidden = false;
                        if (typeof subItem.hidden === "function") {
                            isSubHidden = subItem.hidden(
                                triggerElementOrEvent
                            );
                        } else if (
                            typeof subItem.hidden === "boolean"
                        ) {
                            isSubHidden = subItem.hidden;
                        }
                        if (isSubHidden) {
                            subMenuItem.style.display = "none";
                        }

                        let isSubDisabled = false;
                        if (
                            typeof subItem.disabled === "function"
                        ) {
                            isSubDisabled = subItem.disabled(
                                triggerElementOrEvent
                            );
                        } else if (
                            typeof subItem.disabled === "boolean"
                        ) {
                            isSubDisabled = subItem.disabled;
                        }

                        if (isSubDisabled) {
                            subMenuItem.classList.add("disabled");
                        } else {
                            if (
                                subItem.callback &&
                                typeof subItem.callback ===
                                    "function"
                            ) {
                                subMenuItem.callback =
                                    subItem.callback;
                            } else if (!subItem.items) {
                                subMenuItem.style.opacity = "0.5";
                                subMenuItem.style.pointerEvents =
                                    "none";
                            }
                        }

                        if (subItem.dataAction)
                            subMenuItem.dataset.action =
                                subItem.dataAction;
                        subMenu.appendChild(subMenuItem);
                    }
                }
                menuItem.appendChild(subMenu);
            }
            menu.appendChild(menuItem);
        }
    }

    document.body.appendChild(menu);
    state.currentContextMenu = menu;

    if (triggerElementOrEvent instanceof HTMLElement) {
        state.currentContextMenu._ownerButton = triggerElementOrEvent;
    } else {
        state.currentContextMenu._ownerButton = null;
    }

    if (triggerElementOrEvent instanceof Event) {
        triggerElementOrEvent.preventDefault();
        menu.show(
            triggerElementOrEvent.clientX,
            triggerElementOrEvent.clientY
        );
    } else if (triggerElementOrEvent instanceof HTMLElement) {
        menu.show(0, 0, triggerElementOrEvent);
    }
    return menu;
}

function showConfirmationModal(message, buttons) {
    document.querySelector(".modal-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const content = document.createElement("div");
    content.className = "modal-content";

    const msgElement = document.createElement("div");
    msgElement.className = "modal-message";
    msgElement.textContent = message;
    msgElement.style.whiteSpace = "pre-wrap";

    const btnContainer = document.createElement("div");
    btnContainer.className = "modal-buttons";

    for (const btnInfo of buttons) {
        const button = document.createElement("button");
        button.textContent = btnInfo.text;
        button.className = btnInfo.class || "modal-button-default";
        button.addEventListener("click", () => {
            overlay.remove();
            if (typeof btnInfo.onClick === "function") {
                btnInfo.onClick();
            }
        });
        btnContainer.appendChild(button);
    }

    content.appendChild(msgElement);
    content.appendChild(btnContainer);
    overlay.appendChild(content);

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });

    document.body.appendChild(overlay);
}

function showImagePreviewModal(imageUrl, imageName) {
    document.querySelector(".image-preview-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "image-preview-overlay";

    const content = document.createElement("div");
    content.className = "image-preview-content";

    const closeBtn = document.createElement("button");
    closeBtn.className = "image-preview-close material-icons";
    closeBtn.textContent = "close";
    closeBtn.setAttribute("title", "Close Preview");

    const imgPreview = document.createElement("img");
    imgPreview.alt = `Preview: ${imageName}`;

    const infoDiv = document.createElement("div");
    infoDiv.className = "image-preview-info";
    infoDiv.textContent = "Loading image...";

    content.appendChild(closeBtn);
    content.appendChild(imgPreview);
    content.appendChild(infoDiv);
    overlay.appendChild(content);

    const close = () => {
        overlay.remove();
        document.removeEventListener("keydown", escapeHandler);
    };

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
            close();
        }
    });
    closeBtn.addEventListener("click", close);

    const escapeHandler = (e) => {
        if (e.key === "Escape") {
            close();
        }
    };
    document.addEventListener("keydown", escapeHandler);

    const tempImg = new Image();
    tempImg.onload = () => {
        imgPreview.src = imageUrl;
        infoDiv.innerHTML = `
 <strong>${imageName}</strong>
 <br>
 Dimensions: ${tempImg.naturalWidth} x ${tempImg.naturalHeight} pixels
          `;
    };
    tempImg.onerror = () => {
        infoDiv.textContent = `Error: Could not load preview for ${imageName}.`;
        console.error(
            "Image Preview Modal: Failed to load",
            imageUrl
        );
    };
    tempImg.src = imageUrl;

    document.body.appendChild(overlay);
}

const checkDropHintVisibility = () => {
    if (!state.mainContentAreaElement || !state.dropHint || !state.searchInput) {
        return;
    }

    const hasAnyEntries =
        state.mainContentAreaElement.querySelector("dataset-entry");

    if (!hasAnyEntries) {
        state.dropHint.textContent =
            "Drag & Drop Images Here, Load Project, or Import Dataset ZIP";
        state.dropHint.classList.remove("no-results");
        state.dropHint.style.display = "block";
        return;
    }

    const hasVisibleEntries = state.mainContentAreaElement.querySelector(
        'dataset-entry:not([style*="display: none"])'
    );
    if (!hasVisibleEntries && state.searchInput.value.trim() !== "") {
        state.dropHint.textContent = "";
        state.dropHint.classList.add("no-results");
        state.dropHint.style.display = "block";
    } else {
        state.dropHint.classList.remove("no-results");
        state.dropHint.style.display = "none";
    }
};

async function handleAutotagAllClick() {
    if (
        !state.mainContentAreaElement ||
        !state.autotagAllButton ||
        state.autotagAllButton.disabled
    )
        return;

    const entriesToAutotag = Array.from(
        state.mainContentAreaElement.querySelectorAll(
            'dataset-entry:not([style*="display: none"])'
        )
    );

    if (entriesToAutotag.length === 0) {
        showConfirmationModal("No visible entries to autotag.", [
            { text: "OK" },
        ]);
        return;
    }

    const originalButtonIcon = state.autotagAllButton.textContent;
    const originalButtonTitle =
        state.autotagAllButton.getAttribute("title");

    state.autotagAllButton.textContent = "sync";
    state.autotagAllButton.classList.add("loading");
    state.autotagAllButton.disabled = true;

    let globalTimerLabel =
        state.autotagAllButton.parentElement.querySelector(
            ".autotag-timer-label"
        );
    if (!globalTimerLabel) {
        globalTimerLabel = createTimerLabelElement();
        state.autotagAllButton.insertAdjacentElement(
            "afterend",
            globalTimerLabel
        );
    } else {
        globalTimerLabel.textContent = "0.0s";
        globalTimerLabel.classList.remove("fade-out");
    }

    let successCount = 0;
    let failCount = 0;
    const totalEntries = entriesToAutotag.length;

    let globalTimer = startTimer((timeString) => {
        if (globalTimerLabel)
            globalTimerLabel.textContent = timeString;
        const processedCount = successCount + failCount;
        state.autotagAllButton.setAttribute(
            "title",
            `Autotagging ${processedCount}/${totalEntries}... (${timeString})`
        );
    }, 200);

    for (const entry of entriesToAutotag) {
        const btn = entry.querySelector(".autotag-entry");
        if (btn) btn.disabled = true;
    }

    for (let i = 0; i < totalEntries; i++) {
        const entry = entriesToAutotag[i];
        const entryDisplayName =
            entry.originalImageName || `entry ${i + 1}`;
        state.autotagAllButton.setAttribute(
            "title",
            `Autotagging ${
                successCount + failCount + 1
            }/${totalEntries}: ${entryDisplayName} (${globalTimer.getElapsedTime()})`
        );
        try {
            const result = await entry.triggerAutotag(true);
            if (result && result.success) {
                successCount++;
                console.log(
                    `Autotagged successfully: ${entryDisplayName}. New tags: ${result.tagsAddedCount}`
                );
            } else {
                failCount++;
                console.warn(
                    `Autotagging failed or no tags added for: ${entryDisplayName}. Message: ${
                        result ? result.message : "No details"
                    }`
                );
            }
        } catch (error) {
            failCount++;
            console.error(
                `Critical error during autotag for entry ${entryDisplayName}:`,
                error
            );
        }
    }

    const totalElapsedTime = globalTimer.stop();
    if (globalTimerLabel) {
        globalTimerLabel.textContent = `Total: ${totalElapsedTime.toFixed(
            1
        )}s`;
        globalTimerLabel.classList.add("fade-out");
        setTimeout(() => globalTimerLabel.remove(), 3000);
    }

    state.autotagAllButton.textContent = originalButtonIcon;
    state.autotagAllButton.setAttribute("title", originalButtonTitle);
    state.autotagAllButton.classList.remove("loading");
    state.autotagAllButton.disabled = false;

    for (const entry of entriesToAutotag) {
        const btn = entry.querySelector(".autotag-entry");
        if (btn) btn.disabled = false;
    }

    let summaryMessage = `Autotag All complete in ${totalElapsedTime.toFixed(
        1
    )} seconds.\nSuccessfully processed: ${successCount} entr${
        successCount === 1 ? "y" : "ies"
    }.`;
    if (failCount > 0) {
        summaryMessage += `\nFailed or no tags added for: ${failCount} entr${
            failCount === 1 ? "y" : "ies"
        }.`;
    }
    if (
        totalEntries > 0 &&
        successCount === 0 &&
        failCount === totalEntries
    ) {
        summaryMessage = `Autotag All (took ${totalElapsedTime.toFixed(
            1
        )}s): All entries failed or had no new tags to add.`;
    } else if (totalEntries === 0) {
        summaryMessage = "No visible entries were processed.";
    }
    showConfirmationModal(summaryMessage, [{ text: "OK" }]);
}

export function filterEntries(query) {
    if (!state.mainContentAreaElement || !state.searchInput) {
        console.warn(
            "filterEntries called but state.mainContentAreaElement or state.searchInput is not yet available."
        );
        return;
    }

    const entries =
        state.mainContentAreaElement.querySelectorAll("dataset-entry");
    query = query.trim().toLowerCase();

    if (query === "") {
        state.globalParsedSearchTerms = [];
        state.globalSearchTermColors = {};
    } else {
        state.globalParsedSearchTerms = getQueryLeafTerms(query);
        state.globalSearchTermColors = {};

        for (const term of state.globalParsedSearchTerms) {
            state.globalSearchTermColors[term] = getTagColor(term);
        }
    }

    for (const entry of entries) {
        const tags = entry.getNormalizedTags();
        let match =
            query === "" ? true : evaluateExpression(query, tags);

        entry.style.display = match ? "" : "none";

        if (match) {
            if (state.globalParsedSearchTerms.length > 0) {
                entry.applyTagHighlighting(
                    state.globalParsedSearchTerms,
                    state.globalSearchTermColors
                );
            } else {
                entry.clearTagHighlighting();
            }
        } else {
            entry.clearTagHighlighting();
        }
    }

    if (query === "") {
        for (const entry of entries) {
            entry.clearTagHighlighting();
        }
    }
    checkDropHintVisibility();
}

export function logToConsole(
    message,
    type = "info",
    isPreformatted = false
) {
    if (!state.consoleOutputElement) return;

    const messageDiv = document.createElement("div");
    messageDiv.classList.add("console-message", type);

    if (typeof message === "object") {
        try {
            message = JSON.stringify(message, null, 2);
            isPreformatted = true;
        } catch (e) {
            message = String(message);
        }
    } else {
        message = String(message);
    }

    if (isPreformatted) {
        const pre = document.createElement("pre");
        pre.textContent = message;
        messageDiv.appendChild(pre);
    } else {
        messageDiv.textContent = message;
    }

    state.consoleOutputElement.appendChild(messageDiv);
    state.consoleOutputElement.scrollTop =
        state.consoleOutputElement.scrollHeight;
}

function toggleDevConsole(focusInput = true) {
    if (!state.devConsoleElement || !state.mainView) return;

    state.isConsoleVisible = !state.isConsoleVisible;
    if (state.isConsoleVisible) {
        // Ensure state.mainView is the flex container for the console
        const consoleParent = state.devConsoleElement.parentElement;
        if (
            consoleParent !== state.mainView &&
            state.mainView.contains(state.devConsoleElement)
        ) {
            // This case should ideally not happen if HTML structure is correct
            console.warn(
                "Developer console is not a direct child of main-view. Layout might be unexpected."
            );
        } else if (consoleParent !== state.mainView) {
            // If console is elsewhere, this logic might need adjustment or be removed
            // For now, assuming it's meant to be part of state.mainView's flex layout
        }

        const mainViewHeight = state.mainView.clientHeight;
        const consoleHeight = Math.min(
            mainViewHeight * (state.CONSOLE_MAX_HEIGHT_PERCENT / 100),
            300
        );
        state.devConsoleElement.style.maxHeight = `${consoleHeight}px`;
        state.devConsoleElement.classList.add("visible");

        if (state.consoleCodeMirrorInstance && focusInput) {
            state.consoleCodeMirrorInstance.focus();
            state.consoleCodeMirrorInstance.refresh();
        }

        if (
            !state.hasShownConsoleWelcomeMessage &&
            state.consoleCodeMirrorInstance &&
            state.consoleCodeMirrorInstance.getValue().trim() === ""
        ) {
            logToConsole(
                "Console opened. Type /help or JS code. Ctrl+Space for hints. Up/Down for history.",
                "info"
            );
            state.hasShownConsoleWelcomeMessage = true;
        }
    } else {
        state.devConsoleElement.style.maxHeight = "0";
        state.devConsoleElement.classList.remove("visible");

        if (state.consoleCodeMirrorInstance) {
            state.consoleCodeMirrorInstance.getInputField().blur();
        }
    }

    // Refresh CodeMirror after transition if it became visible
    // and ensure focus if requested.
    setTimeout(() => {
        if (state.isConsoleVisible && state.consoleCodeMirrorInstance) {
            state.consoleCodeMirrorInstance.refresh();
            if (
                focusInput &&
                document.activeElement !==
                    state.consoleCodeMirrorInstance.getInputField()
            ) {
                state.consoleCodeMirrorInstance.focus();
            }
        }
    }, 310); // Slightly after transition duration
}

function processConsoleInput(inputValue) {
    if (inputValue.startsWith("/")) {
        const parts =
            inputValue.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        if (parts.length === 0) return;

        const commandName = parts[0].substring(1).toLowerCase();
        const args = parts.map((p) =>
            p.startsWith('"') && p.endsWith('"')
                ? p.slice(1, -1)
                : p
        );

        const commandObject = slashCommands[commandName];
        if (
            commandObject &&
            typeof commandObject.func === "function"
        ) {
            try {
                const result = commandObject.func(args);
                if (result !== undefined) {
                    logToConsole(
                        result,
                        "success",
                        typeof result === "object" ||
                            (typeof result === "string" &&
                                result.includes("\n"))
                    );
                }
            } catch (e) {
                logToConsole(
                    `Error executing command /${commandName}: ${e.message}`,
                    "error"
                );
                console.error(`Command /${commandName} error:`, e);
            }
        } else {
            logToConsole(
                `Unknown command: ${parts[0]}. Type /help for available commands.`,
                "error"
            );
        }
    } else {
        try {
            const result = (function (api) {
                const apiKeys = Object.keys(api);

                const P = new Proxy(api, {
                    get(target, prop, receiver) {
                        if (apiKeys.includes(prop))
                            return target[prop];
                        if (prop in window) {
                            if (typeof window[prop] === "function")
                                return window[prop].bind(window);
                            return window[prop];
                        }
                        return undefined;
                    },
                });

                return eval.call(P, `with(this) { ${inputValue} }`);
            })(opentaggerAPI);

            if (result !== undefined) {
                logToConsole(
                    result,
                    "info",
                    typeof result === "object" ||
                        (typeof result === "string" &&
                            result.includes("\n"))
                );
            }
        } catch (e) {
            logToConsole(String(e), "error");
            console.error("JS execution error:", e);
        }
    }
}

function showMainAppUI() {
    if (state.splashScreenElement) {
        state.splashScreenElement.classList.add("hidden");
    }
    // state.appContainer is now the tab-container, it's always "loaded" after splash
    // The visibility of its content (tagging or preferences) is handled by the tab-container itself.

    checkDropHintVisibility(); // Still relevant for the tagging tab

    // Ensure elements are queried after potential tab switches or initial load
    const currentMainContentArea =
        document.getElementById("main-content-area");
    if (currentMainContentArea) {
        for (const entry of currentMainContentArea.querySelectorAll(
            "dataset-entry"
        )) {
            entry.checkGroupRequirementsAndUpdateVisuals();
        }
    }

    sfx.sfxWelcome.play();

    // If the "Tagging" tab is active and console is visible, refresh CodeMirror
    const appTabContainer = document.getElementById("app"); // This is the tab-container
    if (
        appTabContainer &&
        appTabContainer.activeTab === "tagging"
    ) {
        if (state.isConsoleVisible && state.consoleCodeMirrorInstance) {
            setTimeout(() => {
                if (state.consoleCodeMirrorInstance)
                    state.consoleCodeMirrorInstance.refresh();
            }, 50); // Delay refresh slightly
        }
    }
}

function clearWorkspaceForNewProject() {
    const groupListContainer =
        document.getElementById("tag-group-list");
    if (groupListContainer) {
        groupListContainer.innerHTML = "";
    }

    const currentMainContentArea =
        document.getElementById("main-content-area");
    if (currentMainContentArea) {
        const currentEntries =
            currentMainContentArea.querySelectorAll(
                "dataset-entry"
            );

        for (const el of currentEntries) {
            el.deleteEntry();
        }
    }

    const currentSearchInput =
        document.getElementById("search-bar");
    if (currentSearchInput) {
        currentSearchInput.value = "";
        filterEntries(""); // Make sure filterEntries uses the potentially new state.searchInput if DOM was cleared
    }

    opentaggerAPI.deselectAllEntries(true);

    checkDropHintVisibility();
    console.log("Workspace cleared for new project.");
}

document.addEventListener("DOMContentLoaded", () => {
    state.appContainer = document.getElementById("app"); // Now the tab-container
    state.splashScreenElement = document.getElementById("splash-screen");

    // These elements are inside the "tagging" tab, so they might not be immediately available
    // if another tab is active by default. Query them when needed or ensure tagging tab is default.
    state.mainView = document.getElementById("main-view");
    state.mainContentAreaElement =
        document.getElementById("main-content-area");

    if (state.mainContentAreaElement) {
        state.dropHint =
            state.mainContentAreaElement.querySelector(".drop-hint");
    } else {
        // This might happen if "preferences" tab is active first.
        // console.warn("state.mainContentAreaElement not found during DOMContentLoaded (possibly due to inactive tab).");
    }

    state.searchInput = document.getElementById("search-bar");
    state.autotagAllButton =
        document.getElementById("autotag-all-button");

    state.devConsoleElement =
        document.getElementById("developer-console");
    state.consoleOutputElement =
        document.getElementById("console-output");
    const consoleTextArea =
        document.getElementById("console-input");

    const preferencesPanel =
        document.getElementById("preferences-panel");
    if (preferencesPanel) {
        generatePreferencesUI(preferences, preferencesPanel);
    } else {
        console.error("Preferences panel element not found.");
    }

    state.globalTagAutocompleteDropdown = document.getElementById(
        "tag-autocomplete-dropdown"
    );
    if (!state.globalTagAutocompleteDropdown) {
        console.error(
            "AutocompleteDropdown element (#tag-autocomplete-dropdown) not found in DOM!"
        );
    }

    loadBooruTags().then((tags) => {
        if (tags.length > 0) {
            console.log("Booru tags ready for autocomplete.");
        } else {
            console.warn(
                "Booru tags could not be loaded. Tag autocomplete will not be available."
            );
        }
    });

    if (consoleTextArea && typeof CodeMirror !== "undefined") {
        state.consoleCodeMirrorInstance = CodeMirror.fromTextArea(
            consoleTextArea,
            {
                mode: "javascript",
                theme: "neat",
                lineWrapping: true,
                autoCloseBrackets: true,
                matchBrackets: true,
                extraKeys: {
                    Enter: (cm) => {
                        const inputValue = cm.getValue().trim();
                        if (inputValue === "") return;

                        logToConsole(`> ${inputValue}`, "command");
                        cm.setValue("");
                        processConsoleInput(inputValue);

                        if (
                            state.consoleHistory.length === 0 ||
                            state.consoleHistory[
                                state.consoleHistory.length - 1
                            ] !== inputValue
                        ) {
                            state.consoleHistory.push(inputValue);
                        }
                        if (state.consoleHistory.length > 50)
                            state.consoleHistory.shift();
                        state.consoleHistoryIndex = state.consoleHistory.length;
                        state.currentConsoleInputBuffer = "";
                    },
                    Up: (cm) => {
                        if (
                            state.consoleHistoryIndex ===
                                state.consoleHistory.length &&
                            cm.getValue() !== ""
                        ) {
                            state.currentConsoleInputBuffer =
                                cm.getValue();
                        }
                        if (state.consoleHistoryIndex > 0) {
                            state.consoleHistoryIndex--;
                            cm.setValue(
                                state.consoleHistory[state.consoleHistoryIndex]
                            );
                            cm.setCursor(cm.lineCount(), 0);
                        }
                        return true;
                    },
                    Down: (cm) => {
                        if (
                            state.consoleHistoryIndex <
                            state.consoleHistory.length - 1
                        ) {
                            state.consoleHistoryIndex++;
                            cm.setValue(
                                state.consoleHistory[state.consoleHistoryIndex]
                            );
                            cm.setCursor(cm.lineCount(), 0);
                        } else if (
                            state.consoleHistoryIndex ===
                            state.consoleHistory.length - 1
                        ) {
                            state.consoleHistoryIndex++;
                            cm.setValue(state.currentConsoleInputBuffer);
                            state.currentConsoleInputBuffer = "";
                            cm.setCursor(cm.lineCount(), 0);
                        }
                        return true;
                    },
                    Esc: (cm) => {
                        if (state.isConsoleVisible)
                            toggleDevConsole(false);
                    },
                    "Ctrl-Space": "autocomplete",
                },
                hintOptions: {
                    hint: customCodeMirrorHints,
                    completeSingle: false,
                },
            }
        );

        state.consoleCodeMirrorInstance.on(
            "inputRead",
            function (cm, event) {
                if (
                    cm.state.completionActive ||
                    !event ||
                    event.origin === "+delete" ||
                    event.origin === "paste" ||
                    /[ ;\),\(\]\}\[\{]/.test(event.text[0]) ||
                    event.key === "Enter" ||
                    event.key === "Escape" ||
                    (event.key && event.key.includes("Arrow"))
                ) {
                    return;
                }
                CodeMirror.commands.autocomplete(cm, null, {
                    completeSingle: false,
                });
            }
        );
    } else if (!consoleTextArea) {
        console.warn(
            "Console textarea (#console-input) not found for CodeMirror."
        );
    } else if (typeof CodeMirror === "undefined") {
        console.warn(
            "CodeMirror library not loaded. Console will use basic textarea."
        );
        if (consoleTextArea) {
            consoleTextArea.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const inputValue = consoleTextArea.value.trim();
                    if (inputValue === "") return;
                    logToConsole(`> ${inputValue}`, "command");
                    processConsoleInput(inputValue);
                    consoleTextArea.value = "";
                } else if (e.key === "Escape") {
                    if (state.isConsoleVisible) toggleDevConsole(false);
                }
            });
        }
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "F1") {
            event.preventDefault();
            if (
                state.splashScreenElement &&
                !state.splashScreenElement.classList.contains("hidden")
            ) {
                return;
            }

            // Check if focus is inside an input field that is NOT the console's CodeMirror instance
            const targetTagName =
                event.target.tagName.toLowerCase();
            const isGenericInput =
                targetTagName === "input" ||
                targetTagName === "textarea" ||
                event.target.isContentEditable;
            const isConsoleInput =
                state.consoleCodeMirrorInstance &&
                event.target ===
                    state.consoleCodeMirrorInstance.getInputField();

            if (isGenericInput && !isConsoleInput) {
                return; // Don't toggle console if focus is in a regular input/textarea
            }
            toggleDevConsole();
        }
    });

    if (
        window.location.origin &&
        window.location.origin !== "null"
    ) {
        console.log("Frontend Origin:", window.location.origin);
    } else {
        console.warn(
            "Frontend Origin is 'null' or not available (likely file:// URL). Some fetch operations to localhost might be restricted by CORS if backend isn't configured for 'null' origin."
        );
    }

    const groupListContainer =
        document.getElementById("tag-group-list");
    const addGroupButton = document.getElementById("btn-add-group");
    const projectFileInput =
        document.getElementById("project-file-input");
    const datasetZipInput =
        document.getElementById("dataset-zip-input");

    const splashNewProjectBtn =
        document.getElementById("splash-new-project");
    const splashOpenProjectBtn = document.getElementById(
        "splash-open-project"
    );

    if (splashNewProjectBtn) {
        splashNewProjectBtn.addEventListener("click", () => {
            clearWorkspaceForNewProject();
            showMainAppUI();
        });
    }
    if (splashOpenProjectBtn) {
        splashOpenProjectBtn.addEventListener("click", () => {
            if (projectFileInput) projectFileInput.click();
        });
    }

    if (projectFileInput) {
        projectFileInput.addEventListener(
            "change",
            handleProjectFileSelect
        );
    }
    if (datasetZipInput) {
        datasetZipInput.addEventListener(
            "change",
            handleDatasetZipSelect
        );
    }

    if (state.autotagAllButton) {
        state.autotagAllButton.addEventListener(
            "click",
            handleAutotagAllClick
        );
    }

    if (state.searchInput) {
        const debouncedFilter = debounce(filterEntries, 300);
        state.searchInput.addEventListener("input", () =>
            debouncedFilter(state.searchInput.value)
        );
    }

    // Drag and drop for main-view (which is inside tagging-panel)
    // This needs to be attached to state.mainView if it exists, or its parent panel.
    const taggingPanel = document.getElementById("tagging-panel");
    if (taggingPanel) {
        // Attach to the panel that contains state.mainView
        taggingPanel.addEventListener("dragenter", (e) => {
            if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                e.stopPropagation();
                // Add visual cue to the panel or a specific drop zone within it
                if (state.mainView) state.mainView.classList.add("drag-over");
                else taggingPanel.classList.add("drag-over"); // Fallback
                e.dataTransfer.dropEffect = "copy";
            }
        });
        taggingPanel.addEventListener("dragover", (e) => {
            if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
            } else {
                e.dataTransfer.dropEffect = "none";
            }
        });
        taggingPanel.addEventListener("dragleave", (e) => {
            const currentTarget = state.mainView || taggingPanel;
            if (
                !currentTarget.contains(e.relatedTarget) ||
                e.target === currentTarget
            ) {
                currentTarget.classList.remove("drag-over");
            }
        });
        taggingPanel.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const currentTarget = state.mainView || taggingPanel;
            currentTarget.classList.remove("drag-over");

            if (
                e.dataTransfer.files?.length > 0 &&
                !state.draggedElement // Ensure not a tag drag from within the app
            ) {
                const droppedFile = e.dataTransfer.files[0];
                if (
                    droppedFile &&
                    droppedFile.name.endsWith(
                        state.PROJECT_FILE_EXTENSION
                    )
                ) {
                    handleProjectFileSelect({
                        target: { files: [droppedFile] },
                    });
                } else if (
                    droppedFile &&
                    droppedFile.name.endsWith(".zip")
                ) {
                    handleDatasetZipSelect({
                        target: { files: [droppedFile] },
                    });
                } else {
                    handleFiles(e.dataTransfer.files);
                }
            } else {
                console.log(
                    "Drop event on tagging panel ignored (not files or handled by child)."
                );
            }
        });
    }

    function handleFiles(files) {
        if (!state.mainContentAreaElement || !state.searchInput) {
            // Try to get them again if they were not available initially
            if (!state.mainContentAreaElement)
                state.mainContentAreaElement =
                    document.getElementById("main-content-area");
            if (!state.searchInput)
                state.searchInput = document.getElementById("search-bar");
            if (!state.mainContentAreaElement || !state.searchInput) {
                console.error(
                    "Cannot handle files: main content area or search input not found."
                );
                showConfirmationModal(
                    "Error: UI components for tagging are not ready. Cannot add files.",
                    [{ text: "OK" }]
                );
                return;
            }
        }
        for (const file of files) {
            if (file.type.startsWith("image/")) {
                const blobUrl = URL.createObjectURL(file);
                const entry =
                    document.createElement("dataset-entry");
                entry.setImage(blobUrl, file);

                let referenceNode = state.dropHint?.isConnected
                    ? state.dropHint
                    : state.mainContentAreaElement.firstChild; // Fallback if state.dropHint is gone or not found

                state.mainContentAreaElement.insertBefore(
                    entry,
                    referenceNode
                );

                if (state.searchInput.value.trim() !== "") {
                    const currentQuery = state.searchInput.value
                        .trim()
                        .toLowerCase();
                    const tags = entry.getNormalizedTags();
                    const isMatch = evaluateExpression(
                        currentQuery,
                        tags
                    );
                    entry.style.display = isMatch ? "" : "none";
                    if (
                        isMatch &&
                        state.globalParsedSearchTerms.length > 0
                    ) {
                        entry.applyTagHighlighting(
                            state.globalParsedSearchTerms,
                            state.globalSearchTermColors
                        );
                    } else {
                        entry.clearTagHighlighting();
                    }
                } else {
                    entry.clearTagHighlighting();
                }
            } else if (file.name.endsWith(state.PROJECT_FILE_EXTENSION)) {
                handleProjectFileSelect({
                    target: { files: [file] },
                });
            } else if (file.name.endsWith(".zip")) {
                handleDatasetZipSelect({
                    target: { files: [file] },
                });
            } else {
                console.warn(
                    `Skipped non-image file: ${file.name}`
                );
            }
        }
        checkDropHintVisibility();
    }

    if (addGroupButton) {
        addGroupButton.addEventListener("click", () => {
            const cat = document.createElement("tag-group");
            cat.setAttribute("group-name", "New Cat");
            if (groupListContainer)
                groupListContainer.appendChild(cat);
            const span = cat.querySelector(".group-name");
            if (span) {
                requestAnimationFrame(() => {
                    span.focus();

                    window.getSelection().selectAllChildren(span);
                });
            }
        });
    }

    const menuBarButtons =
        document.querySelectorAll("#menu-bar button");

    for (const button of menuBarButtons) {
        button.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (
                state.splashScreenElement &&
                !state.splashScreenElement.classList.contains("hidden")
            ) {
                const buttonAction = button.textContent
                    .trim()
                    .toLowerCase();

                // If splash screen is visible, only allow File > New/Load actions
                // or actions that implicitly hide the splash screen.
                // For now, let's assume most menu actions should proceed to show the main app.
                // A more refined logic could be added here if specific menus should be disabled.
                if (
                    buttonAction !== "file" &&
                    buttonAction !== "help"
                ) {
                    // Example: allow File and Help
                    // Potentially show a message or do nothing if other menus are clicked on splash
                    // For now, we'll let it try to open the menu, which might trigger showMainAppUI
                }
            }

            if (
                state.currentContextMenu &&
                state.currentContextMenu.classList.contains("visible") &&
                state.currentContextMenu._ownerButton === button
            ) {
                state.currentContextMenu.hide();
                return;
            }

            const type = button.textContent.trim().toLowerCase();
            let items = [];
            switch (type) {
                case "file":
                    items = [
                        {
                            label: "New Project",
                            callback: () => {
                                clearWorkspaceForNewProject();
                                showMainAppUI(); // Ensure main app is visible
                                // If tab-container is used, ensure 'tagging' tab is active
                                const appTabs =
                                    document.getElementById("app");
                                if (
                                    appTabs &&
                                    typeof appTabs.activateTab ===
                                        "function"
                                ) {
                                    appTabs.activateTab(
                                        appTabs.sanitizeId(
                                            "tagging"
                                        )
                                    );
                                }
                            },
                            dataAction: "new-project",
                        },
                        { type: "divider" },
                        {
                            label: "Save Project",
                            callback: () => {
                                if (
                                    state.splashScreenElement &&
                                    !state.splashScreenElement.classList.contains(
                                        "hidden"
                                    )
                                ) {
                                    showMainAppUI();
                                }
                                saveProject();
                            },
                            dataAction: "save-project",
                        },
                        {
                            label: "Load Project...",
                            callback: () => {
                                if (projectFileInput)
                                    projectFileInput.click();
                                // showMainAppUI will be called after successful load
                            },
                        },
                        { type: "divider" },

                        {
                            label: "Import Dataset (ZIP)...",
                            callback: () => {
                                if (datasetZipInput)
                                    datasetZipInput.click();
                                // showMainAppUI will be called after successful import
                            },
                            dataAction: "import-dataset-zip",
                        },
                        {
                            label: "Export Dataset (ZIP)",
                            dataAction: "export",
                            callback: () => {
                                if (
                                    state.splashScreenElement &&
                                    !state.splashScreenElement.classList.contains(
                                        "hidden"
                                    )
                                ) {
                                    showMainAppUI();
                                }
                                confirmAndExportDataset();
                            },
                        },
                    ];
                    break;
                case "edit":
                    items = [
                        { label: "Undo (NYI)", disabled: true },
                        { label: "Redo (NYI)", disabled: true },
                        { type: "divider" },
                        {
                            label: "Clear Search",
                            callback: () => {
                                if (state.searchInput)
                                    state.searchInput.value = "";
                                filterEntries("");
                            },
                            disabled: () =>
                                !state.searchInput ||
                                document.getElementById("app")
                                    ?.activeTab !== "tagging",
                        },
                        { type: "divider" },
                        {
                            label: "Select All Visible",
                            callback: () =>
                                opentaggerAPI.selectEntries(
                                    "",
                                    false
                                ),
                            disabled: () =>
                                document.getElementById("app")
                                    ?.activeTab !== "tagging",
                        },
                        {
                            label: "Deselect All",
                            callback: () =>
                                opentaggerAPI.deselectAllEntries(),
                            disabled: () =>
                                document.getElementById("app")
                                    ?.activeTab !== "tagging",
                        },
                        // { type: "divider" },
                        // { label: "Preferences...", callback: () => {
                        //     const appTabs = document.getElementById('app');
                        //     if (appTabs && typeof appTabs.activateTab === 'function') {
                        //        appTabs.activateTab(appTabs.sanitizeId('preferences'));
                        //     }
                        //     showMainAppUI(); // Ensure app is visible if coming from splash
                        // }},
                    ];
                    break;
                case "view":
                    items = [
                        { label: "Zoom In (NYI)", disabled: true },
                        { label: "Zoom Out (NYI)", disabled: true },
                        { type: "divider" },
                        {
                            label: "Re-check All Requirements",
                            callback: () => {
                                const currentMainContentArea =
                                    document.getElementById(
                                        "main-content-area"
                                    );
                                if (!currentMainContentArea) return;

                                for (const entry of currentMainContentArea.querySelectorAll(
                                    "dataset-entry"
                                )) {
                                    entry.checkGroupRequirementsAndUpdateVisuals();
                                }
                                console.log(
                                    "Manually re-checked all entry requirements."
                                );
                            },
                            disabled: () =>
                                document.getElementById("app")
                                    ?.activeTab !== "tagging",
                        },
                    ];
                    break;
                case "help":
                    items = [
                        { label: "About (NYI)", disabled: true },
                    ];
                    break;
                default:
                    return; // Don't create a menu if button type is unknown
            }
            if (items.length > 0) createContextMenu(items, button);
        });
    }

    document.addEventListener("contextmenu", (e) => {
        state.currentContextMenu?.hide();

        if (
            state.splashScreenElement &&
            !state.splashScreenElement.classList.contains("hidden")
        ) {
            const onSplash = e.target.closest("#splash-screen");
            if (!onSplash) {
                // If context menu is outside splash, prevent it
                e.preventDefault();
            }
            // Allow native context menu on splash screen elements themselves
            return;
        }

        // If the context menu is on a tab button, let the tab-container handle it or allow native.
        if (
            e.target
                .closest("tab-container")
                ?.shadowRoot.contains(e.target) &&
            e.target.closest('[role="tablist"]')
        ) {
            return;
        }

        if (
            e.target.closest(
                "dataset-tag, dataset-entry, tag-group"
            )
        ) {
            // These elements have their own context menus
            return;
        }
        if (
            state.globalTagAutocompleteDropdown &&
            state.globalTagAutocompleteDropdown.contains(e.target)
        ) {
            // Allow context menu on the autocomplete dropdown itself if needed (currently not)
            // Or prevent default here: e.preventDefault();
            return;
        }

        const targetTagName = e.target.tagName.toLowerCase();
        if (
            e.target.closest('span[contenteditable="true"]') ||
            targetTagName === "input" ||
            targetTagName === "textarea" ||
            (state.consoleCodeMirrorInstance &&
                state.consoleCodeMirrorInstance
                    .getWrapperElement()
                    .contains(e.target))
        ) {
            // Allow native context menu for text editing areas
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const appTabs = document.getElementById("app");
        const isTaggingTabActive =
            appTabs && appTabs.activeTab === "tagging";

        const generalItems = [
            {
                label: "Add Group", // Changed from "Add Tags"
                callback: () => {
                    if (addGroupButton) addGroupButton.click();
                },
                disabled: !isTaggingTabActive,
            },
            { type: "divider" },
            {
                label: "Autotag All Visible",
                callback: () => handleAutotagAllClick(),
                disabled: !isTaggingTabActive,
            },
            {
                label: "Re-check All Requirements",
                callback: () => {
                    const currentMainContentArea =
                        document.getElementById(
                            "main-content-area"
                        );
                    if (!currentMainContentArea) return;

                    for (const entry of currentMainContentArea.querySelectorAll(
                        "dataset-entry"
                    )) {
                        entry.checkGroupRequirementsAndUpdateVisuals();
                    }
                },
                disabled: !isTaggingTabActive,
            },
            { type: "divider" },
            {
                label: "Select All Visible",
                callback: () =>
                    opentaggerAPI.selectEntries("", false),
                disabled: !isTaggingTabActive,
            },
            {
                label: "Deselect All",
                callback: () => opentaggerAPI.deselectAllEntries(),
                disabled: !isTaggingTabActive,
            },
        ];
        createContextMenu(generalItems, e);
    });

    document.addEventListener("group-min-tags-changed", () => {
        const currentMainContentArea =
            document.getElementById("main-content-area");
        if (!currentMainContentArea) return;

        for (const entry of currentMainContentArea.querySelectorAll(
            "dataset-entry"
        )) {
            entry.checkGroupRequirementsAndUpdateVisuals();
        }
    });

    // Initial check for drop hint visibility if app is already "loaded" (splash hidden)
    // This is less relevant now as tab-container handles initial display.
    // The checkDropHintVisibility will be called by showMainAppUI or when files are added.
    if (
        state.splashScreenElement &&
        state.splashScreenElement.classList.contains("hidden")
    ) {
        checkDropHintVisibility();
    }

    // Observe mainContentArea for changes to update state.dropHint and entry requirements
    // This needs to be robust if state.mainContentAreaElement is initially null (e.g. preferences tab active)
    const setupMainContentObserver = () => {
        if (!state.mainContentAreaElement) {
            state.mainContentAreaElement =
                document.getElementById("main-content-area");
        }
        if (state.mainContentAreaElement) {
            const mainContentObserver = new MutationObserver(
                (mutationsList) => {
                    let listChanged = false;
                    for (const mutation of mutationsList) {
                        if (mutation.type === "childList") {
                            const addedEntries = Array.from(
                                mutation.addedNodes
                            ).filter(
                                (node) =>
                                    node.tagName === "DATASET-ENTRY"
                            );
                            const removedEntries = Array.from(
                                mutation.removedNodes
                            ).filter(
                                (node) =>
                                    node.tagName === "DATASET-ENTRY"
                            );

                            if (
                                addedEntries.length > 0 ||
                                removedEntries.length > 0
                            ) {
                                listChanged = true;

                                for (const entry of addedEntries) {
                                    requestAnimationFrame(() =>
                                        entry.checkGroupRequirementsAndUpdateVisuals()
                                    );
                                }
                                if (
                                    state.globalLastClickedEntryForShiftSelect &&
                                    removedEntries.includes(
                                        state.globalLastClickedEntryForShiftSelect
                                    )
                                ) {
                                    state.globalLastClickedEntryForShiftSelect =
                                        null;
                                }
                                break;
                            }
                        }
                    }
                    if (listChanged) checkDropHintVisibility();
                }
            );
            mainContentObserver.observe(state.mainContentAreaElement, {
                childList: true,
            });

            state.mainContentAreaElement.addEventListener(
                "entry-deleted",
                () => checkDropHintVisibility()
            );
            // Initial check after observer is set up
            checkDropHintVisibility();
            for (const entry of state.mainContentAreaElement.querySelectorAll(
                "dataset-entry"
            )) {
                entry.checkGroupRequirementsAndUpdateVisuals();
            }
        } else {
            console.warn(
                "Main content area not found for observer setup."
            );
        }
    };

    // If the app container is a tab-container, set up observer when tagging tab becomes active
    if (state.appContainer && state.appContainer.tagName === "TAB-CONTAINER") {
        if (state.appContainer.activeTab === "tagging") {
            setupMainContentObserver();
        }
        state.appContainer.addEventListener("tab-change", (e) => {
            if (e.detail.activeTabId === "tagging") {
                // Ensure elements are re-queried if they weren't available before
                if (!state.mainContentAreaElement)
                    state.mainContentAreaElement =
                        document.getElementById(
                            "main-content-area"
                        );
                if (!state.mainView)
                    state.mainView = document.getElementById("main-view");
                if (!state.searchInput)
                    state.searchInput =
                        document.getElementById("search-bar");
                if (!state.autotagAllButton)
                    state.autotagAllButton =
                        document.getElementById(
                            "autotag-all-button"
                        );
                if (!state.devConsoleElement)
                    state.devConsoleElement =
                        document.getElementById(
                            "developer-console"
                        );
                if (!state.consoleOutputElement)
                    state.consoleOutputElement =
                        document.getElementById("console-output");
                if (
                    state.mainContentAreaElement &&
                    !state.mainContentAreaElement.hasAttribute(
                        "data-observer-set"
                    )
                ) {
                    setupMainContentObserver();
                    state.mainContentAreaElement.setAttribute(
                        "data-observer-set",
                        "true"
                    );
                } else if (state.mainContentAreaElement) {
                    // Refresh visibility and requirements if tab is re-activated
                    checkDropHintVisibility();
                    for (const entry of state.mainContentAreaElement.querySelectorAll(
                        "dataset-entry"
                    )) {
                        entry.checkGroupRequirementsAndUpdateVisuals();
                    }
                }
                // Refresh CodeMirror if console is visible
                if (state.isConsoleVisible && state.consoleCodeMirrorInstance) {
                    setTimeout(() => {
                        if (state.consoleCodeMirrorInstance)
                            state.consoleCodeMirrorInstance.refresh();
                    }, 50); // Delay refresh slightly
                }
            }
        });
    } else {
        // Fallback for non-tab-container structure (original behavior)
        setupMainContentObserver();
    }
}); // End of DOMContentLoaded

async function saveProject() {
    console.log("Starting project save...");
    showConfirmationModal("Saving project...", []);

    const groups = [];

    for (const catElement of document.querySelectorAll(
        "#tag-group-list tag-group"
    )) {
        groups.push({
            name:
                catElement.getAttribute("group-name") ||
                "Unnamed Group",
            minimumTags: catElement.minimumTags,
            tags: catElement.getGroupTags(),
        });
    }

    const entries = [];
    const currentMainContentArea =
        document.getElementById("main-content-area"); // Re-query in case of tab changes
    if (!currentMainContentArea) {
        console.error(
            "Cannot save project: state.mainContentAreaElement element not found."
        );
        document.querySelector(".modal-overlay")?.remove();
        showConfirmationModal(
            "Error saving project: UI elements missing.",
            [{ text: "OK" }]
        );
        return;
    }
    const entryElements =
        currentMainContentArea.querySelectorAll("dataset-entry");
    const imageSavePromises = [];
    const zip = new JSZip();
    const imagesFolder = zip.folder("images");

    const usedImageNames = new Set();

    for (const entryElement of entryElements) {
        const originalName =
            entryElement.originalImageName ||
            `entry_${Date.now()}.png`;

        let safeName = sanitizeFilename(originalName);
        let uniqueName = safeName;
        let counter = 1;
        while (usedImageNames.has(uniqueName.toLowerCase())) {
            const extension = uniqueName.includes(".")
                ? uniqueName.substring(uniqueName.lastIndexOf("."))
                : "";
            const base = uniqueName.includes(".")
                ? uniqueName.substring(
                      0,
                      uniqueName.lastIndexOf(".")
                  )
                : uniqueName;

            const baseWithoutCounter = base.replace(/_\d+$/, "");
            uniqueName = `${baseWithoutCounter}_${counter++}${extension}`;
        }
        usedImageNames.add(uniqueName.toLowerCase());

        entries.push({
            imageName: uniqueName,
            tags: entryElement.getTags(),
        });

        imageSavePromises.push(
            entryElement
                .getImageData()
                .then((imageData) => {
                    if (imageData) {
                        imagesFolder.file(uniqueName, imageData, {
                            binary: true,
                        });
                    } else {
                        console.warn(
                            `Could not get image data for entry originally named: ${originalName}. Skipping image file.`
                        );

                        throw new Error(
                            `Missing image data for ${originalName}`
                        );
                    }
                })
                .catch((err) => {
                    console.error(
                        `Error processing image for ${originalName}:`,
                        err
                    );
                    return {
                        status: "rejected",
                        reason: `Failed to process image: ${originalName}`,
                    };
                })
        );
    }

    const projectData = {
        version: 1,
        groups: groups,
        entries: entries,
    };
    zip.file("project.json", JSON.stringify(projectData, null, 2));

    const results = await Promise.allSettled(imageSavePromises);
    document.querySelector(".modal-overlay")?.remove();

    const failedImages = results.filter(
        (r) => r.status === "rejected"
    );
    if (failedImages.length > 0) {
        console.error(
            `${failedImages.length} image(s) failed to save.`
        );
        showConfirmationModal(
            `Warning: ${failedImages.length} image(s) could not be read or saved. The project file might be incomplete. Save anyway?`,
            [
                {
                    text: "Save Anyway",
                    onClick: () =>
                        generateAndDownloadZip(zip, "Save Project"),
                    class: "modal-button-confirm",
                },
                {
                    text: "Cancel",
                    onClick: () =>
                        console.log(
                            "Project save cancelled due to image errors."
                        ),
                    class: "modal-button-cancel",
                },
            ]
        );
    } else {
        generateAndDownloadZip(zip, "Save Project");
    }
}

async function generateAndDownloadZip(
    zip,
    menuActionText = "Processing..."
) {
    const menuSave = document.querySelector(
        'menu-item[data-action="save-project"]'
    );
    const menuExport = document.querySelector(
        'menu-item[data-action="export"]'
    );
    const targetMenuItem = menuSave || menuExport;
    const originalText =
        targetMenuItem?.textContent || menuActionText;

    if (targetMenuItem) {
        targetMenuItem.textContent = "Zipping...";
        targetMenuItem.style.pointerEvents = "none";
    } else {
        showConfirmationModal("Zipping project...", []);
    }

    try {
        const blob = await zip.generateAsync(
            {
                type: "blob",
                compression: "DEFLATE",
                compressionOptions: { level: 6 },
            },
            (metadata) => {
                const progressText = `Zipping... (${metadata.percent.toFixed(
                    0
                )}%)`;
                if (targetMenuItem)
                    targetMenuItem.textContent = progressText;
                else {
                    const modalMsg = document.querySelector(
                        ".modal-overlay .modal-message"
                    );
                    if (modalMsg)
                        modalMsg.textContent = progressText;
                }
            }
        );
        document.querySelector(".modal-overlay")?.remove();
        const filename = menuSave
            ? `lora_project_${Date.now()}${state.PROJECT_FILE_EXTENSION}`
            : "lora_dataset_export.zip";
        saveAs(blob, filename);
        console.log("Project saved successfully.");
        showConfirmationModal(
            menuSave
                ? "Project saved successfully!"
                : "Dataset exported successfully!",
            [{ text: "OK" }]
        );
    } catch (err) {
        console.error("Error generating ZIP:", err);
        document.querySelector(".modal-overlay")?.remove();
        showConfirmationModal(
            "Error generating file. Check console for details.",
            [{ text: "OK" }]
        );
    } finally {
        if (targetMenuItem) {
            targetMenuItem.textContent = originalText;
            targetMenuItem.style.pointerEvents = "auto";
        }
    }
}

function handleProjectFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    event.target.value = null;

    if (!file.name.endsWith(state.PROJECT_FILE_EXTENSION)) {
        showConfirmationModal(
            `Invalid file type. Please select a ${state.PROJECT_FILE_EXTENSION} file.`,
            [{ text: "OK" }]
        );
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const zipData = e.target.result;
            await loadProjectFromZip(zipData);
            showMainAppUI();
            // Ensure tagging tab is active after loading a project
            const appTabs = document.getElementById("app");
            if (
                appTabs &&
                typeof appTabs.activateTab === "function"
            ) {
                appTabs.activateTab(appTabs.sanitizeId("tagging"));
            }
        } catch (error) {
            console.error("Error loading project file:", error);
            document.querySelector(".modal-overlay")?.remove();
            showConfirmationModal(
                `Error loading project: ${error.message}. Check console for details.`,
                [{ text: "OK" }]
            );
        }
    };
    reader.onerror = (e) => {
        console.error("FileReader error:", e);
        showConfirmationModal("Error reading project file.", [
            { text: "OK" },
        ]);
    };
    reader.readAsArrayBuffer(file);
}

async function loadProjectFromZip(zipData) {
    console.log("Loading project from zip data...");
    showConfirmationModal("Loading project...", []);

    let zip;
    try {
        zip = await JSZip.loadAsync(zipData);
    } catch (e) {
        console.error("Failed to load ZIP data:", e);
        throw new Error(
            "Invalid or corrupted project file (could not read as ZIP)."
        );
    }

    const projectFile = zip.file("project.json");
    if (!projectFile) {
        throw new Error(
            "Invalid project file: 'project.json' not found."
        );
    }
    let projectJson;
    try {
        projectJson = await projectFile.async("string");
    } catch (e) {
        console.error("Failed to read project.json:", e);
        throw new Error(
            "Could not read 'project.json' from the file."
        );
    }
    let projectData;
    try {
        projectData = JSON.parse(projectJson);
    } catch (e) {
        console.error("Failed to parse project.json:", e);
        throw new Error(
            "Invalid project file: Could not parse 'project.json'."
        );
    }

    if (
        !projectData ||
        typeof projectData !== "object" ||
        projectData.version !== 1
    ) {
        throw new Error(
            "Invalid or unsupported project file format/version."
        );
    }
    if (
        !Array.isArray(projectData.groups) ||
        !Array.isArray(projectData.entries)
    ) {
        throw new Error(
            "Invalid project data structure (missing groups or entries array)."
        );
    }

    clearWorkspaceForNewProject();

    console.log(`Loading ${projectData.groups.length} groups...`);
    const groupListContainer =
        document.getElementById("tag-group-list");

    for (const catData of projectData.groups) {
        const groupElement = document.createElement("tag-group");
        groupElement.setAttribute(
            "group-name",
            catData.name || "Unnamed"
        );

        requestAnimationFrame(() => {
            groupElement.minimumTags = catData.minimumTags || 0;
            groupElement.setTags(catData.tags || []);
        });
        groupListContainer.appendChild(groupElement);
    }

    console.log(`Loading ${projectData.entries.length} entries...`);
    let loadedCount = 0;
    let errorCount = 0;
    const imageLoadErrors = [];

    const loadingModalMsg = document.querySelector(
        ".modal-overlay .modal-message"
    );
    if (loadingModalMsg)
        loadingModalMsg.textContent = `Loading ${projectData.entries.length} entries...`;

    const currentMainContentArea =
        document.getElementById("main-content-area"); // Re-query

    const entryCreationPromises = projectData.entries.map(
        async (entryData, index) => {
            if (
                !entryData ||
                typeof entryData.imageName !== "string"
            ) {
                console.warn(
                    `Skipping invalid entry data at index ${index}.`
                );
                imageLoadErrors.push(
                    `Invalid entry data at index ${index}.`
                );
                return null;
            }

            const imageName = entryData.imageName;
            const imageFileInZip = zip.file(`images/${imageName}`);

            if (!imageFileInZip) {
                console.warn(
                    `Image '${imageName}' not found in project zip's images/ folder. Skipping entry.`
                );
                imageLoadErrors.push(
                    `Image not found in zip: images/${imageName}`
                );
                return null;
            }

            let blobUrl;
            try {
                const imageDataBlob = await imageFileInZip.async(
                    "blob"
                );
                blobUrl = URL.createObjectURL(imageDataBlob);

                const imageFileObject = new File(
                    [imageDataBlob],
                    imageName,
                    { type: imageDataBlob.type }
                );

                const entryElement =
                    document.createElement("dataset-entry");
                entryElement.setImage(blobUrl, imageFileObject);
                return {
                    element: entryElement,
                    tags: entryData.tags || [],
                };
            } catch (err) {
                console.error(
                    `Error processing entry image '${imageName}':`,
                    err
                );
                imageLoadErrors.push(
                    `Error loading ${imageName}: ${err.message}`
                );
                if (
                    typeof blobUrl !== "undefined" &&
                    URL.revokeObjectURL
                )
                    URL.revokeObjectURL(blobUrl);
                return null;
            }
        }
    );

    const processedEntries = await Promise.all(
        entryCreationPromises
    );

    for (const [index, result] of processedEntries.entries()) {
        if (result && currentMainContentArea) {
            let referenceNode =
                state.dropHint?.isConnected &&
                state.dropHint.parentElement === currentMainContentArea
                    ? state.dropHint
                    : currentMainContentArea.firstChild; // Fallback

            currentMainContentArea.insertBefore(
                result.element,
                referenceNode
            );
            result.element.setTags(result.tags);
            loadedCount++;
            if (loadingModalMsg && index % 10 === 0) {
                loadingModalMsg.textContent = `Loading entry ${
                    index + 1
                } / ${projectData.entries.length}...`;
            }
        } else if (result && !currentMainContentArea) {
            console.error(
                "state.mainContentAreaElement not available to append loaded entry. This is unexpected."
            );
            errorCount++;
        } else if (!result) {
            errorCount++;
        }
    }

    document.querySelector(".modal-overlay")?.remove();

    let resultMessage = `Project loaded successfully. ${loadedCount} entries added.`;
    if (errorCount > 0) {
        resultMessage += ` ${errorCount} error(s) encountered (check console for details).`;
        console.error(
            "Errors during project load (image or data issues):",
            imageLoadErrors
        );
    }
    showConfirmationModal(resultMessage, [{ text: "OK" }]);
    checkDropHintVisibility();
}

async function handleDatasetZipSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    event.target.value = null;

    if (!file.name.endsWith(".zip")) {
        showConfirmationModal(
            "Invalid file type. Please select a .zip file for dataset import.",
            [{ text: "OK" }]
        );
        return;
    }

    showConfirmationModal("Importing dataset from ZIP...", []);
    console.log(`Importing dataset from: ${file.name}`);

    try {
        const zipData = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(zipData);

        const imageFiles = [];
        const textFiles = {};

        zip.forEach((relativePath, zipEntry) => {
            if (zipEntry.dir) return;

            const fileName = relativePath.substring(
                relativePath.lastIndexOf("/") + 1
            );
            const lowerFileName = fileName.toLowerCase();

            if (
                /\.(jpe?g|png|webp|gif|bmp|tiff)$/i.test(
                    lowerFileName
                )
            ) {
                imageFiles.push(zipEntry);
            } else if (lowerFileName.endsWith(".txt")) {
                const baseName = lowerFileName.substring(
                    0,
                    lowerFileName.lastIndexOf(".txt")
                );
                textFiles[baseName] = zipEntry.async("string");
            }
        });

        if (imageFiles.length === 0) {
            document.querySelector(".modal-overlay")?.remove();
            showConfirmationModal(
                "No image files found in the ZIP archive.",
                [{ text: "OK" }]
            );
            return;
        }

        const loadingModalMsg = document.querySelector(
            ".modal-overlay .modal-message"
        );
        if (loadingModalMsg)
            loadingModalMsg.textContent = `Processing ${imageFiles.length} images...`;

        let importedCount = 0;
        let errorCount = 0;
        const currentMainContentArea =
            document.getElementById("main-content-area"); // Re-query

        for (let i = 0; i < imageFiles.length; i++) {
            const imageEntry = imageFiles[i];
            const imageName = imageEntry.name.substring(
                imageEntry.name.lastIndexOf("/") + 1
            );
            if (loadingModalMsg)
                loadingModalMsg.textContent = `Importing ${i + 1}/${
                    imageFiles.length
                }: ${imageName}`;

            try {
                const imageDataBlob = await imageEntry.async(
                    "blob"
                );
                const blobUrl = URL.createObjectURL(imageDataBlob);
                const imageFileObject = new File(
                    [imageDataBlob],
                    imageName,
                    { type: imageDataBlob.type }
                );

                const newEntryElement =
                    document.createElement("dataset-entry");
                newEntryElement.setImage(blobUrl, imageFileObject);

                const imageBaseName = imageName
                    .substring(0, imageName.lastIndexOf("."))
                    .toLowerCase();
                if (textFiles[imageBaseName]) {
                    const tagsString = await textFiles[
                        imageBaseName
                    ];
                    const tagsArray = parseRawTagInput(tagsString);
                    newEntryElement.setTags(tagsArray);
                }

                if (currentMainContentArea) {
                    let referenceNode =
                        state.dropHint?.isConnected &&
                        state.dropHint.parentElement ===
                            currentMainContentArea
                            ? state.dropHint
                            : currentMainContentArea.firstChild;

                    currentMainContentArea.insertBefore(
                        newEntryElement,
                        referenceNode
                    );
                    importedCount++;
                } else {
                    console.error(
                        "state.mainContentAreaElement not found, cannot add imported entry."
                    );
                    errorCount++;
                }
            } catch (err) {
                console.error(
                    `Error processing image ${imageName} from ZIP:`,
                    err
                );
                errorCount++;
            }
        }

        document.querySelector(".modal-overlay")?.remove();
        let resultMessage = `Dataset import complete. ${importedCount} entries added.`;
        if (errorCount > 0) {
            resultMessage += ` ${errorCount} error(s) occurred.`;
        }
        showConfirmationModal(resultMessage, [{ text: "OK" }]);
        showMainAppUI();
        // Ensure tagging tab is active after importing
        const appTabs = document.getElementById("app");
        if (appTabs && typeof appTabs.activateTab === "function") {
            appTabs.activateTab(appTabs.sanitizeId("tagging"));
        }
        checkDropHintVisibility();
    } catch (error) {
        console.error("Error importing dataset from ZIP:", error);
        document.querySelector(".modal-overlay")?.remove();
        showConfirmationModal(
            `Error importing dataset: ${error.message}. Check console for details.`,
            [{ text: "OK" }]
        );
    }
}

function confirmAndExportDataset() {
    const currentMainContentArea =
        document.getElementById("main-content-area");
    const currentSearchInput =
        document.getElementById("search-bar");

    if (!currentMainContentArea || !currentSearchInput) {
        showConfirmationModal(
            "Cannot export: UI elements missing.",
            [{ text: "OK" }]
        );
        return;
    }

    const entries =
        currentMainContentArea.querySelectorAll("dataset-entry");
    const searchIsActive = currentSearchInput.value.trim() !== "";
    const entriesToCheck = searchIsActive
        ? Array.from(entries).filter(
              (entry) => entry.style.display !== "none"
          )
        : Array.from(entries);

    if (entriesToCheck.length === 0) {
        if (searchIsActive && entries.length > 0) {
            showConfirmationModal(
                "No entries match the current filter. Export all entries instead?",
                [
                    {
                        text: "Export All (" + entries.length + ")",
                        onClick: () =>
                            exportDataset(Array.from(entries)),
                        class: "modal-button-confirm",
                    },
                    {
                        text: "Cancel",
                        onClick: () => {},
                        class: "modal-button-cancel",
                    },
                ]
            );
        } else {
            showConfirmationModal(
                "Dataset is empty. Nothing to export.",
                [{ text: "OK" }]
            );
        }
        return;
    }

    let requirementsMet = true;
    let failingEntriesCount = 0;
    for (const entry of entriesToCheck) {
        if (!entry.checkGroupRequirements()) {
            requirementsMet = false;
            failingEntriesCount++;
        }
    }

    const exportTargetDescription = searchIsActive
        ? "filtered"
        : "all";
    const countDescription = `${
        entriesToCheck.length
    } ${exportTargetDescription} entr${
        entriesToCheck.length === 1 ? "y" : "ies"
    }`;

    if (requirementsMet) {
        exportDataset(
            entriesToCheck,
            `Exporting ${countDescription}...`
        );
    } else {
        showConfirmationModal(
            `Warning: ${failingEntriesCount} of the ${countDescription} do not meet minimum tag requirements. Export anyway?`,
            [
                {
                    text: "Export Anyway",
                    onClick: () =>
                        exportDataset(
                            entriesToCheck,
                            `Exporting ${countDescription} (with warnings)...`
                        ),
                    class: "modal-button-confirm",
                },
                {
                    text: "Cancel",
                    onClick: () => {},
                    class: "modal-button-cancel",
                },
            ]
        );
    }
}

async function exportDataset(
    entriesToExport,
    description = "Exporting dataset..."
) {
    if (
        typeof JSZip === "undefined" ||
        typeof saveAs === "undefined"
    ) {
        showConfirmationModal(
            "Export libraries (JSZip, FileSaver) not loaded.",
            [{ text: "OK" }]
        );
        return;
    }
    if (!entriesToExport || entriesToExport.length === 0) {
        showConfirmationModal("No entries to export.", [
            { text: "OK" },
        ]);
        return;
    }

    const zip = new JSZip();
    const folder = zip.folder("lora_dataset");
    let count = 0,
        errors = 0;
    console.log(description);

    const exportMenuItem = document.querySelector(
        'menu-item[data-action="export"]'
    );
    let originalMenuText = "Export Dataset (ZIP)";
    if (exportMenuItem) {
        originalMenuText = exportMenuItem.textContent;
        exportMenuItem.textContent = "Exporting...";
        exportMenuItem.style.pointerEvents = "none";
    } else {
        showConfirmationModal("Exporting dataset...", []);
    }

    const names = new Set();
    for (const entry of entriesToExport) {
        count++;
        const imgElement = entry.querySelector("img");
        const baseNameSource =
            entry.originalImageName || imgElement?.alt || "";

        let baseName = baseNameSource.includes(".")
            ? baseNameSource.substring(
                  0,
                  baseNameSource.lastIndexOf(".")
              )
            : baseNameSource;
        baseName =
            baseName || `image_${String(count).padStart(4, "0")}`;
        baseName = sanitizeFilename(baseName);

        const imageData = await entry.getImageData();
        if (!imageData) {
            console.warn(
                `Skipping entry ${count} (${baseNameSource}): Failed to get image data.`
            );
            errors++;
            continue;
        }

        let extension = "png";
        if (imageData.type) {
            const mimeType = imageData.type.split("/")[1];
            if (mimeType === "jpeg") extension = "jpg";
            else if (
                ["png", "webp", "gif", "bmp", "tiff"].includes(
                    mimeType
                )
            )
                extension = mimeType;
        } else if (
            entry.originalImageName &&
            entry.originalImageName.includes(".")
        ) {
            let origExt = entry.originalImageName
                .substring(
                    entry.originalImageName.lastIndexOf(".") + 1
                )
                .toLowerCase();
            if (
                [
                    "png",
                    "jpg",
                    "jpeg",
                    "webp",
                    "gif",
                    "bmp",
                    "tiff",
                ].includes(origExt)
            ) {
                extension = origExt === "jpeg" ? "jpg" : origExt;
            }
        }
        extension = extension.startsWith(".")
            ? extension.substring(1)
            : extension;

        let uniqueFullName = `${baseName}.${extension}`;
        let nameCounter = 1;
        while (names.has(uniqueFullName.toLowerCase())) {
            const tempBaseName = baseName.replace(/_\d+$/, "");
            uniqueFullName = `${tempBaseName}_${nameCounter++}.${extension}`;
        }
        names.add(uniqueFullName.toLowerCase());

        const tags = entry.getTagsAsString(", ");

        folder.file(uniqueFullName, imageData, {
            binary: true,
        });
        folder.file(
            `${uniqueFullName.substring(
                0,
                uniqueFullName.lastIndexOf(".")
            )}.txt`,
            tags
        );
    }

    document.querySelector(".modal-overlay")?.remove();

    let exportMessage = "";
    if (entriesToExport.length === 0 && errors === 0)
        exportMessage = "No entries were exported.";
    else if (errors > 0)
        exportMessage = `Export finished with ${errors} error(s). ${
            entriesToExport.length - errors
        } entries exported successfully. Check console for details.`;
    else
        exportMessage = `Export successful! ${entriesToExport.length} entries packaged.`;

    if (
        entriesToExport.length > 0 &&
        errors < entriesToExport.length
    ) {
        try {
            const blob = await zip.generateAsync(
                {
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 6 },
                },
                (meta) => {
                    if (exportMenuItem)
                        exportMenuItem.textContent = `Exporting... (${meta.percent.toFixed(
                            0
                        )}%)`;
                }
            );
            saveAs(blob, "lora_dataset_export.zip");
            showConfirmationModal(exportMessage, [{ text: "OK" }]);
        } catch (err) {
            console.error("Error generating ZIP file:", err);
            showConfirmationModal(
                "Error generating ZIP file. Check console.",
                [{ text: "OK" }]
            );
        }
    } else {
        showConfirmationModal(exportMessage, [{ text: "OK" }]);
    }

    if (exportMenuItem) {
        exportMenuItem.textContent = originalMenuText;
        exportMenuItem.style.pointerEvents = "auto";
    }
}
