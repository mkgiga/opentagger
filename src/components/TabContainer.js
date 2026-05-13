/**
 * ## <tab-container>
 * A web component that provides a tabbed interface for organizing content into panels.
 */
class HTMLTabContainerElement extends HTMLElement {
    static get observedAttributes() {
        return ["active-tab"];
    }

    #tabBar;
    #slot;
    #observer;
    #buttonsByTabId = new Map();
    #panelsByTabId = new Map();
    #activeTabId = null; // Stores the SANITIZED ID of the active tab

    #boundHandleTabBarKeyDown;
    #boundProcessSlottedChildren;
    #boundHandleMutations;

    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          border: var(--tab-container-border, 1px solid #ccc);
          border-radius: var(--tab-container-radius, 0px); /* Adjusted for seamless integration */
          overflow: hidden;
          flex-grow: 1; /* Ensure it can grow if its parent is flex */
          height: 100%; /* Often useful to fill parent height */
        }
        #tab-bar {
          display: flex;
          flex-wrap: nowrap;
          overflow-x: auto;
          background-color: var(--tab-bar-bg, #f0f0f0);
          border-bottom: var(--tab-bar-border-bottom, 1px solid #ccc);
          scrollbar-width: thin;
          scrollbar-color: var(--tab-bar-scrollbar-thumb-bg, #aaa) var(--tab-bar-scrollbar-track-bg, #f0f0f0);
          flex-shrink: 0; /* Prevent tab bar from shrinking */
        }
        #tab-bar::-webkit-scrollbar { height: 6px; }
        #tab-bar::-webkit-scrollbar-track { background: var(--tab-bar-scrollbar-track-bg, #f0f0f0); }
        #tab-bar::-webkit-scrollbar-thumb {
background-color: var(--tab-bar-scrollbar-thumb-bg, #aaa);
border-radius: 3px;
        }
        #tab-bar button {
          padding: var(--tab-button-padding, 8px 15px);
          border: none;
          background-color: transparent;
          cursor: pointer;
          font-size: var(--tab-button-font-size, 0.9em);
          color: var(--tab-button-color, #333);
          border-right: var(--tab-button-separator, 1px solid #ccc);
          white-space: nowrap;
          transition: background-color 0.2s, color 0.2s, border-color 0.2s;
        }
        #tab-bar button:last-of-type { border-right: none; }
        #tab-bar button:hover {
          background-color: var(--tab-button-bg-hover, #e0e0e0);
          color: var(--tab-button-color-hover, #000);
        }
        #tab-bar button.active {
          background-color: var(--tab-button-bg-active, #fff);
          color: var(--tab-button-color-active, #007bff);
          font-weight: bold;
          border-bottom: 2px solid var(--tab-active-indicator-color, #007bff);
          margin-bottom: -1px; /* Overlap with tab-bar border to connect indicator */
        }
        #tab-bar button:focus-visible {
          outline: 2px solid var(--tab-focus-ring-color, #007bff);
          outline-offset: -2px;
          z-index:1;
        }
        #tab-panels {
          padding: var(--tab-panels-padding, 0); /* Panels manage their own padding */
          flex-grow: 1;
          overflow: hidden; /* Let panels manage their own overflow */
          display: flex; 
          flex-direction: column;
        }
        ::slotted([role="tabpanel"]) { 
display: none; 
width: 100%;
height: 100%;
overflow: hidden; /* Default, panel can override */
flex-grow: 1;
        }
        ::slotted([role="tabpanel"][aria-hidden="false"]) { 
display: flex; /* Use flex for active panel */
/* Panel itself defines its children's layout (e.g. flex-direction: row for tagging) */
        }
      </style>
      <div id="tab-bar" role="tablist" part="tab-bar"></div>
      <div id="tab-panels" part="tab-panels">
        <slot></slot>
      </div>
    `;

        this.#tabBar = this.shadowRoot.querySelector("#tab-bar");
        this.#slot = this.shadowRoot.querySelector("slot");

        this.#boundHandleMutations =
            this.#handleMutations.bind(this);
        this.#boundHandleTabBarKeyDown =
            this.#handleTabBarKeyDown.bind(this);
        this.#boundProcessSlottedChildren =
            this.#processSlottedChildren.bind(this);
    }

    connectedCallback() {
        this.#tabBar.addEventListener(
            "keydown",
            this.#boundHandleTabBarKeyDown
        );
        this.#slot.addEventListener(
            "slotchange",
            this.#boundProcessSlottedChildren
        );

        this.#observer = new MutationObserver(
            this.#boundHandleMutations
        );
        this.#observer.observe(this, {
            childList: true,
            attributes: true,
            attributeOldValue: true,
            subtree: true, // Observe subtree for attribute changes on panels
            attributeFilter: ["tab", "tab-label", "id"], // Added 'id' to track user changes
        });

        this.#processSlottedChildren();
    }

    disconnectedCallback() {
        if (this.#observer) this.#observer.disconnect();
        this.#tabBar.removeEventListener(
            "keydown",
            this.#boundHandleTabBarKeyDown
        );
        this.#slot.removeEventListener(
            "slotchange",
            this.#boundProcessSlottedChildren
        );
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "active-tab" && oldValue !== newValue) {
            const sanitizedNewValue = newValue
                ? this.#sanitizeId(newValue)
                : null;
            if (
                sanitizedNewValue &&
                this.#buttonsByTabId.has(sanitizedNewValue)
            ) {
                this.activateTab(sanitizedNewValue);
            } else if (!sanitizedNewValue && this.#activeTabId) {
                // If active-tab is removed or set to empty, deactivate current tab
                // and let #ensureActiveTab pick a default if available.
                this.activeTab = null;
            }
        }
    }

    #sanitizeId(id) {
        // Sanitize the user-provided 'tab' attribute value for internal use as a key.
        // This does not change the 'tab' attribute itself on the panel.
        return String(id ?? "")
            .replace(/[^a-zA-Z0-9_-]+/g, "_")
            .replace(/^[^a-zA-Z_]+/, (match) => `_${match}`);
    }

    #handleMutations(mutationsList) {
        let tabsStructureChanged = false;

        for (const mutation of mutationsList) {
            if (
                mutation.type === "childList" &&
                mutation.target === this
            ) {
                // Direct children added/removed
                mutation.addedNodes.forEach((node) => {
                    if (
                        node.nodeType === Node.ELEMENT_NODE &&
                        node.hasAttribute("tab") &&
                        node.hasAttribute("tab-label")
                    ) {
                        this.#addTab(node);
                        tabsStructureChanged = true;
                    }
                });
                mutation.removedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const tabIdAttr = node.getAttribute("tab");
                        if (tabIdAttr) {
                            this.#removeTab(
                                this.#sanitizeId(tabIdAttr)
                            ); // Use sanitized ID for removal
                            tabsStructureChanged = true;
                        }
                    }
                });
            } else if (
                mutation.type === "attributes" &&
                mutation.target.parentElement === this
            ) {
                // Attributes changed on direct children
                const panelElement = mutation.target;
                const tabIdAttr = panelElement.getAttribute("tab");
                const sanitizedCurrentTabId = tabIdAttr
                    ? this.#sanitizeId(tabIdAttr)
                    : null;

                if (mutation.attributeName === "tab") {
                    const oldTabIdAttr = mutation.oldValue;
                    if (oldTabIdAttr)
                        this.#removeTab(
                            this.#sanitizeId(oldTabIdAttr)
                        );
                    if (panelElement.hasAttribute("tab-label")) {
                        // Only add if it's a valid tab panel
                        this.#addTab(panelElement);
                    }
                    tabsStructureChanged = true;
                } else if (mutation.attributeName === "tab-label") {
                    if (sanitizedCurrentTabId)
                        this.#updateTabLabel(
                            sanitizedCurrentTabId,
                            panelElement.getAttribute("tab-label")
                        );
                } else if (mutation.attributeName === "id") {
                    // If user changes panel's ID, we might need to update aria-controls if we were using it.
                    // The current #addTab logic prefers user's ID, so this should be less of an issue.
                    // Re-processing the tab might be safest if its ID changes.
                    if (
                        sanitizedCurrentTabId &&
                        this.#panelsByTabId.has(
                            sanitizedCurrentTabId
                        )
                    ) {
                        const button = this.#buttonsByTabId.get(
                            sanitizedCurrentTabId
                        );
                        if (button)
                            button.setAttribute(
                                "aria-controls",
                                panelElement.id ||
                                    `panel-for-${button.id}`
                            );
                    }
                }
            }
        }

        if (tabsStructureChanged) {
            this.#ensureActiveTab();
        }
    }

    #processSlottedChildren() {
        const currentSlottedPanels = this.#slot
            .assignedElements({ flatten: true })
            .filter(
                (el) =>
                    el.nodeType === Node.ELEMENT_NODE &&
                    el.hasAttribute("tab") &&
                    el.hasAttribute("tab-label")
            );

        // Add new tabs
        for (const panel of currentSlottedPanels) {
            const tabIdAttr = panel.getAttribute("tab");
            // Use sanitized ID for internal map keys
            if (
                tabIdAttr &&
                !this.#buttonsByTabId.has(
                    this.#sanitizeId(tabIdAttr)
                )
            ) {
                this.#addTab(panel);
            }
        }

        // Remove tabs that are no longer in the slot
        const currentSanitizedIdsInSlot = new Set(
            currentSlottedPanels.map((p) =>
                this.#sanitizeId(p.getAttribute("tab"))
            )
        );
        for (const internalSanitizedId of this.#buttonsByTabId.keys()) {
            if (
                !currentSanitizedIdsInSlot.has(internalSanitizedId)
            ) {
                this.#removeTab(internalSanitizedId);
            }
        }
        this.#ensureActiveTab();
    }

    #ensureActiveTab() {
        const hostActiveTabAttr = this.getAttribute("active-tab"); // User-provided 'tab' attribute value
        const sanitizedHostActiveTab = hostActiveTabAttr
            ? this.#sanitizeId(hostActiveTabAttr)
            : null;

        if (
            sanitizedHostActiveTab &&
            this.#buttonsByTabId.has(sanitizedHostActiveTab)
        ) {
            if (this.#activeTabId !== sanitizedHostActiveTab) {
                this.activateTab(sanitizedHostActiveTab, false);
            }
        } else if (
            !this.#activeTabId &&
            this.#buttonsByTabId.size > 0
        ) {
            // Activate the first tab if no active tab is set and there are tabs
            this.activateTab(
                this.#buttonsByTabId.keys().next().value,
                false
            );
        } else if (
            this.#activeTabId &&
            !this.#buttonsByTabId.has(this.#activeTabId)
        ) {
            // If current active tab was removed, try to activate another or clear
            this.#activeTabId = null;
            if (this.#buttonsByTabId.size > 0) {
                this.activateTab(
                    this.#buttonsByTabId.keys().next().value,
                    false
                );
            } else {
                // No tabs left, ensure host attribute is cleared
                if (this.getAttribute("active-tab"))
                    this.removeAttribute("active-tab");
            }
        } else if (!hostActiveTabAttr && this.#activeTabId) {
            // Host attribute was removed, but an internal tab is still active.
            // This case might imply deselecting all, or re-syncing host attribute.
            // For now, let's assume if host attribute is removed, we try to pick a default or clear.
            // This is mostly handled by the `this.activeTab = null` in attributeChangedCallback.
        }
    }

    #addTab(panelElement) {
        const userTabIdAttr = panelElement.getAttribute("tab"); // e.g., "tagging"
        const tabLabel = panelElement.getAttribute("tab-label");

        if (!userTabIdAttr || typeof tabLabel !== "string") return;

        // Internal key for maps, based on the user's 'tab' attribute.
        const sanitizedInternalKey =
            this.#sanitizeId(userTabIdAttr);

        if (this.#buttonsByTabId.has(sanitizedInternalKey)) {
            this.#updateTabLabel(sanitizedInternalKey, tabLabel);
            this.#panelsByTabId.set(
                sanitizedInternalKey,
                panelElement
            ); // Ensure panel reference is up-to-date
            return;
        }

        const button = document.createElement("button");
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", "false");
        button.tabIndex = -1; // Initially not focusable until active

        // Button ID needs to be unique and stable for ARIA
        const buttonGeneratedId = `tab-btn-${sanitizedInternalKey}-${Math.random()
            .toString(36)
            .slice(2, 7)}`;
        button.id = buttonGeneratedId;
        button.textContent = tabLabel;
        button.addEventListener("click", () =>
            this.activateTab(sanitizedInternalKey)
        );

        // Determine the panel's ID for ARIA attributes
        // Prefer user-defined ID on the panelElement, otherwise generate one.
        let panelActualId = panelElement.id;
        if (!panelActualId) {
            panelActualId = `panel-content-${sanitizedInternalKey}-${Math.random()
                .toString(36)
                .slice(2, 7)}`;
            panelElement.id = panelActualId; // Assign generated ID if panel didn't have one
        }

        button.setAttribute("aria-controls", panelActualId);

        this.#tabBar.appendChild(button);
        this.#buttonsByTabId.set(sanitizedInternalKey, button);
        this.#panelsByTabId.set(sanitizedInternalKey, panelElement);

        panelElement.setAttribute("role", "tabpanel");
        panelElement.setAttribute(
            "aria-labelledby",
            buttonGeneratedId
        );
        panelElement.setAttribute("aria-hidden", "true"); // Initially hidden
    }

    #removeTab(sanitizedInternalKey) {
        const button =
            this.#buttonsByTabId.get(sanitizedInternalKey);
        if (button) {
            button.remove();
            this.#buttonsByTabId.delete(sanitizedInternalKey);
        }
        const panel = this.#panelsByTabId.get(sanitizedInternalKey);
        if (panel) {
            // Don't remove user-set ID, just ARIA roles if they were set by this component
            panel.removeAttribute("role");
            // panel.removeAttribute('id'); // NO! Keep user's ID or generated one if we set it.
            panel.removeAttribute("aria-labelledby");
            panel.setAttribute("aria-hidden", "true"); // Ensure it's hidden
            this.#panelsByTabId.delete(sanitizedInternalKey);
        }

        if (this.#activeTabId === sanitizedInternalKey) {
            this.#activeTabId = null;
            // #ensureActiveTab will handle selecting a new default if necessary
        }
    }

    #updateTabLabel(sanitizedInternalKey, newLabel) {
        const button =
            this.#buttonsByTabId.get(sanitizedInternalKey);
        if (button && button.textContent !== newLabel) {
            button.textContent = newLabel;
        }
    }

    activateTab(sanitizedTabIdToActivate, focusButton = true) {
        if (
            !sanitizedTabIdToActivate ||
            !this.#buttonsByTabId.has(sanitizedTabIdToActivate)
        ) {
            // If the target tab doesn't exist, try to activate the first available one.
            if (this.#buttonsByTabId.size > 0) {
                const firstTabKey = this.#buttonsByTabId
                    .keys()
                    .next().value;
                if (this.#activeTabId !== firstTabKey)
                    this.activateTab(firstTabKey, focusButton);
            } else {
                // No tabs to activate, clear active state
                if (this.#activeTabId) {
                    const oldButton = this.#buttonsByTabId.get(
                        this.#activeTabId
                    );
                    const oldPanel = this.#panelsByTabId.get(
                        this.#activeTabId
                    );
                    if (oldButton) {
                        oldButton.classList.remove("active");
                        oldButton.setAttribute(
                            "aria-selected",
                            "false"
                        );
                        oldButton.tabIndex = -1;
                    }
                    if (oldPanel)
                        oldPanel.setAttribute(
                            "aria-hidden",
                            "true"
                        );
                }
                this.#activeTabId = null;
                if (this.getAttribute("active-tab"))
                    this.removeAttribute("active-tab");
            }
            return;
        }

        if (this.#activeTabId === sanitizedTabIdToActivate) {
            const currentButton = this.#buttonsByTabId.get(
                sanitizedTabIdToActivate
            );
            if (
                focusButton &&
                currentButton &&
                document.activeElement !== currentButton
            ) {
                currentButton.focus();
            }
            return; // Already active
        }

        // Deactivate previously active tab
        if (this.#activeTabId) {
            const oldActiveButton = this.#buttonsByTabId.get(
                this.#activeTabId
            );
            const oldActivePanel = this.#panelsByTabId.get(
                this.#activeTabId
            );
            if (oldActiveButton) {
                oldActiveButton.classList.remove("active");
                oldActiveButton.setAttribute(
                    "aria-selected",
                    "false"
                );
                oldActiveButton.tabIndex = -1;
            }
            if (oldActivePanel)
                oldActivePanel.setAttribute("aria-hidden", "true");
        }

        // Activate new tab
        const newActiveButton = this.#buttonsByTabId.get(
            sanitizedTabIdToActivate
        );
        const newActivePanel = this.#panelsByTabId.get(
            sanitizedTabIdToActivate
        );

        if (newActiveButton && newActivePanel) {
            newActiveButton.classList.add("active");
            newActiveButton.setAttribute("aria-selected", "true");
            newActiveButton.tabIndex = 0; // Make active tab focusable
            newActivePanel.setAttribute("aria-hidden", "false");

            this.#activeTabId = sanitizedTabIdToActivate;

            // Get the original 'tab' attribute value for the host attribute
            const originalUserProvidedTabId =
                newActivePanel.getAttribute("tab");
            if (
                this.getAttribute("active-tab") !==
                originalUserProvidedTabId
            ) {
                this.setAttribute(
                    "active-tab",
                    originalUserProvidedTabId
                );
            }

            if (focusButton) newActiveButton.focus();
            newActiveButton.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
                inline: "nearest",
            });

            this.dispatchEvent(
                new CustomEvent("tab-change", {
                    bubbles: true,
                    composed: true,
                    detail: {
                        activeTabId: originalUserProvidedTabId, // Dispatch user-provided ID
                        relatedPanel: newActivePanel,
                    },
                })
            );
        }
    }

    #handleTabBarKeyDown(event) {
        const buttons = Array.from(
            this.#tabBar.querySelectorAll('button[role="tab"]')
        );
        if (buttons.length === 0) return;

        let currentIndex = buttons.findIndex(
            (btn) => btn.getAttribute("aria-selected") === "true"
        );

        // If no tab is selected (e.g., on init before first activation), default to first for arrow keys
        if (currentIndex === -1 && buttons.length > 0)
            currentIndex = 0;

        let newIndex = currentIndex;
        let shouldPreventDefault = true;

        switch (event.key) {
            case "ArrowLeft":
                newIndex =
                    (currentIndex - 1 + buttons.length) %
                    buttons.length;
                break;
            case "ArrowRight":
                newIndex = (currentIndex + 1) % buttons.length;
                break;
            case "Home":
                newIndex = 0;
                break;
            case "End":
                newIndex = buttons.length - 1;
                break;
            default:
                shouldPreventDefault = false;
                return; // Do not interfere with other keys
        }

        if (shouldPreventDefault) event.preventDefault();

        // Find the sanitized key corresponding to the new button to activate
        const newButtonToActivate = buttons[newIndex];
        // We need to find the sanitizedInternalKey associated with this button.
        // This is a bit indirect; ideally, the button would store its sanitized key.
        let targetSanitizedKey = null;
        for (const [key, btn] of this.#buttonsByTabId.entries()) {
            if (btn === newButtonToActivate) {
                targetSanitizedKey = key;
                break;
            }
        }
        if (targetSanitizedKey) {
            this.activateTab(targetSanitizedKey); // activateTab handles focus
        }
    }

    /**
     * Gets the user-provided 'tab' attribute value of the currently active tab.
     * @returns {string | null}
     */
    get activeTab() {
        return this.#activeTabId
            ? this.#panelsByTabId
                  .get(this.#activeTabId)
                  ?.getAttribute("tab")
            : null;
    }

    /**
     * Sets the active tab using its user-provided 'tab' attribute value.
     * @param {string | null} userTabIdAttr - The 'tab' attribute value of the panel to activate.
     */
    set activeTab(userTabIdAttr) {
        if (userTabIdAttr) {
            const sanitizedId = this.#sanitizeId(userTabIdAttr);
            if (this.#buttonsByTabId.has(sanitizedId)) {
                this.activateTab(sanitizedId);
            } else {
                console.warn(
                    `Tab with id "${userTabIdAttr}" (sanitized: "${sanitizedId}") not found.`
                );
            }
        } else if (this.#activeTabId) {
            // Deactivate current tab if setting to null/empty
            const oldActiveButton = this.#buttonsByTabId.get(
                this.#activeTabId
            );
            const oldActivePanel = this.#panelsByTabId.get(
                this.#activeTabId
            );
            if (oldActiveButton) {
                oldActiveButton.classList.remove("active");
                oldActiveButton.setAttribute(
                    "aria-selected",
                    "false"
                );
                oldActiveButton.tabIndex = -1;
            }
            if (oldActivePanel)
                oldActivePanel.setAttribute("aria-hidden", "true");

            this.#activeTabId = null;
            if (this.getAttribute("active-tab"))
                this.removeAttribute("active-tab");
            // #ensureActiveTab might pick a new default if one is available
            this.#ensureActiveTab();
        }
    }
}

customElements.define("tab-container", HTMLTabContainerElement);
