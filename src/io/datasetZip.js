// Dataset ZIP import/export (raw images + .txt tag files).

import { state } from "../core/state.js";
import { sanitizeFilename, parseRawTagInput } from "../utils/text.js";
import { showConfirmationModal } from "../ui/modal.js";
import { showMainAppUI } from "../ui/lifecycle.js";
import { checkDropHintVisibility } from "../ui/search.js";

export async function handleDatasetZipSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    event.target.value = null;

    if (!file.name.endsWith(".zip")) {
        showConfirmationModal(
            "Invalid file type. Please select a .zip file for dataset import.",
            [{ text: "OK" }]
        );
        return;
    }

    showConfirmationModal("Importing dataset from ZIP...", []);
    console.log(`Importing dataset from: ${file.name}`);

    try {
        const zipData = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(zipData);

        const imageFiles = [];
        const textFiles = {};

        zip.forEach((relativePath, zipEntry) => {
            if (zipEntry.dir) return;

            const fileName = relativePath.substring(
                relativePath.lastIndexOf("/") + 1
            );
            const lowerFileName = fileName.toLowerCase();

            if (
                /\.(jpe?g|png|webp|gif|bmp|tiff)$/i.test(
                    lowerFileName
                )
            ) {
                imageFiles.push(zipEntry);
            } else if (lowerFileName.endsWith(".txt")) {
                const baseName = lowerFileName.substring(
                    0,
                    lowerFileName.lastIndexOf(".txt")
                );
                textFiles[baseName] = zipEntry.async("string");
            }
        });

        if (imageFiles.length === 0) {
            document.querySelector(".modal-overlay")?.remove();
            showConfirmationModal(
                "No image files found in the ZIP archive.",
                [{ text: "OK" }]
            );
            return;
        }

        const loadingModalMsg = document.querySelector(
            ".modal-overlay .modal-message"
        );
        if (loadingModalMsg)
            loadingModalMsg.textContent = `Processing ${imageFiles.length} images...`;

        let importedCount = 0;
        let errorCount = 0;
        const currentMainContentArea =
            document.getElementById("main-content-area"); // Re-query

        for (let i = 0; i < imageFiles.length; i++) {
            const imageEntry = imageFiles[i];
            const imageName = imageEntry.name.substring(
                imageEntry.name.lastIndexOf("/") + 1
            );
            if (loadingModalMsg)
                loadingModalMsg.textContent = `Importing ${i + 1}/${
                    imageFiles.length
                }: ${imageName}`;

            try {
                const imageDataBlob = await imageEntry.async(
                    "blob"
                );
                const blobUrl = URL.createObjectURL(imageDataBlob);
                const imageFileObject = new File(
                    [imageDataBlob],
                    imageName,
                    { type: imageDataBlob.type }
                );

                const newEntryElement =
                    document.createElement("dataset-entry");
                newEntryElement.setImage(blobUrl, imageFileObject);

                const imageBaseName = imageName
                    .substring(0, imageName.lastIndexOf("."))
                    .toLowerCase();
                if (textFiles[imageBaseName]) {
                    const tagsString = await textFiles[
                        imageBaseName
                    ];
                    const tagsArray = parseRawTagInput(tagsString);
                    newEntryElement.setTags(tagsArray);
                }

                if (currentMainContentArea) {
                    let referenceNode =
                        state.dropHint?.isConnected &&
                        state.dropHint.parentElement ===
                            currentMainContentArea
                            ? state.dropHint
                            : currentMainContentArea.firstChild;

                    currentMainContentArea.insertBefore(
                        newEntryElement,
                        referenceNode
                    );
                    importedCount++;
                } else {
                    console.error(
                        "state.mainContentAreaElement not found, cannot add imported entry."
                    );
                    errorCount++;
                }
            } catch (err) {
                console.error(
                    `Error processing image ${imageName} from ZIP:`,
                    err
                );
                errorCount++;
            }
        }

        document.querySelector(".modal-overlay")?.remove();
        let resultMessage = `Dataset import complete. ${importedCount} entries added.`;
        if (errorCount > 0) {
            resultMessage += ` ${errorCount} error(s) occurred.`;
        }
        showConfirmationModal(resultMessage, [{ text: "OK" }]);
        showMainAppUI();
        // Ensure tagging tab is active after importing
        const appTabs = document.getElementById("app");
        if (appTabs) {
            appTabs.activeTab = "tagging";
        }
        checkDropHintVisibility();
    } catch (error) {
        console.error("Error importing dataset from ZIP:", error);
        document.querySelector(".modal-overlay")?.remove();
        showConfirmationModal(
            `Error importing dataset: ${error.message}. Check console for details.`,
            [{ text: "OK" }]
        );
    }
}

