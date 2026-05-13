// App-lifecycle helpers: hiding the splash and clearing the
// workspace for a fresh project.

import { state } from "../core/state.js";
import { opentaggerAPI } from "../core/api.js";
import { sfx } from "./sfx.js";
import { filterEntries, checkDropHintVisibility } from "./search.js";

export function showMainAppUI() {
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

export function clearWorkspaceForNewProject() {
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
