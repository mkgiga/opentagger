// Shared mutable state and constants used across the app.
//
// Everything lives on a single exported `state` object so modules can
// both read and write properties (ESM named bindings are read-only).

export const state = {
    // --- Constants ---
    PROJECT_FILE_EXTENSION: ".loraproj",
    AUTOTAG_API_URL: "http://localhost:8081/autotag/",
    HEALTH_CHECK_URL: "http://localhost:8081/health",
    CONSOLE_MAX_HEIGHT_PERCENT: 40,
    MAX_SUGGESTIONS: 10,

    // --- Drag / drop ---
    draggedElement: null,

    // --- Top-level DOM refs (populated in DOMContentLoaded) ---
    mainView: null,
    mainContentAreaElement: null,
    appContainer: null,
    splashScreenElement: null,
    dropHint: null,
    searchInput: null,
    autotagAllButton: null,

    // --- Search highlighting ---
    globalParsedSearchTerms: [],
    globalSearchTermColors: {},

    // The entry that anchored the last selection click. Shift-click
    // ranges off of this.
    globalLastClickedEntryForShiftSelect: null,

    // --- Dev console ---
    devConsoleElement: null,
    consoleOutputElement: null,
    isConsoleVisible: false,
    consoleCodeMirrorInstance: null,
    consoleHistory: [],
    consoleHistoryIndex: -1,
    currentConsoleInputBuffer: "",
    hasShownConsoleWelcomeMessage: false,

    // --- Booru tag autocomplete ---
    booruTags: [],
    booruTagsLoadingPromise: null,
    globalTagAutocompleteDropdown: null,

    // --- Context menu ---
    currentContextMenu: null,
};
