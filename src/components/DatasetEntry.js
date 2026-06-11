import { state } from "../core/state.js";
import { opentaggerAPI } from "../core/api.js";
import { createTimerLabelElement } from "../utils/dom.js";
import { startTimer } from "../utils/timing.js";
import {
    createContextMenu,
    getGroupSubmenuItems,
} from "../ui/contextMenu.js";
import {
    showConfirmationModal,
    showImagePreviewModal,
} from "../ui/modal.js";
import {
    ensureAutotagReady,
    autotagImage,
} from "../io/tagger.js";

class DatasetEntry extends HTMLElement {
    constructor() {
        super();
        this.imageSrc = "";
        this.imageData = null;
        this.originalImageName = "";
        this._selected = false;
        this._boundCheckAndUpdate =
            this.checkGroupRequirementsAndUpdateVisuals.bind(this);
        this._boundHandleImageClick =
            this._handleImageClick.bind(this);
        this._boundHandleAutotagClick =
            this._handleAutotagClick.bind(this);
        this._boundHandleEntryClick =
            this._handleEntryClick.bind(this);
        this._boundHandleContextMenu =
            this._handleContextMenu.bind(this);
    }
    get selected() {
        return this.hasAttribute("selected");
    }
    set selected(value) {
        const isSelected = Boolean(value);
        if (isSelected) {
            this.setAttribute("selected", "");
            this._selected = true;
        } else {
            this.removeAttribute("selected");
            this._selected = false;
        }
    }
    toggleSelected() {
        this.selected = !this.selected;
    }
    connectedCallback() {
        this.classList.add("dataset-entry");
        if (!this.querySelector(".entry-content")) {
            this.innerHTML = `
    <div class="entry-content">
        <img src="${this.imageSrc || ""}" alt="${
                this.originalImageName || ""
            }" title="Click to preview">
        <tag-list direction="row"></tag-list>
    </div>
    <div class="entry-buttons">
        <button class="autotag-entry material-icons" title="Autotag Image (AI)" speaker="Autotag Image">auto_awesome</button>
    </div>
    <button class="delete-entry material-icons" title="Delete Entry" speaker="Delete Entry">delete_forever</button>`;
        }
        this.style.position = "relative";

        const delBtn = this.querySelector(".delete-entry");
        delBtn.addEventListener("click", () => this.deleteEntry());

        const autotagBtn = this.querySelector(".autotag-entry");
        autotagBtn?.addEventListener(
            "click",
            this._boundHandleAutotagClick
        );

        this.addEventListener(
            "tag-updated",
            this._boundCheckAndUpdate
        );

        this.addEventListener(
            "tag-list-changed-internally",
            this._boundCheckAndUpdate
        );

        const img = this.querySelector("img");
        img?.addEventListener("click", this._boundHandleImageClick);

        this.addEventListener("click", this._boundHandleEntryClick);
        this.addEventListener(
            "contextmenu",
            this._boundHandleContextMenu
        );

        this.checkGroupRequirementsAndUpdateVisuals();
        this.addDragDropListeners();

        if (img && this.imageSrc && !img.src) {
            img.src = this.imageSrc;
            img.alt = this.originalImageName;
            img.title = "Click to preview";
        }
    }
    disconnectedCallback() {
        const img = this.querySelector("img");
        if (img?.src.startsWith("blob:")) {
            URL.revokeObjectURL(img.src);
        }
        this.removeEventListener(
            "tag-updated",
            this._boundCheckAndUpdate
        );
        this.removeEventListener(
            "tag-list-changed-internally",
            this._boundCheckAndUpdate
        );
        img?.removeEventListener(
            "click",
            this._boundHandleImageClick
        );
        this.querySelector(".autotag-entry")?.removeEventListener(
            "click",
            this._boundHandleAutotagClick
        );
        this.removeEventListener(
            "click",
            this._boundHandleEntryClick
        );
        this.removeEventListener(
            "contextmenu",
            this._boundHandleContextMenu
        );
    }

