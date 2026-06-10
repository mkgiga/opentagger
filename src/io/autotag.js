// Batch autotagging ("tag everything visible").
//
// triggerAutotag for a single entry lives on the <dataset-entry>
// component itself (it owns the loading state). Engine selection and
// first-run model setup live in tagger.js.

import { state } from "../core/state.js";
import { createTimerLabelElement } from "../utils/dom.js";
import { startTimer } from "../utils/timing.js";
import { showConfirmationModal } from "../ui/modal.js";
import { ensureAutotagReady } from "./tagger.js";

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

    // Pre-flight: pick an engine, walking the user through first-run
    // model setup if needed.
    if (!(await ensureAutotagReady())) {
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
    let firstFailureMessage = null;
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
                if (!firstFailureMessage && result?.message) {
                    firstFailureMessage = result.message;
                }
                console.warn(
                    `Autotagging failed or no tags added for: ${entryDisplayName}. Message: ${
                        result ? result.message : "No details"
                    }`
                );
            }
        } catch (error) {
            failCount++;
            if (!firstFailureMessage) {
                firstFailureMessage = error.message;
            }
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
    if (failCount > 0 && firstFailureMessage) {
        summaryMessage += `\n\nFirst error: ${firstFailureMessage}`;
    }
    showConfirmationModal(summaryMessage, [{ text: "OK" }]);
}
