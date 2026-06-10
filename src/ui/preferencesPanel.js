// Preferences-panel UI generator.
//
// Walks the preferences tree and emits a label/input pair for each
// leaf. Recursive on nested objects; uses keyToLabel for human-
// readable section/field names.

import { updatePreference } from "../core/preferences.js";
import { keyToLabel } from "../utils/text.js";

export function generatePreferencesUI(
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
                    numInput.step = 1000;
                else if (key.toLowerCase().includes("timeout"))
                    numInput.step = 1000;
                else numInput.step = 1;
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