    _handleEntryClick(event) {
        const clickedEntry = this;
        const wasSelected = clickedEntry.selected;
        const isCtrlPressed = event.ctrlKey || event.metaKey; // metaKey for macOS
        const isShiftPressed = event.shiftKey;

        const targetTagName = event.target.tagName.toLowerCase();
        if (
            targetTagName !== "input" &&
            targetTagName !== "textarea" &&
            !event.target.isContentEditable &&
            event.target !== clickedEntry.querySelector("img")
        ) {
            event.preventDefault();
        }

        const target = event.target;
        if (
            target.closest("button") ||
            target.closest("dataset-tag") ||
            target.closest('span[contenteditable="true"]') ||
            target.tagName === "IMG"
        ) {
            // A click on a dataset-tag body (not its editable span or
            // delete button) may be a drag start — let it propagate.
            // Other interactive elements have their own handlers.
            if (
                target.closest("dataset-tag") &&
                !target.closest("span[contenteditable]") &&
                !target.closest(".delete-tag")
            ) {
                // fall through
            } else {
                return;
            }
        }

        event.stopPropagation();

        if (
            isShiftPressed &&
            state.globalLastClickedEntryForShiftSelect &&
            state.mainContentAreaElement
        ) {
            const allVisibleEntries = Array.from(
                state.mainContentAreaElement.querySelectorAll(
                    'dataset-entry:not([style*="display: none"])'
                )
            );
            const currentIndex =
                allVisibleEntries.indexOf(clickedEntry);
            const lastIndex = allVisibleEntries.indexOf(
                state.globalLastClickedEntryForShiftSelect
            );

            if (currentIndex !== -1 && lastIndex !== -1) {
                const start = Math.min(currentIndex, lastIndex);
                const end = Math.max(currentIndex, lastIndex);

                if (!isCtrlPressed) {
                    for (const entry of state.mainContentAreaElement.querySelectorAll(
                        "dataset-entry[selected]"
                    )) {
                        entry.selected = false;
                    }
                }

                for (let i = start; i <= end; i++) {
                    if (allVisibleEntries[i]) {
                        allVisibleEntries[i].selected = true;
                    }
                }
            } else {
                clickedEntry.selected = !wasSelected;
                state.globalLastClickedEntryForShiftSelect =
                    clickedEntry.selected ? clickedEntry : null;
            }
        } else if (isCtrlPressed) {
            clickedEntry.selected = !wasSelected;
            if (clickedEntry.selected) {
                state.globalLastClickedEntryForShiftSelect = clickedEntry;
            } else if (
                state.globalLastClickedEntryForShiftSelect ===
                clickedEntry
            ) {
                state.globalLastClickedEntryForShiftSelect = null;
            }
        } else {
            const currentlySelected =
                opentaggerAPI.getSelectedEntries();
            const isAlreadySolelySelected =
                currentlySelected.length === 1 &&
                currentlySelected[0] === clickedEntry;

            if (isAlreadySolelySelected && wasSelected) {
                clickedEntry.selected = false;
                state.globalLastClickedEntryForShiftSelect = null;
            } else {
                for (const entry of currentlySelected) {
                    entry.selected = false;
                }
                clickedEntry.selected = true;
                state.globalLastClickedEntryForShiftSelect = clickedEntry;
            }
        }
    }

    _handleContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        const entry = this;
        const targetEntries = entry.selected
            ? opentaggerAPI.getSelectedEntries()
            : [entry];
        const targetCount = targetEntries.length;

        const contextMenuItems = [
            {
                label: "Preview Image",
                callback: () => entry._handleImageClick(e),
            },
            {
                label: "Autotag Image (AI)",
                callback: () => entry.triggerAutotag(false),
            },
            { type: "divider" },
            {
                label: `Copy Tags (${targetCount} selected)`,
                notImplemented: true,
            },
            {
                label: `Paste Tags (${targetCount} selected)`,
                notImplemented: true,
            },
            { type: "divider" },
            {
                label: `Add Tags to ${targetCount} Selected…`,
                notImplemented:
                    "Adding tags to a selection has no dialog yet. " +
                    "Meanwhile: open the developer console (F1) and use " +
                    "/select <query> followed by /add <tag1>, <tag2>, …",
            },
            {
                label: `Remove Tags from ${targetCount} Selected…`,
                notImplemented:
                    "Removing tags from a selection has no dialog yet. " +
                    "Meanwhile: open the developer console (F1) and use " +
                    "/select <query> followed by /remove <tag1>, <tag2>, … " +
                    "(or /remove * for all).",
            },
            { type: "divider" },
            {
                label: "Apply Group Tags",
                items: getGroupSubmenuItems(targetEntries),
                disabled: () => targetCount === 0,
            },
            { type: "divider" },
            {
                label: "Check Requirements",
                callback: () =>
                    entry.checkGroupRequirementsAndUpdateVisuals(),
            },
            { type: "divider" },
            {
                label: "Delete Entry",
                callback: () => entry.deleteEntry(),
            },
        ];