export function confirmAndExportDataset() {
    const currentMainContentArea =
        document.getElementById("main-content-area");
    const currentSearchInput =
        document.getElementById("search-bar");

    if (!currentMainContentArea || !currentSearchInput) {
        showConfirmationModal(
            "Cannot export: UI elements missing.",
            [{ text: "OK" }]
        );
        return;
    }

    const entries =
        currentMainContentArea.querySelectorAll("dataset-entry");
    const searchIsActive = currentSearchInput.value.trim() !== "";
    const entriesToCheck = searchIsActive
        ? Array.from(entries).filter(
              (entry) => entry.style.display !== "none"
          )
        : Array.from(entries);

    if (entriesToCheck.length === 0) {
        if (searchIsActive && entries.length > 0) {
            showConfirmationModal(
                "No entries match the current filter. Export all entries instead?",
                [
                    {
                        text: "Export All (" + entries.length + ")",
                        onClick: () =>
                            exportDataset(Array.from(entries)),
                        class: "modal-button-confirm",
                    },
                    {
                        text: "Cancel",
                        onClick: () => {},
                        class: "modal-button-cancel",
                    },
                ]
            );
        } else {
            showConfirmationModal(
                "Dataset is empty. Nothing to export.",
                [{ text: "OK" }]
            );
        }
        return;
    }

    let requirementsMet = true;
    let failingEntriesCount = 0;
    for (const entry of entriesToCheck) {
        if (!entry.checkGroupRequirements()) {
            requirementsMet = false;
            failingEntriesCount++;
        }
    }

    const exportTargetDescription = searchIsActive
        ? "filtered"
        : "all";
    const countDescription = `${
        entriesToCheck.length
    } ${exportTargetDescription} entr${
        entriesToCheck.length === 1 ? "y" : "ies"
    }`;

    if (requirementsMet) {
        exportDataset(
            entriesToCheck,
            `Exporting ${countDescription}...`
        );
    } else {
        showConfirmationModal(
            `Warning: ${failingEntriesCount} of the ${countDescription} do not meet minimum tag requirements. Export anyway?`,
            [
                {
                    text: "Export Anyway",
                    onClick: () =>
                        exportDataset(
                            entriesToCheck,
                            `Exporting ${countDescription} (with warnings)...`
                        ),
                    class: "modal-button-confirm",
                },
                {
                    text: "Cancel",
                    onClick: () => {},
                    class: "modal-button-cancel",
                },
            ]
        );
    }
}

