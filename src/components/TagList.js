import { state } from "../core/state.js";
import { opentaggerAPI } from "../core/api.js";
import { getTagText } from "../utils/dom.js";
import { parseRawTagInput } from "../utils/text.js";
import { sfx } from "../ui/sfx.js";
import { DatasetTag } from "./DatasetTag.js";

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