        if (targetCount > 1) {
            contextMenuItems.push({ type: "divider" });
            contextMenuItems.push({
                label: `Delete ${targetCount} Selected Entries`,
                callback: () => {
                    showConfirmationModal(
                        `Are you sure you want to delete ${targetCount} selected entries?`,
                        [
                            {
                                text: "Delete",
                                class: "modal-button-confirm",
                                onClick: () => {
                                    const entriesToDelete = [
                                        ...targetEntries,
                                    ];
                                    for (const en of entriesToDelete)
                                        en.deleteEntry();
                                    state.globalLastClickedEntryForShiftSelect =
                                        null;
                                },
                            },
                            {
                                text: "Cancel",
                                class: "modal-button-cancel",
                            },
                        ]
                    );
                },
                disabled: () => targetCount === 0,
            });
        }

        createContextMenu(contextMenuItems, e);
    }

    _handleImageClick(e) {
        e.stopPropagation();
        if (this.imageSrc) {
            showImagePreviewModal(
                this.imageSrc,
                this.originalImageName
            );
        }
    }
    deleteEntry() {
        const img = this.querySelector("img");
        if (img?.src.startsWith("blob:") && URL.revokeObjectURL) {
            URL.revokeObjectURL(img.src);
        }
        this.remove();
        this.dispatchEvent(
            new CustomEvent("entry-deleted", { bubbles: true })
        );
    }
    async _handleAutotagClick(e) {
        e.stopPropagation();
        if (!(await ensureAutotagReady())) return;
        await this.triggerAutotag(false);
    }
    async triggerAutotag(silent = false) {
        const autotagButton = this.querySelector(".autotag-entry");
        const buttonWrapper = this.querySelector(".entry-buttons");

        if (!autotagButton) {
            console.error(
                `Autotag button not found for ${this.originalImageName}.`
            );
            return {
                success: false,
                message: "Autotag button not found.",
                tagsAddedCount: 0,
                elapsedTime: 0,
            };
        }
        if (!buttonWrapper && !silent) {
            console.error(
                `Button wrapper not found for ${this.originalImageName} for timer placement.`
            );
        }

        // A disabled button only blocks user-initiated runs — the
        // batch flow disables all entry buttons while it works and
        // calls us silently. Double-runs on the same entry are
        // prevented by the in-flight flag instead.
        if (this._autotagInFlight || (!silent && autotagButton.disabled)) {
            if (!silent) {
                console.warn(
                    `Autotag for ${this.originalImageName} skipped (already running or disabled).`
                );
            }
            return {
                success: false,
                message: this._autotagInFlight
                    ? "Autotag already in progress for this entry."
                    : "Autotag action disabled.",
                tagsAddedCount: 0,
                elapsedTime: 0,
            };
        }
        this._autotagInFlight = true;

        let timer = null;
        let timerLabel = null;
        let operationResult = {
            success: false,
            message: "Operation not fully completed.",
            tagsAddedCount: 0,
            elapsedTime: 0,
        };

        if (!silent && buttonWrapper) {
            buttonWrapper
                .querySelector(".autotag-timer-label")
                ?.remove();
            timerLabel = createTimerLabelElement();
            buttonWrapper.appendChild(timerLabel);
            timer = startTimer((timeString) => {
                if (timerLabel) timerLabel.textContent = timeString;
            }, 100);
        }

        const originalIcon = autotagButton.textContent;
        const originalTitle = autotagButton.getAttribute("title");

        autotagButton.disabled = true;
        if (!silent) {
            autotagButton.textContent = "sync";
            autotagButton.setAttribute(
                "title",
                "Autotagging in progress..."
            );
            autotagButton.classList.add("loading");
        }

        try {
            const imageData = await this.getImageData();
            if (!imageData) {
                throw new Error(
                    "No image data available for autotagging."
                );
            }

            const result = await autotagImage(
                imageData,
                this.originalImageName || "image.png"
            );
            const tags = result.tags;
            let tagsAddedCount = 0;

            if (Array.isArray(tags)) {
                for (const tag of tags) {
                    if (this.addTag(tag)) {
                        tagsAddedCount++;
                    }
                }
                if (!silent) {
                    console.log(
                        `Autotag for ${
                            this.originalImageName || "untitled"
                        } complete. ${tagsAddedCount} new tag(s) added. Total AI tags: ${
                            tags.length
                        }.`
                    );
                }
                operationResult = {
                    success: true,
                    tagsAddedCount: tagsAddedCount,
                    totalAiTags: tags.length,
                    elapsedTime: 0,
                };
            } else {
                throw new Error(
                    "Autotagger returned an unexpected response format."
                );
            }
        } catch (error) {
            console.error(
                `Autotagging error for ${
                    this.originalImageName || "untitled"
                }:`,
                error
            );
            // fetch throws a TypeError when the server is unreachable.
            const backendDown =
                error instanceof TypeError &&
                /fetch|network/i.test(error.message);
            operationResult = {
                success: false,
                message: backendDown
                    ? "Autotag backend is not running (could not reach localhost:8081)."
                    : error.message,
                tagsAddedCount: 0,
                elapsedTime: 0,
            };
        } finally {
            this._autotagInFlight = false;
            if (timer) {
                operationResult.elapsedTime = timer.stop();
            }
            if (!silent && timerLabel) {
                const finalMessage = operationResult.success
                    ? `Done: ${operationResult.elapsedTime.toFixed(
                          1
                      )}s`
                    : `Error: ${operationResult.elapsedTime.toFixed(
                          1
                      )}s`;
                timerLabel.textContent = finalMessage;
                timerLabel.classList.add("fade-out");
                setTimeout(() => timerLabel.remove(), 2500);
            }

            if (!silent) {
                autotagButton.textContent = originalIcon;
                autotagButton.setAttribute("title", originalTitle);
                autotagButton.classList.remove("loading");
            }

            if (!state.autotagAllButton.classList.contains("loading")) {
                autotagButton.disabled = false;
            }
        }
        return operationResult;
    }
    addDragDropListeners() {
        const tagList = this.querySelector("tag-list");

        this.addEventListener("dragenter", (e) => {
            if (
                state.draggedElement?.tagName === "DATASET-TAG" &&
                tagList
            ) {
                const listRect = tagList.getBoundingClientRect();
                if (
                    e.clientX >= listRect.left &&
                    e.clientX <= listRect.right &&
                    e.clientY >= listRect.top &&
                    e.clientY <= listRect.bottom
                ) {
                    tagList.classList.add("drag-over");
                }
            }
        });

        this.addEventListener("dragover", (e) => {
            if (
                state.draggedElement?.tagName === "DATASET-TAG" &&
                tagList
            ) {
                const listRect = tagList.getBoundingClientRect();
                if (
                    e.clientX >= listRect.left &&
                    e.clientX <= listRect.right &&
                    e.clientY >= listRect.top &&
                    e.clientY <= listRect.bottom
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect =
                        tagList.determineDropEffect(state.draggedElement);
                    tagList.classList.add("drag-over");
                } else {
                    tagList.classList.remove("drag-over");
                }
            } else if (e.dataTransfer.types.includes("Files")) {
            } else {
                e.dataTransfer.dropEffect = "none";
            }
        });

        this.addEventListener("dragleave", (e) => {
            if (
                state.draggedElement?.tagName === "DATASET-TAG" &&
                tagList
            ) {
                const entryRect = this.getBoundingClientRect();
                if (
                    !this.contains(e.relatedTarget) ||
                    e.clientX < entryRect.left ||
                    e.clientX >= entryRect.right ||
                    e.clientY < entryRect.top ||
                    e.clientY >= entryRect.bottom
                ) {
                    tagList.classList.remove("drag-over");
                } else {
                    const listRect =
                        tagList.getBoundingClientRect();
                    if (
                        e.clientX < listRect.left ||
                        e.clientX >= listRect.right ||
                        e.clientY < listRect.top ||
                        e.clientY >= listRect.bottom
                    ) {
                        tagList.classList.remove("drag-over");
                    }
                }
            }
        });

        this.addEventListener("drop", (e) => {
            if (
                state.draggedElement?.tagName === "DATASET-TAG" &&
                tagList
            ) {
                tagList.classList.remove("drag-over");
            } else if (e.dataTransfer.files?.length > 0) {
                tagList?.classList.remove("drag-over");
            } else {
                tagList?.classList.remove("drag-over");
            }
        });
    }
    setImage(blobUrl, fileObject) {
        const img = this.querySelector("img");
        if (
            img?.src.startsWith("blob:") &&
            img.src !== blobUrl &&
            URL.revokeObjectURL
        ) {
            URL.revokeObjectURL(img.src);
        }
        this.imageSrc = blobUrl;
        this.imageData = fileObject;
        this.originalImageName =
            fileObject?.name || `image_${Date.now()}.png`;
        if (img) {
            img.src = this.imageSrc;
            img.alt = this.originalImageName;
            img.title = "Click to preview";
        }
        this.checkGroupRequirementsAndUpdateVisuals();
    }
    async getImageData() {
        if (
            this.imageData instanceof Blob ||
            this.imageData instanceof File
        ) {
            return this.imageData;
        }

        if (
            this.imageSrc.startsWith("data:") ||
            this.imageSrc.startsWith("blob:")
        ) {
            try {
                console.warn(
                    `Attempting to fetch image data from src for ${this.originalImageName}. Direct Blob/File preferred.`
                );
                const response = await fetch(this.imageSrc);
                if (!response.ok)
                    throw new Error(
                        `HTTP error! status: ${response.status}`
                    );
                this.imageData = await response.blob();

                const name =
                    this.originalImageName ||
                    `fetched_image_${Date.now()}.png`;
                if (this.imageData instanceof Blob) {
                    this.imageData = new File(
                        [this.imageData],
                        name,
                        { type: this.imageData.type }
                    );
                } else {
                    console.error(
                        "Fetched data was not a Blob, cannot create File."
                    );
                    return null;
                }
                return this.imageData;
            } catch (e) {
                console.error(
                    `Error fetching image data from src (${this.imageSrc}):`,
                    e
                );
                return null;
            }
        }
        console.error(
            `Could not get image data for entry: ${this.originalImageName}`
        );
        return null;
    }
    addTag(text) {
        const list = this.querySelector("tag-list");
        const added = list ? list.addTag(text) : false;

        return added;
    }
    setTags(tagsArray) {
        const list = this.querySelector("tag-list");
        if (list) {
            list.setTagsFromArray(tagsArray);
        } else {
            console.warn(
                "setTags called on dataset-entry, but internal <tag-list> not found. Tags not set for:",
                this.originalImageName
            );
        }
    }
    getTagsAsString(sep = ", ") {
        const list = this.querySelector("tag-list");
        return list ? list.getTagsAsString(sep) : "";
    }
    getTags() {
        const list = this.querySelector("tag-list");
        return list ? list.getTags() : [];
    }
    getNormalizedTags() {
        return this.getTags().map((tag) => tag.toLowerCase());
    }
    checkGroupRequirements() {
        const groups = document.querySelectorAll(
            "#tag-group-list tag-group"
        );
        const entryTagsLower = this.getNormalizedTags();

        for (const group of groups) {
            const minRequired = group.minimumTags;
            if (minRequired <= 0) continue;

            const groupTagsLower = group
                .getGroupTags()
                .map((t) => t.toLowerCase());
            if (groupTagsLower.length === 0) continue;

            let count = 0;
            for (const entryTag of entryTagsLower) {
                if (groupTagsLower.includes(entryTag)) {
                    count++;
                }
            }
            if (count < minRequired) {
                return false;
            }
        }
        return true;
    }
    checkGroupRequirementsAndUpdateVisuals() {
        const requirementsMet = this.checkGroupRequirements();
        if (requirementsMet) {
            this.classList.remove("requirement-not-met");
        } else {
            this.classList.add("requirement-not-met");
        }
    }
    applyTagHighlighting(searchTerms, termColors) {
        const tagList = this.querySelector("tag-list");
        tagList?.applyHighlightingAndOrder(searchTerms, termColors);
    }
    clearTagHighlighting() {
        const tagList = this.querySelector("tag-list");
        tagList?.clearHighlightingAndOrder();
    }
}
customElements.define("dataset-entry", DatasetEntry);
