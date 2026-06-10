// Project save/load (.loraproj ZIPs containing images + project.json).

import { state } from "../core/state.js";
import { sanitizeFilename } from "../utils/text.js";
import { showConfirmationModal } from "../ui/modal.js";
import { showMainAppUI, clearWorkspaceForNewProject } from "../ui/lifecycle.js";
import { checkDropHintVisibility } from "../ui/search.js";

export async function saveProject() {
    console.log("Starting project save...");
    showConfirmationModal("Saving project...", []);

    const groups = [];

    for (const catElement of document.querySelectorAll(
        "#tag-group-list tag-group"
    )) {
        groups.push({
            name:
                catElement.getAttribute("group-name") ||
                "Unnamed Group",
            minimumTags: catElement.minimumTags,
            tags: catElement.getGroupTags(),
        });
    }

    const entries = [];
    const currentMainContentArea =
        document.getElementById("main-content-area"); // Re-query in case of tab changes
    if (!currentMainContentArea) {
        console.error(
            "Cannot save project: state.mainContentAreaElement element not found."
        );
        document.querySelector(".modal-overlay")?.remove();
        showConfirmationModal(
            "Error saving project: UI elements missing.",
            [{ text: "OK" }]
        );
        return;
    }
    const entryElements =
        currentMainContentArea.querySelectorAll("dataset-entry");
    const imageSavePromises = [];
    const zip = new JSZip();
    const imagesFolder = zip.folder("images");

    const usedImageNames = new Set();

    for (const entryElement of entryElements) {
        const originalName =
            entryElement.originalImageName ||
            `entry_${Date.now()}.png`;

        let safeName = sanitizeFilename(originalName);
        let uniqueName = safeName;
        let counter = 1;
        while (usedImageNames.has(uniqueName.toLowerCase())) {
            const extension = uniqueName.includes(".")
                ? uniqueName.substring(uniqueName.lastIndexOf("."))
                : "";
            const base = uniqueName.includes(".")
                ? uniqueName.substring(
                      0,
                      uniqueName.lastIndexOf(".")
                  )
                : uniqueName;

            const baseWithoutCounter = base.replace(/_\d+$/, "");
            uniqueName = `${baseWithoutCounter}_${counter++}${extension}`;
        }
        usedImageNames.add(uniqueName.toLowerCase());

        entries.push({
            imageName: uniqueName,
            tags: entryElement.getTags(),
        });

        imageSavePromises.push(
            entryElement
                .getImageData()
                .then((imageData) => {
                    if (imageData) {
                        imagesFolder.file(uniqueName, imageData, {
                            binary: true,
                        });
                    } else {
                        console.warn(
                            `Could not get image data for entry originally named: ${originalName}. Skipping image file.`
                        );

                        throw new Error(
                            `Missing image data for ${originalName}`
                        );
                    }
                })
                .catch((err) => {
                    console.error(
                        `Error processing image for ${originalName}:`,
                        err
                    );
                    return {
                        status: "rejected",
                        reason: `Failed to process image: ${originalName}`,
                    };
                })
        );
    }

    const projectData = {
        version: 1,
        groups: groups,
        entries: entries,
    };
    zip.file("project.json", JSON.stringify(projectData, null, 2));

    const results = await Promise.allSettled(imageSavePromises);
    document.querySelector(".modal-overlay")?.remove();

    const failedImages = results.filter(
        (r) => r.status === "rejected"
    );
    if (failedImages.length > 0) {
        console.error(
            `${failedImages.length} image(s) failed to save.`
        );
        showConfirmationModal(
            `Warning: ${failedImages.length} image(s) could not be read or saved. The project file might be incomplete. Save anyway?`,
            [
                {
                    text: "Save Anyway",
                    onClick: () =>
                        generateAndDownloadZip(zip, "Save Project"),
                    class: "modal-button-confirm",
                },
                {
                    text: "Cancel",
                    onClick: () =>
                        console.log(
                            "Project save cancelled due to image errors."
                        ),
                    class: "modal-button-cancel",
                },
            ]
        );
    } else {
        generateAndDownloadZip(zip, "Save Project");
    }
}

