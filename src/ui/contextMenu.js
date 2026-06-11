// Context menu factory.
//
// Builds (and pops up) a <context-menu> populated from a simple item
// list. Item shape:
//   { label, callback?, items?, disabled?, hidden?, dataAction?,
//     type?, notImplemented? }
// Where `type: "divider"` renders an <hr>, `items` makes a submenu,
// and `disabled`/`hidden` may be booleans or predicates over the
// trigger element/event. `notImplemented` marks a planned-but-missing
// feature: the item renders struck through with a tooltip, and
// clicking it explains instead of doing nothing (pass a string for a
// custom explanation).

import { state } from "../core/state.js";
import { showConfirmationModal } from "./modal.js";

function applyNotImplemented(menuItem, item) {
    menuItem.classList.add("not-implemented");
    menuItem.title = "Not implemented yet";
    menuItem.callback = () =>
        showConfirmationModal(
            typeof item.notImplemented === "string"
                ? item.notImplemented
                : `"${item.label}" is not implemented yet — it's planned for a future version.`,
            [{ text: "OK" }]
        );
}

/**
 * Build a list of "Add All from <group>" submenu items so context
 * menus can offer group-tag-application against the target entries.
 */
export function getGroupSubmenuItems(targetEntries) {
    const cats = document.querySelectorAll(
        "#tag-group-list tag-group"
    );
    const items = [];

    for (const cat of cats) {
        const name = cat.getAttribute("group-name") || "...";
        const tags = cat.getGroupTags();
        if (tags.length > 0)
            items.push({
                label: `Add All from "${name}"`,
                callback: () => {
                    for (const entry of targetEntries) {
                        for (const tag of tags) {
                            entry.addTag(tag);
                        }
                    }
                },
            });
    }
    if (items.length === 0)
        items.push({
            label: "(No groups with tags)",
            callback: null,
            disabled: true,
        });
    return items;
}

export function createContextMenu(items, triggerElementOrEvent) {
    state.currentContextMenu?.remove();
    state.currentContextMenu = null;

    const menu = document.createElement("context-menu");

    for (const item of items) {
        if (item.type === "divider") {
            menu.appendChild(document.createElement("hr"));
        } else {
            const menuItem = document.createElement("menu-item");
            menuItem.textContent = item.label || "Item";

            let isHidden = false;
            if (typeof item.hidden === "function") {
                isHidden = item.hidden(triggerElementOrEvent);
            } else if (typeof item.hidden === "boolean") {
                isHidden = item.hidden;
            }
            if (isHidden) {
                menuItem.style.display = "none";
            }

            let isDisabled = false;
            if (typeof item.disabled === "function") {
                isDisabled = item.disabled(triggerElementOrEvent);
            } else if (typeof item.disabled === "boolean") {
                isDisabled = item.disabled;
            }

            if (item.notImplemented) {
                applyNotImplemented(menuItem, item);
            } else if (isDisabled) {
                menuItem.classList.add("disabled");
            } else {
                if (
                    item.callback &&
                    typeof item.callback === "function"
                ) {
                    menuItem.callback = item.callback;
                } else if (!item.items) {
                    menuItem.style.opacity = "0.5";
                    menuItem.style.pointerEvents = "none";
                }
            }

            if (item.dataAction)
                menuItem.dataset.action = item.dataAction;

            if (item.items && item.items.length > 0) {
                const subMenu =
                    document.createElement("context-menu");

                for (const subItem of item.items) {
                    if (subItem.type === "divider") {
                        subMenu.appendChild(
                            document.createElement("hr")
                        );
                    } else {
                        const subMenuItem =
                            document.createElement("menu-item");
                        subMenuItem.textContent =
                            subItem.label || "Sub Item";

                        let isSubHidden = false;
                        if (typeof subItem.hidden === "function") {
                            isSubHidden = subItem.hidden(
                                triggerElementOrEvent
                            );
                        } else if (
                            typeof subItem.hidden === "boolean"
                        ) {
                            isSubHidden = subItem.hidden;
                        }
                        if (isSubHidden) {
                            subMenuItem.style.display = "none";
                        }

                        let isSubDisabled = false;
                        if (
                            typeof subItem.disabled === "function"
                        ) {
                            isSubDisabled = subItem.disabled(
                                triggerElementOrEvent
                            );
                        } else if (
                            typeof subItem.disabled === "boolean"
                        ) {
                            isSubDisabled = subItem.disabled;
                        }

                        if (subItem.notImplemented) {
                            applyNotImplemented(subMenuItem, subItem);
                        } else if (isSubDisabled) {
                            subMenuItem.classList.add("disabled");
                        } else {
                            if (
                                subItem.callback &&
                                typeof subItem.callback ===
                                    "function"
                            ) {
                                subMenuItem.callback =
                                    subItem.callback;
                            } else if (!subItem.items) {
                                subMenuItem.style.opacity = "0.5";
                                subMenuItem.style.pointerEvents =
                                    "none";
                            }
                        }

                        if (subItem.dataAction)
                            subMenuItem.dataset.action =
                                subItem.dataAction;
                        subMenu.appendChild(subMenuItem);
                    }
                }
                menuItem.appendChild(subMenu);
            }
            menu.appendChild(menuItem);
        }
    }

    document.body.appendChild(menu);
    state.currentContextMenu = menu;

    if (triggerElementOrEvent instanceof HTMLElement) {
        state.currentContextMenu._ownerButton = triggerElementOrEvent;
    } else {
        state.currentContextMenu._ownerButton = null;
    }

    if (triggerElementOrEvent instanceof Event) {
        triggerElementOrEvent.preventDefault();
        menu.show(
            triggerElementOrEvent.clientX,
            triggerElementOrEvent.clientY
        );
    } else if (triggerElementOrEvent instanceof HTMLElement) {
        menu.show(0, 0, triggerElementOrEvent);
    }
    return menu;
}
