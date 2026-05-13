// Application bootstrap.
//
// Everything else has been peeled out into focused modules under
// src/{components,core,io,ui,utils}/. This file is now just (a) the
// import side-effects that register web components and run the audio
// init, and (b) the one big DOMContentLoaded handler that wires the
// DOM to all of the above.

// State + curated API surface.
import { state } from "./core/state.js";
import { preferences } from "./core/preferences.js";
import { opentaggerAPI } from "./core/api.js";
import { evaluateExpression } from "./core/search.js";
import { debounce } from "./utils/timing.js";

// UI factories.
import { sfx } from "./ui/sfx.js";
import { createContextMenu } from "./ui/contextMenu.js";
import { showConfirmationModal } from "./ui/modal.js";
import { filterEntries, checkDropHintVisibility } from "./ui/search.js";
import {
    customCodeMirrorHints,
    toggleDevConsole,
    processConsoleInput,
} from "./ui/devConsole.js";
import { generatePreferencesUI } from "./ui/preferencesPanel.js";
import {
    showMainAppUI,
    clearWorkspaceForNewProject,
} from "./ui/lifecycle.js";

// I/O (CSV load, autotag, project/dataset save+load).
import { loadBooruTags } from "./io/booruTags.js";
import { handleAutotagAllClick } from "./io/autotag.js";
import { saveProject, handleProjectFileSelect } from "./io/project.js";
import {
    handleDatasetZipSelect,
    confirmAndExportDataset,
} from "./io/datasetZip.js";

// Web components -- imported for side effects only; each module
// registers its custom element on first load.
import "./components/TabContainer.js";
import "./components/AutocompleteDropdown.js";
import "./components/MenuItem.js";
import "./components/ContextMenu.js";
import "./components/DatasetTag.js";
import "./components/TagList.js";
import "./components/DatasetEntry.js";
import "./components/TagGroup.js";


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