export async function generateAndDownloadZip(
    zip,
    menuActionText = "Processing..."
) {
    const menuSave = document.querySelector(
        'menu-item[data-action="save-project"]'
    );
    const menuExport = document.querySelector(
        'menu-item[data-action="export"]'
    );
    const targetMenuItem = menuSave || menuExport;
    const originalText =
        targetMenuItem?.textContent || menuActionText;

    if (targetMenuItem) {
        targetMenuItem.textContent = "Zipping...";
        targetMenuItem.style.pointerEvents = "none";
    } else {
        showConfirmationModal("Zipping project...", []);
    }

    try {
        const blob = await zip.generateAsync(
            {
                type: "blob",
                compression: "DEFLATE",
                compressionOptions: { level: 6 },
            },
            (metadata) => {
                const progressText = `Zipping... (${metadata.percent.toFixed(
                    0
                )}%)`;
                if (targetMenuItem)
                    targetMenuItem.textContent = progressText;
                else {
                    const modalMsg = document.querySelector(
                        ".modal-overlay .modal-message"
                    );
                    if (modalMsg)
                        modalMsg.textContent = progressText;
                }
            }
        );
        document.querySelector(".modal-overlay")?.remove();
        const filename = menuSave
            ? `lora_project_${Date.now()}${state.PROJECT_FILE_EXTENSION}`
            : "lora_dataset_export.zip";
        saveAs(blob, filename);
        console.log("Project saved successfully.");
        showConfirmationModal(
            menuSave
                ? "Project saved successfully!"
                : "Dataset exported successfully!",
            [{ text: "OK" }]
        );
    } catch (err) {
        console.error("Error generating ZIP:", err);
        document.querySelector(".modal-overlay")?.remove();
        showConfirmationModal(
            "Error generating file. Check console for details.",
            [{ text: "OK" }]
        );
    } finally {
        if (targetMenuItem) {
            targetMenuItem.textContent = originalText;
            targetMenuItem.style.pointerEvents = "auto";
        }
    }
}

export function handleProjectFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    event.target.value = null;

    if (!file.name.endsWith(state.PROJECT_FILE_EXTENSION)) {
        showConfirmationModal(
            `Invalid file type. Please select a ${state.PROJECT_FILE_EXTENSION} file.`,
            [{ text: "OK" }]
        );
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const zipData = e.target.result;
            await loadProjectFromZip(zipData);
            showMainAppUI();
            // Ensure tagging tab is active after loading a project
            const appTabs = document.getElementById("app");
            if (appTabs) {
                appTabs.activeTab = "tagging";
            }
        } catch (error) {
            console.error("Error loading project file:", error);
            document.querySelector(".modal-overlay")?.remove();
            showConfirmationModal(
                `Error loading project: ${error.message}. Check console for details.`,
                [{ text: "OK" }]
            );
        }
    };
    reader.onerror = (e) => {
        console.error("FileReader error:", e);
        showConfirmationModal("Error reading project file.", [
            { text: "OK" },
        ]);
    };
    reader.readAsArrayBuffer(file);
}