export async function exportDataset(
    entriesToExport,
    description = "Exporting dataset..."
) {
    if (
        typeof JSZip === "undefined" ||
        typeof saveAs === "undefined"
    ) {
        showConfirmationModal(
            "Export libraries (JSZip, FileSaver) not loaded.",
            [{ text: "OK" }]
        );
        return;
    }
    if (!entriesToExport || entriesToExport.length === 0) {
        showConfirmationModal("No entries to export.", [
            { text: "OK" },
        ]);
        return;
    }

    const zip = new JSZip();
    const folder = zip.folder("lora_dataset");
    let count = 0,
        errors = 0;
    console.log(description);

    const exportMenuItem = document.querySelector(
        'menu-item[data-action="export"]'
    );
    let originalMenuText = "Export Dataset (ZIP)";
    if (exportMenuItem) {
        originalMenuText = exportMenuItem.textContent;
        exportMenuItem.textContent = "Exporting...";
        exportMenuItem.style.pointerEvents = "none";
    } else {
        showConfirmationModal("Exporting dataset...", []);
    }

    const names = new Set();
    for (const entry of entriesToExport) {
        count++;
        const imgElement = entry.querySelector("img");
        const baseNameSource =
            entry.originalImageName || imgElement?.alt || "";

        let baseName = baseNameSource.includes(".")
            ? baseNameSource.substring(
                  0,
                  baseNameSource.lastIndexOf(".")
              )
            : baseNameSource;
        baseName =
            baseName || `image_${String(count).padStart(4, "0")}`;
        baseName = sanitizeFilename(baseName);

        const imageData = await entry.getImageData();
        if (!imageData) {
            console.warn(
                `Skipping entry ${count} (${baseNameSource}): Failed to get image data.`
            );
            errors++;
            continue;
        }

        let extension = "png";
        if (imageData.type) {
            const mimeType = imageData.type.split("/")[1];
            if (mimeType === "jpeg") extension = "jpg";
            else if (
                ["png", "webp", "gif", "bmp", "tiff"].includes(
                    mimeType
                )
            )
                extension = mimeType;
        } else if (
            entry.originalImageName &&
            entry.originalImageName.includes(".")
        ) {
            let origExt = entry.originalImageName
                .substring(
                    entry.originalImageName.lastIndexOf(".") + 1
                )
                .toLowerCase();
            if (
                [
                    "png",
                    "jpg",
                    "jpeg",
                    "webp",
                    "gif",
                    "bmp",
                    "tiff",
                ].includes(origExt)
            ) {
                extension = origExt === "jpeg" ? "jpg" : origExt;
            }
        }
        extension = extension.startsWith(".")
            ? extension.substring(1)
            : extension;

        let uniqueFullName = `${baseName}.${extension}`;
        let nameCounter = 1;
        while (names.has(uniqueFullName.toLowerCase())) {
            const tempBaseName = baseName.replace(/_\d+$/, "");
            uniqueFullName = `${tempBaseName}_${nameCounter++}.${extension}`;
        }
        names.add(uniqueFullName.toLowerCase());

        const tags = entry.getTagsAsString(", ");

        folder.file(uniqueFullName, imageData, {
            binary: true,
        });
        folder.file(
            `${uniqueFullName.substring(
                0,
                uniqueFullName.lastIndexOf(".")
            )}.txt`,
            tags
        );
    }

    document.querySelector(".modal-overlay")?.remove();

    let exportMessage = "";
    if (entriesToExport.length === 0 && errors === 0)
        exportMessage = "No entries were exported.";
    else if (errors > 0)
        exportMessage = `Export finished with ${errors} error(s). ${
            entriesToExport.length - errors
        } entries exported successfully. Check console for details.`;
    else
        exportMessage = `Export successful! ${entriesToExport.length} entries packaged.`;

    if (
        entriesToExport.length > 0 &&
        errors < entriesToExport.length
    ) {
        try {
            const blob = await zip.generateAsync(
                {
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 6 },
                },
                (meta) => {
                    if (exportMenuItem)
                        exportMenuItem.textContent = `Exporting... (${meta.percent.toFixed(
                            0
                        )}%)`;
                }
            );
            saveAs(blob, "lora_dataset_export.zip");
            showConfirmationModal(exportMessage, [{ text: "OK" }]);
        } catch (err) {
            console.error("Error generating ZIP file:", err);
            showConfirmationModal(
                "Error generating ZIP file. Check console.",
                [{ text: "OK" }]
            );
        }
    } else {
        showConfirmationModal(exportMessage, [{ text: "OK" }]);
    }

    if (exportMenuItem) {
        exportMenuItem.textContent = originalMenuText;
        exportMenuItem.style.pointerEvents = "auto";
    }
}
