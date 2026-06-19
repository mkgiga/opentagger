class AutocompleteDropdown extends HTMLElement {
    constructor() {
        super();
        this._targetElement = null;
        this._suggestions = [];
        this._selectedIndex = -1;
        this._boundHandleDocumentClick =
            this._handleDocumentClick.bind(this);
        this._boundHandleKeyDownPassthrough =
            this._handleKeyDownPassthrough.bind(this);
    }

    show(suggestions, targetElement) {
        this._targetElement = targetElement;
        this._suggestions = suggestions;
        this._selectedIndex = -1;
        this.innerHTML = "";

        if (
            !this._targetElement ||
            !this._suggestions ||
            this._suggestions.length === 0
        ) {
            this.hide();
            return;
        }

        this._suggestions.forEach((suggestion, index) => {
            const item = document.createElement("div");
            item.classList.add("suggestion-item");
            item.dataset.index = index;

            const nameSpan = document.createElement("span");
            nameSpan.classList.add("tag-name");
            nameSpan.textContent = suggestion.name;
            item.appendChild(nameSpan);

            const countSpan = document.createElement("span");
            countSpan.classList.add("tag-count");
            countSpan.textContent = `(${suggestion.count.toLocaleString()})`;
            item.appendChild(countSpan);

            item.addEventListener("mousedown", (e) => {
                e.preventDefault();
                this._selectItem(index);
            });
            this.appendChild(item);
        });

        // --- Positioning Logic ---
        const currentTargetRect =
            this._targetElement.getBoundingClientRect();
        const dropdown = this;

        // Set minWidth based on target before measuring dropdown.
        // The dropdown has `box-sizing: border-box` due to global `*` rule.
        dropdown.style.minWidth = `${currentTargetRect.width}px`;

        // Temporarily make it visible for measurement, but out of sight.
        dropdown.style.visibility = "hidden";
        dropdown.style.position = "absolute"; // Ensure it's absolute for correct measurement context
        dropdown.style.display = "flex"; // Apply styles that affect size (from .visible class)
        dropdown.style.left = "-9999px"; // Move off-screen
        dropdown.style.top = "-9999px";

        // Get actual dimensions of the dropdown
        const dropdownMeasuredRect =
            dropdown.getBoundingClientRect();
        const dropdownWidth = dropdownMeasuredRect.width;
        const dropdownHeight = dropdownMeasuredRect.height;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const margin = 5; // Small margin from viewport edges
        const verticalOffset = 2; // Small offset from the target element

        let finalTopViewportRelative, finalLeftViewportRelative;

        // Determine vertical position
        // Candidate 1: Below target (preferred)
        let topIfBelow = currentTargetRect.bottom + verticalOffset;
        let fitsBelow =
            topIfBelow + dropdownHeight + margin <= viewportHeight;

        // Candidate 2: Above target
        let topIfAbove =
            currentTargetRect.top - dropdownHeight - verticalOffset;
        let fitsAbove = topIfAbove >= margin; // Check against top margin

        if (fitsBelow) {
            finalTopViewportRelative = topIfBelow;
        } else if (fitsAbove) {
            finalTopViewportRelative = topIfAbove;
        } else {
            // Neither fits: show below if the target is in the top half
            // of the viewport, above otherwise (clamped later).
            if (currentTargetRect.top < viewportHeight / 2) {
                finalTopViewportRelative = topIfBelow;
            } else {
                finalTopViewportRelative = topIfAbove;
            }
        }

        // Determine horizontal position
        finalLeftViewportRelative = currentTargetRect.left; // Default: align left edges
        if (
            finalLeftViewportRelative + dropdownWidth + margin >
            viewportWidth
        ) {
            // Overflowing right, try aligning to target's right edge
            finalLeftViewportRelative =
                currentTargetRect.right - dropdownWidth;
            // If aligning to target's right still makes it overflow left (e.g. target wider than dropdown and near left edge)
            // or if dropdown is wider than target and aligning target's right pushes it left:
            if (finalLeftViewportRelative < margin) {
                finalLeftViewportRelative =
                    viewportWidth - dropdownWidth - margin; // Align to viewport's right edge
            }
        }
        // Ensure it doesn't overflow left edge of viewport
        if (finalLeftViewportRelative < margin) {
            finalLeftViewportRelative = margin;
        }

        // Final clamping to ensure it's strictly within viewport boundaries (accounts for extreme cases)
        finalTopViewportRelative = Math.max(
            margin,
            Math.min(
                finalTopViewportRelative,
                viewportHeight - dropdownHeight - margin
            )
        );
        finalLeftViewportRelative = Math.max(
            margin,
            Math.min(
                finalLeftViewportRelative,
                viewportWidth - dropdownWidth - margin
            )
        );

        // Convert viewport-relative coordinates to document-relative for absolute positioning
        // (since the dropdown is a child of body or similarly high-level container)
        dropdown.style.top = `${
            finalTopViewportRelative + window.scrollY
        }px`;
        dropdown.style.left = `${
            finalLeftViewportRelative + window.scrollX
        }px`;

        // Make it truly visible at the calculated position
        dropdown.style.visibility = "visible";
        dropdown.classList.add("visible"); // This also ensures display:flex

        // --- End Positioning Logic ---

        setTimeout(() => {
            document.addEventListener(
                "click",
                this._boundHandleDocumentClick,
                true
            );
        }, 0);

        if (
            this._targetElement &&
            typeof this._targetElement.addEventListener ===
                "function"
        ) {
            this._targetElement.addEventListener(
                "keydown",
                this._boundHandleKeyDownPassthrough,
                true
            );
        }

        if (
            this._suggestions.length > 0 &&
            this._selectedIndex === -1
        ) {
            // Select first item if none selected
            this._selectedIndex = 0;
            this._updateSelectionVisuals();
        }
    }

    hide() {
        if (!this.classList.contains("visible")) return;

        this.classList.remove("visible");
        this.style.visibility = "hidden"; // Ensure it's hidden
        this.style.display = "none"; // And not taking up space

        document.removeEventListener(
            "click",
            this._boundHandleDocumentClick,
            true
        );

        if (
            this._targetElement &&
            typeof this._targetElement.removeEventListener ===
                "function"
        ) {
            this._targetElement.removeEventListener(
                "keydown",
                this._boundHandleKeyDownPassthrough,
                true
            );
        }
        // _targetElement is intentionally left set; show() resets it.
        this.dispatchEvent(new CustomEvent("dropdown-hidden"));
    }

    _handleDocumentClick(event) {
        if (
            !this.contains(event.target) &&
            event.target !== this._targetElement
        ) {
            this.hide();
        }
    }

    _handleKeyDownPassthrough(event) {
        if (!this.classList.contains("visible")) return;

        switch (event.key) {
            case "ArrowUp":
                event.preventDefault();
                event.stopPropagation();
                this._navigate(-1);
                break;
            case "ArrowDown":
                event.preventDefault();
                event.stopPropagation();
                this._navigate(1);
                break;
            case "Enter":
            case "Tab":
                if (this._selectedIndex !== -1) {
                    event.preventDefault();
                    event.stopPropagation();
                    this._selectItem(this._selectedIndex);
                } else {
                    // Accepting the raw input text is handled by the
                    // input itself; just hide.
                    this.hide();
                }
                break;
            case "Escape":
                // Dismiss only the suggestions; the edit stays active.
                // A second Escape (dropdown closed) reaches the input's
                // own handler, which cancels the edit.
                event.preventDefault();
                event.stopPropagation();
                this.hide();
                break;
        }
    }

    _navigate(direction) {
        if (this._suggestions.length === 0) return;
        const newIndex = this._selectedIndex + direction;
        if (newIndex >= 0 && newIndex < this._suggestions.length) {
            this._selectedIndex = newIndex;
        } else if (newIndex < 0) {
            this._selectedIndex = this._suggestions.length - 1; // wrap to last
        } else if (newIndex >= this._suggestions.length) {
            this._selectedIndex = 0; // wrap to first
        }
        this._updateSelectionVisuals();
    }

    _updateSelectionVisuals() {
        this.querySelectorAll(".suggestion-item").forEach(
            (item, idx) => {
                if (idx === this._selectedIndex) {
                    item.classList.add("selected");
                    // Ensure the selected item is visible within the scrollable dropdown
                    item.scrollIntoView({
                        block: "nearest",
                        inline: "nearest",
                    });
                } else {
                    item.classList.remove("selected");
                }
            }
        );
    }

    _selectItem(index) {
        if (index >= 0 && index < this._suggestions.length) {
            const selectedSuggestion = this._suggestions[index];
            // Let the DatasetTag (or other listener) handle the selected suggestion
            this.dispatchEvent(
                new CustomEvent("suggestion-selected", {
                    detail: selectedSuggestion,
                })
            );
            this.hide();
        }
    }
}
customElements.define(
    "autocomplete-dropdown",
    AutocompleteDropdown
);
