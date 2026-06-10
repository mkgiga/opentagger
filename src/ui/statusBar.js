// Bottom status bar: a persistent status label on the left and an
// optional progress readout (label + bar) on the right.

export function setStatus(text) {
    const label = document.getElementById("status-bar-label");
    if (label) label.textContent = text;
}

/**
 * Show the progress readout. Pass a number 0-100 for a determinate
 * bar, or null for an indeterminate animation.
 */
export function showProgress(label, percent = null) {
    const wrap = document.getElementById("status-bar-progress");
    if (!wrap) return;
    wrap.classList.remove("hidden");

    const labelEl = document.getElementById(
        "status-bar-progress-label"
    );
    if (labelEl) labelEl.textContent = label;

    const fill = wrap.querySelector(".progress-fill");
    if (percent === null) {
        wrap.classList.add("indeterminate");
        if (fill) fill.style.width = "";
    } else {
        wrap.classList.remove("indeterminate");
        if (fill)
            fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
}

export function hideProgress() {
    const wrap = document.getElementById("status-bar-progress");
    if (!wrap) return;
    wrap.classList.add("hidden");
    wrap.classList.remove("indeterminate");
}
