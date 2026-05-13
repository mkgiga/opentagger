import { state } from "../core/state.js";
import { opentaggerAPI } from "../core/api.js";
import { getTagText } from "../utils/dom.js";
import { parseRawTagInput } from "../utils/text.js";
import { debounce } from "../utils/timing.js";
import { createContextMenu } from "../ui/contextMenu.js";
// logToConsole is used inside context-menu
// callbacks; lives in src/ui/devConsole.js.
import { logToConsole } from "../ui/devConsole.js";

export class DatasetTag extends HTMLElement {
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
