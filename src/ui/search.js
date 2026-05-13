// Search-driven UI: applying a query to the entries list and the
// drop-hint message that swaps based on result state.

import { state } from "../core/state.js";
import { evaluateExpression, getQueryLeafTerms } from "../core/search.js";
import { getTagColor } from "../utils/color.js";

export const checkDropHintVisibility = () => {
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
