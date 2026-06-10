// The opentaggerAPI surface: the curated set of operations the dev
// console (and other modules) can call to drive the app.

import { state } from "./state.js";
import { evaluateExpression } from "./search.js";
import { parseFunctionSignature } from "../utils/text.js";
import { filterEntries } from "../ui/search.js";
import { logToConsole } from "../ui/devConsole.js";
import { slashCommands } from "./slashCommands.js";

export const opentaggerAPI = {
    search: (...args) => {
        const query = args.join(" ").trim();
        if (state.searchInput) {
            state.searchInput.value = query;
            filterEntries(query);
        } else {
            filterEntries(query);
        }
        logToConsole(
            `API: opentaggerAPI.search("${query}") executed.`
        );
        return `Search initiated for: "${query}"`;
    },
    selectEntries: (query, append = false) => {
        if (!state.mainContentAreaElement) {
            logToConsole(
                "Error: Main content area not found.",
                "error"
            );
            return "Selection failed: Main content area not found.";
        }

        if (!append) {
            opentaggerAPI.deselectAllEntries(true);
        }

        const entries =
            state.mainContentAreaElement.querySelectorAll(
                "dataset-entry"
            );
        const normalizedQuery = query.trim().toLowerCase();
        let selectionCount = 0;

        for (const entry of entries) {
            const isVisible = entry.style.display !== "none";
            let match = false;

            if (normalizedQuery === "") {
                // If query is empty, select only visible entries
                match = isVisible;
            } else {
                // If query exists, match based on query AND visibility
                const tags = entry.getNormalizedTags();
                match =
                    evaluateExpression(normalizedQuery, tags) &&
                    isVisible;
            }

            if (match) {
                entry.selected = true;
                selectionCount++;
            } else if (!append && entry.selected) {
                // If not appending and entry is selected but doesn't match or isn't visible, deselect it
                entry.selected = false;
            }
        }

        // Re-anchor shift-select if exactly one entry is selected.
        const currentlySelected =
            opentaggerAPI.getSelectedEntries();
        if (currentlySelected.length === 1) {
            state.globalLastClickedEntryForShiftSelect =
                currentlySelected[0];
        } else {
            state.globalLastClickedEntryForShiftSelect = null;
        }

        const message =
            `Selected ${selectionCount} entr${
                selectionCount === 1 ? "y" : "ies"
            }` +
            (query
                ? ` matching "${query}".`
                : append
                ? " (appended to existing selection)."
                : ".");
        return message;
    },
    deselectAllEntries: (silent = false) => {
        if (!state.mainContentAreaElement) {
            if (!silent)
                logToConsole(
                    "Error: Main content area not found.",
                    "error"
                );
            return "Deselection failed: Main content area not found.";
        }
        let deselectionCount = 0;

        for (const entry of state.mainContentAreaElement.querySelectorAll(
            "dataset-entry[selected]"
        )) {
            entry.selected = false;
            deselectionCount++;
        }

        state.globalLastClickedEntryForShiftSelect = null;

        const message = `Deselected ${deselectionCount} entr${
            deselectionCount === 1 ? "y" : "ies"
        }.`;
        return message;
    },
    getSelectedEntries: () => {
        if (!state.mainContentAreaElement) return [];
        return Array.from(
            state.mainContentAreaElement.querySelectorAll(
                "dataset-entry[selected]"
            )
        );
    },
    filterSelectedEntries: (query) => {
        if (!state.mainContentAreaElement) {
            return "Filter failed: Main content area not found.";
        }
        const trimmedQuery =
            typeof query === "string" ? query.trim() : "";
        if (trimmedQuery === "") {
            return "Filter query is empty. No entries changed.";
        }

        const selectedEntries = Array.from(
            state.mainContentAreaElement.querySelectorAll(
                "dataset-entry[selected]"
            )
        );
        if (selectedEntries.length === 0) {
            return "No entries selected to filter.";
        }

        let deselectedCount = 0;

        for (const entry of selectedEntries) {
            const tags = entry.getNormalizedTags();
            const shouldKeep = evaluateExpression(
                trimmedQuery,
                tags
            );
            if (!shouldKeep) {
                entry.selected = false;
                deselectedCount++;
            }
        }

        // Re-anchor shift-select if exactly one entry remains selected.
        const currentlySelected =
            opentaggerAPI.getSelectedEntries();
        if (currentlySelected.length === 1) {
            state.globalLastClickedEntryForShiftSelect =
                currentlySelected[0];
        } else if (
            deselectedCount > 0 &&
            state.globalLastClickedEntryForShiftSelect &&
            !state.globalLastClickedEntryForShiftSelect.selected
        ) {
            // If the last clicked entry was deselected by the filter, clear it
            state.globalLastClickedEntryForShiftSelect = null;
        }

        const keptCount = selectedEntries.length - deselectedCount;
        return `Filter applied to ${
            selectedEntries.length
        } selected entr${
            selectedEntries.length === 1 ? "y" : "ies"
        }. Kept: ${keptCount}, Deselected: ${deselectedCount}. Query: "${query}"`;
    },
    addTagsToSelected: (tagsArray) => {
        const selectedEntries = opentaggerAPI.getSelectedEntries();
        if (selectedEntries.length === 0) {
            return "No entries selected. No tags added.";
        }
        if (!Array.isArray(tagsArray) || tagsArray.length === 0) {
            return "No tags provided to add.";
        }

        let totalTagsAdded = 0;
        let entriesModified = 0;

        for (const entry of selectedEntries) {
            let tagsAddedToThisEntry = 0;
            for (const tag of tagsArray) {
                if (entry.addTag(tag)) {
                    tagsAddedToThisEntry++;
                }
            }
            if (tagsAddedToThisEntry > 0) {
                totalTagsAdded += tagsAddedToThisEntry;
                entriesModified++;
            }
        }
        return `Added ${totalTagsAdded} tag(s) across ${entriesModified} selected entr${
            entriesModified === 1 ? "y" : "ies"
        }.`;
    },
    removeTagsFromSelected: (tagsArray) => {
        const selectedEntries = opentaggerAPI.getSelectedEntries();
        if (selectedEntries.length === 0) {
            return "No entries selected. No tags removed.";
        }
        if (!Array.isArray(tagsArray) || tagsArray.length === 0) {
            return "No tags provided to remove.";
        }
        if (tagsArray.length === 1 && tagsArray[0] === "*") {
            // "*" wildcard: remove all tags from each selected entry.
            let totalTagsRemoved = 0;
            let entriesModified = 0;
            for (const entry of selectedEntries) {
                const currentTagCount = entry.getTags().length;
                if (currentTagCount > 0) {
                    entry.setTags([]); // setTags will trigger updates
                    totalTagsRemoved += currentTagCount;
                    entriesModified++;
                }
            }

            return `Removed all tags from ${entriesModified} selected entr${
                entriesModified === 1 ? "y" : "ies"
            }. Total tags removed: ${totalTagsRemoved}.`;
        }

        const tagsToRemoveLower = tagsArray
            .map((t) => String(t).trim().toLowerCase())
            .filter((t) => t);
        if (tagsToRemoveLower.length === 0) {
            return "No valid tags provided to remove after processing.";
        }

        let totalTagsRemoved = 0;
        let entriesModified = 0;

        for (const entry of selectedEntries) {
            const currentTags = entry.getTags();
            const initialTagCount = currentTags.length;

            const newTags = currentTags.filter(
                (tag) =>
                    !tagsToRemoveLower.includes(tag.toLowerCase())
            );

            if (newTags.length < initialTagCount) {
                entry.setTags(newTags); // setTags will trigger updates
                totalTagsRemoved +=
                    initialTagCount - newTags.length;
                entriesModified++;
            }
        }
        return `Removed ${totalTagsRemoved} tag(s) across ${entriesModified} selected entr${
            entriesModified === 1 ? "y" : "ies"
        }.`;
    },
    rename: ({ targetTag, replaceValue, global = false }) => {
        if (!state.mainContentAreaElement) {
            return "Rename failed: Main content area not found.";
        }
        if (
            typeof targetTag !== "string" ||
            targetTag.trim() === ""
        ) {
            return "Rename failed: targetTag must be a non-empty string.";
        }
        if (
            typeof replaceValue !== "string" ||
            replaceValue.trim() === ""
        ) {
            return "Rename failed: replaceValue must be a non-empty string.";
        }

        const targetTagLower = targetTag.trim().toLowerCase();
        const replaceValueTrimmed = replaceValue.trim();
        const replaceValueLower = replaceValueTrimmed.toLowerCase();

        let totalEntriesModified = 0;
        let totalGroupsModified = 0;
        let totalTagOccurrencesRenamed = 0;

        // Process Dataset Entries
        const entriesToProcess = global
            ? Array.from(
                  state.mainContentAreaElement.querySelectorAll(
                      "dataset-entry"
                  )
              )
            : opentaggerAPI.getSelectedEntries();

        for (const entry of entriesToProcess) {
            const currentTags = entry.getTags();
            let entryModified = false;
            const newTags = [];
            const newTagsLower = new Set();

            for (const tag of currentTags) {
                const tagLower = tag.toLowerCase();
                if (tagLower === targetTagLower) {
                    // Replace the target tag
                    if (!newTagsLower.has(replaceValueLower)) {
                        newTags.push(replaceValueTrimmed);
                        newTagsLower.add(replaceValueLower);
                        totalTagOccurrencesRenamed++;
                        entryModified = true;
                    } else {
                        // If replaceValue is already present, just drop the targetTag
                        totalTagOccurrencesRenamed++; // Still count as an occurrence replaced/removed
                        entryModified = true;
                    }
                } else {
                    // Keep other tags, avoiding duplicates if replaceValue matches an existing tag
                    if (!newTagsLower.has(tagLower)) {
                        newTags.push(tag);
                        newTagsLower.add(tagLower);
                    }
                }
            }

            if (entryModified) {
                entry.setTags(newTags); // setTags handles internal updates and events
                totalEntriesModified++;
            }
        }

        // Process Tag Groups if global is true
        if (global) {
            const groups = document.querySelectorAll(
                "#tag-group-list tag-group"
            );
            for (const group of groups) {
                const list = group.querySelector("tag-list");
                if (!list) continue;

                const currentTags = list.getTags();
                let groupModified = false;
                const newTags = [];
                const newTagsLower = new Set();

                for (const tag of currentTags) {
                    const tagLower = tag.toLowerCase();
                    if (tagLower === targetTagLower) {
                        // Replace the target tag
                        if (!newTagsLower.has(replaceValueLower)) {
                            newTags.push(replaceValueTrimmed);
                            newTagsLower.add(replaceValueLower);
                            totalTagOccurrencesRenamed++; // Count occurrences in groups too
                            groupModified = true;
                        } else {
                            // If replaceValue is already present, just drop the targetTag
                            totalTagOccurrencesRenamed++; // Still count as an occurrence replaced/removed
                            groupModified = true;
                        }
                    } else {
                        // Keep other tags, avoiding duplicates
                        if (!newTagsLower.has(tagLower)) {
                            newTags.push(tag);
                            newTagsLower.add(tagLower);
                        }
                    }
                }

                if (groupModified) {
                    list.setTagsFromArray(newTags); // Use setTagsFromArray to update the list UI
                    totalGroupsModified++;
                }
            }
        }

        const scope = global
            ? "all entries and groups"
            : `${entriesToProcess.length} selected entr${
                  entriesToProcess.length === 1 ? "y" : "ies"
              }`;
        let message = `Renamed "${targetTag}" to "${replaceValue}".`;
        if (totalEntriesModified > 0) {
            message += ` Modified ${totalEntriesModified} entr${
                totalEntriesModified === 1 ? "y" : "ies"
            }.`;
        }
        if (global && totalGroupsModified > 0) {
            message += ` Modified ${totalGroupsModified} group${
                totalGroupsModified === 1 ? "" : "s"
            }.`;
        }
        message += ` Total tag occurrences renamed: ${totalTagOccurrencesRenamed}.`;

        if (
            totalEntriesModified === 0 &&
            totalGroupsModified === 0
        ) {
            message = `No occurrences of "${targetTag}" found to rename in ${scope}.`;
        }

        return message;
    },
    count: (tagsArray) => {
        if (!state.mainContentAreaElement) {
            return "Count failed: Main content area not found.";
        }
        if (!Array.isArray(tagsArray) || tagsArray.length === 0) {
            return "Count failed: No tags provided to count.";
        }

        const requiredTagsLower = tagsArray
            .map((t) => String(t).trim().toLowerCase())
            .filter((t) => t);
        if (requiredTagsLower.length === 0) {
            return "Count failed: No valid tags provided after processing.";
        }

        const visibleEntries = Array.from(
            state.mainContentAreaElement.querySelectorAll(
                'dataset-entry:not([style*="display: none"])'
            )
        );

        let matchCount = 0;

        for (const entry of visibleEntries) {
            const entryTagsLower = entry.getNormalizedTags();
            const allRequiredTagsPresent = requiredTagsLower.every(
                (requiredTag) =>
                    entryTagsLower.includes(requiredTag)
            );

            if (allRequiredTagsPresent) {
                matchCount++;
            }
        }

        const tagListString = tagsArray.join(", ");
        return `Found ${matchCount} visible entr${
            matchCount === 1 ? "y" : "ies"
        } containing all tags: "${tagListString}".`;
    },
    help: () => {
        const apiHelp = `Available opentaggerAPI functions (callable directly in JS console):\n${Object.keys(
            opentaggerAPI
        )
            .map(
                (k) =>
                    `  ${k}${parseFunctionSignature(
                        opentaggerAPI[k]
                    )}`
            )
            .join("\n")}`;
        const cmdHelp = `\nAvailable slash commands:\n${Object.keys(
            slashCommands
        )
            .map((k) => {
                const commandObject = slashCommands[k];
                let displaySignature = "";
                if (
                    commandObject &&
                    commandObject.signature !== undefined
                ) {
                    displaySignature = ` ${commandObject.signature}`;
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
                        parseFunctionSignature(funcToParseForSig);
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
                                if (char === "{") p_openBrackets++;
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
                                    } else if (p.includes("=")) {
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
                return `  /${k}${
                    displaySignature.trim()
                        ? `${displaySignature}`
                        : ""
                }`;
            })
            .join(
                "\n"
            )}\n\nQuery Syntax: Supports tags (e.g. cat), "quoted phrases", AND (&&), OR (||), NOT (!), and parentheses (). Example: face && (smile || !sad)\nType JavaScript code directly to execute it (e.g., 1+1, or search('tag')). Press Enter.`;
        const helpText = `${apiHelp}\n${cmdHelp}`;
        logToConsole(helpText, "info", true);
        return "Help displayed in console.";
    },
    clear: () => {
        if (state.consoleOutputElement)
            state.consoleOutputElement.innerHTML = "";
        return "Console cleared.";
    },
};
