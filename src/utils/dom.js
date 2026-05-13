// Small DOM helpers reused by multiple components / modules.

/**
 * Read the trimmed text content from a <dataset-tag>. Tags carry their
 * editable text in a child `<span contenteditable>`; fall back to the
 * element's own textContent if that span is missing.
 */
export function getTagText(element) {
    const span = element.querySelector("span[contenteditable]");
    return span
        ? span.textContent.trim()
        : element.textContent.trim();
}

/** Create the pill-shaped timer label shown next to autotag buttons. */
export function createTimerLabelElement() {
    const label = document.createElement("span");
    label.className = "autotag-timer-label";
    label.textContent = "0.0s";
    return label;
}
