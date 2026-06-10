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

    checkDropHintVisibility();

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

    // Refresh CodeMirror if the tagging tab and console are visible.
    const appTabContainer = document.getElementById("app");
    if (
        appTabContainer &&
        appTabContainer.activeTab === "tagging"
    ) {
        if (state.isConsoleVisible && state.consoleCodeMirrorInstance) {
            setTimeout(() => {
                if (state.consoleCodeMirrorInstance)
                    state.consoleCodeMirrorInstance.refresh();
            }, 50);
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
        filterEntries("");
    }

    opentaggerAPI.deselectAllEntries(true);

    checkDropHintVisibility();
    console.log("Workspace cleared for new project.");
}
