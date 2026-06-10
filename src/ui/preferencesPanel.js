// Preferences-panel UI generator.
//
// Renders a Global / This Project scope switcher, then walks the
// PREFERENCE_DEFAULTS tree and emits a label/input pair for each leaf.
// Editing in project scope creates a project override (saved into the
// .loraproj); overridden items get a reset button that falls back to
// the global value.

import {
    PREFERENCE_DEFAULTS,
    getPreferenceAtScope,
    setPreference,
    clearPreference,
    hasOverride,
} from "../core/preferences.js";
import { keyToLabel } from "../utils/text.js";

let currentScope = "global";
let panelElement = null;

function numberInputAttributes(key) {
    if (key.endsWith("Threshold")) {
        return { step: 0.05, min: 0, max: 1 };
    }
    const lower = key.toLowerCase();
    if (lower.includes("pixels") || lower.includes("timeout")) {
        return { step: 1000 };
    }
    return { step: 1 };
}

function isSelectNode(value) {
    return (
        typeof value === "object" &&
        value !== null &&
        value["@type"] === "select"
    );
}

function renderLeaf(key, node, itemPath, container) {
    const itemDiv = document.createElement("div");
    itemDiv.className = "preference-item";

    const label = document.createElement("label");
    label.textContent = keyToLabel(key);
    label.htmlFor = `pref-${itemPath}`;
    itemDiv.appendChild(label);

    const current = getPreferenceAtScope(itemPath, currentScope);
    const onChange = (value) => {
        setPreference(itemPath, value, currentScope);
        markOverride(itemDiv, itemPath);
    };

    let input;
    if (isSelectNode(node)) {
        input = document.createElement("select");
        for (const opt of node.options) {
            const option = document.createElement("option");
            option.value = opt;
            option.textContent = opt;
            if (opt === current) option.selected = true;
            input.appendChild(option);
        }
        input.addEventListener("change", (e) =>
            onChange(e.target.value)
        );
    } else if (typeof node === "boolean") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(current);
        input.addEventListener("change", (e) =>
            onChange(e.target.checked)
        );
    } else if (typeof node === "number") {
        input = document.createElement("input");
        input.type = "number";
        Object.assign(input, numberInputAttributes(key));
        input.value = current;
        input.addEventListener("change", (e) =>
            onChange(parseFloat(e.target.value))
        );
    } else if (typeof node === "string") {
        input = document.createElement("input");
        input.type = "text";
        input.value = current;
        input.addEventListener("change", (e) =>
            onChange(e.target.value)
        );
    } else {
        return;
    }
    input.id = `pref-${itemPath}`;
    itemDiv.appendChild(input);

    // In project scope, an override can be reset back to global.
    if (currentScope === "project") {
        const reset = document.createElement("button");
        reset.className = "preference-reset material-icons";
        reset.textContent = "undo";
        reset.title = "Remove project override (use global value)";
        reset.addEventListener("click", () => {
            clearPreference(itemPath, "project");
            refreshPreferencesUI();
        });
        itemDiv.appendChild(reset);
    }
    markOverride(itemDiv, itemPath);

    container.appendChild(itemDiv);
}

function markOverride(itemDiv, itemPath) {
    itemDiv.classList.toggle(
        "overridden",
        currentScope === "project" &&
            hasOverride(itemPath, "project")
    );
}

function renderTree(config, parentElement, currentPath, level) {
    for (const [key, value] of Object.entries(config)) {
        const itemPath = currentPath
            ? `${currentPath}.${key}`
            : key;

        if (
            typeof value === "object" &&
            value !== null &&
            !isSelectNode(value)
        ) {
            const section = document.createElement("div");
            section.className = "preferences-section";

            const title = document.createElement(
                level === 0 ? "h3" : "h4"
            );
            title.textContent = keyToLabel(key);
            section.appendChild(title);

            renderTree(value, section, itemPath, level + 1);
            parentElement.appendChild(section);
        } else {
            renderLeaf(key, value, itemPath, parentElement);
        }
    }
}

function renderScopeSwitcher(parentElement) {
    const switcher = document.createElement("div");
    switcher.className = "preferences-scope-switcher";

    for (const [scope, label] of [
        ["global", "Global"],
        ["project", "This Project"],
    ]) {
        const button = document.createElement("button");
        button.textContent = label;
        button.classList.toggle("active", scope === currentScope);
        button.addEventListener("click", () => {
            currentScope = scope;
            refreshPreferencesUI();
        });
        switcher.appendChild(button);
    }

    const hint = document.createElement("span");
    hint.className = "preferences-scope-hint";
    hint.textContent =
        currentScope === "project"
            ? "Overrides are saved inside the project file."
            : "Saved on this computer for all projects.";
    switcher.appendChild(hint);

    parentElement.appendChild(switcher);
}

export function generatePreferencesUI(parentElement) {
    panelElement = parentElement;
    refreshPreferencesUI();
}

/** Re-render in place (e.g. after a project load swaps overrides). */
export function refreshPreferencesUI() {
    if (!panelElement) return;
    panelElement.innerHTML = "";
    renderScopeSwitcher(panelElement);
    renderTree(PREFERENCE_DEFAULTS, panelElement, "", 0);
}