export async function loadProjectFromZip(zipData) {
    console.log("Loading project from zip data...");
    showConfirmationModal("Loading project...", []);

    let zip;
    try {
        zip = await JSZip.loadAsync(zipData);
    } catch (e) {
        console.error("Failed to load ZIP data:", e);
        throw new Error(
            "Invalid or corrupted project file (could not read as ZIP)."
        );
    }

    const projectFile = zip.file("project.json");
    if (!projectFile) {
        throw new Error(
            "Invalid project file: 'project.json' not found."
        );
    }
    let projectJson;
    try {
        projectJson = await projectFile.async("string");
    } catch (e) {
        console.error("Failed to read project.json:", e);
        throw new Error(
            "Could not read 'project.json' from the file."
        );
    }
    let projectData;
    try {
        projectData = JSON.parse(projectJson);
    } catch (e) {
        console.error("Failed to parse project.json:", e);
        throw new Error(
            "Invalid project file: Could not parse 'project.json'."
        );
    }

    if (
        !projectData ||
        typeof projectData !== "object" ||
        projectData.version !== 1
    ) {
        throw new Error(
            "Invalid or unsupported project file format/version."
        );
    }
    if (
        !Array.isArray(projectData.groups) ||
        !Array.isArray(projectData.entries)
    ) {
        throw new Error(
            "Invalid project data structure (missing groups or entries array)."
        );
    }

    clearWorkspaceForNewProject();

    console.log(`Loading ${projectData.groups.length} groups...`);
    const groupListContainer =
        document.getElementById("tag-group-list");

    for (const catData of projectData.groups) {
        const groupElement = document.createElement("tag-group");
        groupElement.setAttribute(
            "group-name",
            catData.name || "Unnamed"
        );

        requestAnimationFrame(() => {
            groupElement.minimumTags = catData.minimumTags || 0;
            groupElement.setTags(catData.tags || []);
        });
        groupListContainer.appendChild(groupElement);
    }

    console.log(`Loading ${projectData.entries.length} entries...`);
    let loadedCount = 0;
    let errorCount = 0;
    const imageLoadErrors = [];

    const loadingModalMsg = document.querySelector(
        ".modal-overlay .modal-message"
    );
    if (loadingModalMsg)
        loadingModalMsg.textContent = `Loading ${projectData.entries.length} entries...`;

    const currentMainContentArea =
        document.getElementById("main-content-area"); // Re-query

    const entryCreationPromises = projectData.entries.map(
        async (entryData, index) => {
            if (
                !entryData ||
                typeof entryData.imageName !== "string"
            ) {
                console.warn(
                    `Skipping invalid entry data at index ${index}.`
                );
                imageLoadErrors.push(
                    `Invalid entry data at index ${index}.`
                );
                return null;
            }

            const imageName = entryData.imageName;
            const imageFileInZip = zip.file(`images/${imageName}`);

            if (!imageFileInZip) {
                console.warn(
                    `Image '${imageName}' not found in project zip's images/ folder. Skipping entry.`
                );
                imageLoadErrors.push(
                    `Image not found in zip: images/${imageName}`
                );
                return null;
            }

            let blobUrl;
            try {
                const imageDataBlob = await imageFileInZip.async(
                    "blob"
                );
                blobUrl = URL.createObjectURL(imageDataBlob);

                const imageFileObject = new File(
                    [imageDataBlob],
                    imageName,
                    { type: imageDataBlob.type }
                );

                const entryElement =
                    document.createElement("dataset-entry");
                entryElement.setImage(blobUrl, imageFileObject);
                return {
                    element: entryElement,
                    tags: entryData.tags || [],
                };
            } catch (err) {
                console.error(
                    `Error processing entry image '${imageName}':`,
                    err
                );
                imageLoadErrors.push(
                    `Error loading ${imageName}: ${err.message}`
                );
                if (
                    typeof blobUrl !== "undefined" &&
                    URL.revokeObjectURL
                )
                    URL.revokeObjectURL(blobUrl);
                return null;
            }
        }
    );

    const processedEntries = await Promise.all(
        entryCreationPromises
    );

    for (const [index, result] of processedEntries.entries()) {
        if (result && currentMainContentArea) {
            let referenceNode =
                state.dropHint?.isConnected &&
                state.dropHint.parentElement === currentMainContentArea
                    ? state.dropHint
                    : currentMainContentArea.firstChild; // Fallback

            currentMainContentArea.insertBefore(
                result.element,
                referenceNode
            );
            result.element.setTags(result.tags);
            loadedCount++;
            if (loadingModalMsg && index % 10 === 0) {
                loadingModalMsg.textContent = `Loading entry ${
                    index + 1
                } / ${projectData.entries.length}...`;
            }
        } else if (result && !currentMainContentArea) {
            console.error(
                "state.mainContentAreaElement not available to append loaded entry. This is unexpected."
            );
            errorCount++;
        } else if (!result) {
            errorCount++;
        }
    }

    document.querySelector(".modal-overlay")?.remove();

    let resultMessage = `Project loaded successfully. ${loadedCount} entries added.`;
    if (errorCount > 0) {
        resultMessage += ` ${errorCount} error(s) encountered (check console for details).`;
        console.error(
            "Errors during project load (image or data issues):",
            imageLoadErrors
        );
    }
    showConfirmationModal(resultMessage, [{ text: "OK" }]);
    checkDropHintVisibility();
}
