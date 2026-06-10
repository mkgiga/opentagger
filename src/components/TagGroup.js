import { getTagText } from "../utils/dom.js";
import { createContextMenu } from "../ui/contextMenu.js";

class TagGroup extends HTMLElement {
    constructor() {
        super();
        this._minimumTags = 0;
        this._boundUpdateMinTags = this._updateMinTags.bind(this);
        this._boundHandleContextMenu =
            this._handleContextMenu.bind(this);
    }
    static observedAttributes = ["group-name"];
    get minimumTags() {
        return this._minimumTags;
    }
    set minimumTags(value) {
        const newMin = Math.max(0, parseInt(value, 10) || 0);
        if (newMin !== this._minimumTags) {
            this._minimumTags = newMin;
            this.updateMinTagsDisplay();

            document.dispatchEvent(
                new CustomEvent("group-min-tags-changed", {
                    detail: { group: this },
                })
            );
        }
    }
    connectedCallback() {
        const name = this.getAttribute("group-name") || "New Group";
        const tags = Array.from(
            this.querySelectorAll("dataset-tag")
        );
        this.innerHTML = `
<div class="group-header">
    <span class="group-name" contenteditable="true">${name}</span>
     <div class="min-tags-control">
         <span>Min:</span>
         <button class="min-tags-decrement material-icons" speaker="Decrease Minimum Tags">remove</button>
         <span class="min-tags-value">0</span>
         <button class="min-tags-increment material-icons" speaker="Increase Minimum Tags">add</button>
     </div>
     <button class="btn-new-tag material-icons" speaker="Add New Tag">add_circle_outline</button>
</div>
 <tag-list direction="column"></tag-list>
 <button class="delete-group material-icons" speaker="Delete Group">delete</button>`;
        this.style.position = "relative";

        const delBtn = this.querySelector(".delete-group");
        delBtn.style.cssText = `position: absolute; bottom: 5px; right: 5px; background: none; border: none; cursor: pointer; color: #aaa; font-size: 18px;`;
        delBtn.addEventListener("click", () => {
            this.remove();

            document.dispatchEvent(
                new CustomEvent("group-min-tags-changed", {
                    detail: { group: null },
                })
            );
        });

        const list = this.querySelector("tag-list");

        for (const t of tags) {
            list.appendChild(t);
        }
        this.addEventListeners();
        this.updateMinTagsDisplay();
    }
    disconnectedCallback() {}
    attributeChangedCallback(name, oldV, newV) {
        if (name === "group-name") {
            const s = this.querySelector(".group-name");
            if (s) s.textContent = newV;
        }
    }
    addEventListeners() {
        const addBtn = this.querySelector(".btn-new-tag");
        const list = this.querySelector("tag-list");
        const nameSpan = this.querySelector(".group-name");
        const incBtn = this.querySelector(".min-tags-increment");
        const decBtn = this.querySelector(".min-tags-decrement");

        if (addBtn && list) {
            addBtn.addEventListener("click", () => {
                const added = list.addTag("new_tag");
                if (added) {
                    const tagElements =
                        list.querySelectorAll("dataset-tag");
                    const tag = tagElements[tagElements.length - 1];
                    if (tag) {
                        const s = tag.querySelector(
                            "span[contenteditable]"
                        );
                        if (s) {
                            s.setAttribute(
                                "contenteditable",
                                "true"
                            );
                            tag._originalText = getTagText(tag);
                            s.focus();

                            window
                                .getSelection()
                                .selectAllChildren(s);
                        }
                    }
                }
            });
        }
        if (nameSpan) {
            nameSpan.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    nameSpan.blur();
                } else if (e.key === "Escape") {
                    nameSpan.textContent =
                        this.getAttribute("group-name") ||
                        "New Cat";
                    nameSpan.blur();
                }
            });
            nameSpan.addEventListener("blur", () => {
                const n = nameSpan.textContent.trim();
                if (
                    n &&
                    n !==
                        (this.getAttribute("group-name") ||
                            "New Cat")
                ) {
                    this.setAttribute("group-name", n);
                } else {
                    nameSpan.textContent =
                        this.getAttribute("group-name") ||
                        "New Cat";
                }
            });
        }
        incBtn?.addEventListener("click", () =>
            this._updateMinTags(1)
        );
        decBtn?.addEventListener("click", () =>
            this._updateMinTags(-1)
        );

        addBtn?.addEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        incBtn?.addEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        decBtn?.addEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        nameSpan?.addEventListener("mousedown", (e) =>
            e.stopPropagation()
        );

        this.addEventListener(
            "contextmenu",
            this._boundHandleContextMenu
        );
    }
    removeEventListeners() {
        const addBtn = this.querySelector(".btn-new-tag");
        const nameSpan = this.querySelector(".group-name");
        const incBtn = this.querySelector(".min-tags-increment");
        const decBtn = this.querySelector(".min-tags-decrement");

        addBtn?.removeEventListener(
            "click",
            this._handleAddTagButtonClick
        );
        nameSpan?.removeEventListener(
            "keydown",
            this._handleSpanKeyDown
        );
        nameSpan?.removeEventListener("blur", this._handleSpanBlur);
        incBtn?.removeEventListener(
            "click",
            this._boundUpdateMinTags
        );
        decBtn?.removeEventListener(
            "click",
            this._boundUpdateMinTags
        );

        addBtn?.removeEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        incBtn?.removeEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        decBtn?.removeEventListener("mousedown", (e) =>
            e.stopPropagation()
        );
        nameSpan?.removeEventListener("mousedown", (e) =>
            e.stopPropagation()
        );

        this.removeEventListener(
            "contextmenu",
            this._boundHandleContextMenu
        );
    }
    _updateMinTags(delta) {
        this.minimumTags += delta;
    }
    updateMinTagsDisplay() {
        const valueSpan = this.querySelector(".min-tags-value");
        if (valueSpan) {
            valueSpan.textContent = this._minimumTags;
        }
    }
    getGroupTags() {
        const list = this.querySelector("tag-list");
        return list ? list.getTags() : [];
    }
    setTags(tagsArray) {
        const list = this.querySelector("tag-list");
        list?.setTagsFromArray(tagsArray);
    }

    _handleContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        const items = [
            {
                label: "Rename Group (Double Click Name)",
                callback: null,
                disabled: true,
            },
            {
                label: "Add New Tag",
                callback: () =>
                    this.querySelector(".btn-new-tag")?.click(),
            },
            { type: "divider" },
            {
                label: "Delete Group",
                callback: () =>
                    this.querySelector(".delete-group")?.click(),
            },
        ];

        createContextMenu(items, e);
    }
}
customElements.define("tag-group", TagGroup);
