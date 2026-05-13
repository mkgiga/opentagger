// Backend autotag I/O.
//
// triggerAutotag for a single entry lives on the <dataset-entry>
// component itself (it owns the loading state). This module hosts
// the cross-cutting helpers: the readiness probe and the batch
// "tag everything visible" command.

import { state } from "../core/state.js";
import { createTimerLabelElement } from "../utils/dom.js";
import { startTimer } from "../utils/timing.js";
import { showConfirmationModal } from "../ui/modal.js";

export async function checkBackendReady(maxRetries = 30, delay = 1000) {
    console.log(
        `Checking backend readiness at ${state.HEALTH_CHECK_URL}...`
    );
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(state.HEALTH_CHECK_URL);
            if (response.ok) {
                const data = await response.json();
                console.log("Python backend is ready:", data);
                return true;
            } else {
                console.warn(
                    `Backend health check failed with status ${
                        response.status
                    }. Attempt ${i + 1}/${maxRetries}.`
                );
            }
        } catch (err) {
            console.warn(
                `Backend not ready yet (attempt ${
                    i + 1
                }/${maxRetries}): ${err.message}. Retrying in ${
                    delay / 1000
                }s...`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
    console.error(
        "Python backend did not become ready after multiple retries."
    );
    return false;
}

export async function handleAutotagAllClick() {
    if (
        !state.mainContentAreaElement ||
        !state.autotagAllButton ||
        state.autotagAllButton.disabled
    )
        return;

    const entriesToAutotag = Array.from(
        state.mainContentAreaElement.querySelectorAll(
            'dataset-entry:not([style*="display: none"])'
        )
    );

    if (entriesToAutotag.length === 0) {
        showConfirmationModal("No visible entries to autotag.", [
            { text: "OK" },
        ]);
        return;
    }

    const originalButtonIcon = state.autotagAllButton.textContent;
    const originalButtonTitle =
        state.autotagAllButton.getAttribute("title");

    state.autotagAllButton.textContent = "sync";
    state.autotagAllButton.classList.add("loading");
    state.autotagAllButton.disabled = true;

    let globalTimerLabel =
        state.autotagAllButton.parentElement.querySelector(
            ".autotag-timer-label"
        );
    if (!globalTimerLabel) {
        globalTimerLabel = createTimerLabelElement();
        state.autotagAllButton.insertAdjacentElement(
            "afterend",
            globalTimerLabel
        );
    } else {
        globalTimerLabel.textContent = "0.0s";
        globalTimerLabel.classList.remove("fade-out");
    }

    let successCount = 0;
    let failCount = 0;
    const totalEntries = entriesToAutotag.length;

    let globalTimer = startTimer((timeString) => {
        if (globalTimerLabel)
            globalTimerLabel.textContent = timeString;
        const processedCount = successCount + failCount;
        state.autotagAllButton.setAttribute(
            "title",
            `Autotagging ${processedCount}/${totalEntries}... (${timeString})`
        );
    }, 200);

    for (const entry of entriesToAutotag) {
        const btn = entry.querySelector(".autotag-entry");
        if (btn) btn.disabled = true;
    }

    for (let i = 0; i < totalEntries; i++) {
        const entry = entriesToAutotag[i];
        const entryDisplayName =
            entry.originalImageName || `entry ${i + 1}`;
        state.autotagAllButton.setAttribute(
            "title",
            `Autotagging ${
                successCount + failCount + 1
            }/${totalEntries}: ${entryDisplayName} (${globalTimer.getElapsedTime()})`
        );
        try {
            const result = await entry.triggerAutotag(true);
            if (result && result.success) {
                successCount++;
                console.log(
                    `Autotagged successfully: ${entryDisplayName}. New tags: ${result.tagsAddedCount}`
                );
            } else {
                failCount++;
                console.warn(
                    `Autotagging failed or no tags added for: ${entryDisplayName}. Message: ${
                        result ? result.message : "No details"
                    }`
                );
            }
        } catch (error) {
            failCount++;
            console.error(
                `Critical error during autotag for entry ${entryDisplayName}:`,
                error
            );
        }
    }

    const totalElapsedTime = globalTimer.stop();
    if (globalTimerLabel) {
        globalTimerLabel.textContent = `Total: ${totalElapsedTime.toFixed(
            1
        )}s`;
        globalTimerLabel.classList.add("fade-out");
        setTimeout(() => globalTimerLabel.remove(), 3000);
    }

    state.autotagAllButton.textContent = originalButtonIcon;
    state.autotagAllButton.setAttribute("title", originalButtonTitle);
    state.autotagAllButton.classList.remove("loading");
    state.autotagAllButton.disabled = false;

    for (const entry of entriesToAutotag) {
        const btn = entry.querySelector(".autotag-entry");
        if (btn) btn.disabled = false;
    }

    let summaryMessage = `Autotag All complete in ${totalElapsedTime.toFixed(
        1
    )} seconds.\nSuccessfully processed: ${successCount} entr${
        successCount === 1 ? "y" : "ies"
    }.`;
    if (failCount > 0) {
        summaryMessage += `\nFailed or no tags added for: ${failCount} entr${
            failCount === 1 ? "y" : "ies"
        }.`;
    }
    if (
        totalEntries > 0 &&
        successCount === 0 &&
        failCount === totalEntries
    ) {
        summaryMessage = `Autotag All (took ${totalElapsedTime.toFixed(
            1
        )}s): All entries failed or had no new tags to add.`;
    } else if (totalEntries === 0) {
        summaryMessage = "No visible entries were processed.";
    }
    showConfirmationModal(summaryMessage, [{ text: "OK" }]);
}
