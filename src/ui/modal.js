// Modal helpers: confirmation dialog and image preview overlay.
//
// Both functions create the overlay imperatively and attach to
// document.body. Only one of each kind is allowed at a time -- a
// fresh invocation removes the previous overlay first.

/**
 * Show a confirmation/info modal with a message and a list of buttons.
 * Each button: { text, class?, onClick? }. Clicking the overlay
 * background dismisses without invoking any button callback; pass
 * `onDismiss` to be notified when that happens.
 */
export function showConfirmationModal(message, buttons, onDismiss) {
    document.querySelector(".modal-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const content = document.createElement("div");
    content.className = "modal-content";

    const msgElement = document.createElement("div");
    msgElement.className = "modal-message";
    msgElement.textContent = message;
    msgElement.style.whiteSpace = "pre-wrap";

    const btnContainer = document.createElement("div");
    btnContainer.className = "modal-buttons";

    for (const btnInfo of buttons) {
        const button = document.createElement("button");
        button.textContent = btnInfo.text;
        button.className = btnInfo.class || "modal-button-default";
        button.addEventListener("click", () => {
            overlay.remove();
            if (typeof btnInfo.onClick === "function") {
                btnInfo.onClick();
            }
        });
        btnContainer.appendChild(button);
    }

    content.appendChild(msgElement);
    content.appendChild(btnContainer);
    overlay.appendChild(content);

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
            overlay.remove();
            if (typeof onDismiss === "function") onDismiss();
        }
    });

    document.body.appendChild(overlay);
}

/**
 * Show an image at full size in a dismissible overlay. Loads via a
 * temporary Image to compute natural dimensions before showing.
 */
export function showImagePreviewModal(imageUrl, imageName) {
    document.querySelector(".image-preview-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "image-preview-overlay";

    const content = document.createElement("div");
    content.className = "image-preview-content";

    const closeBtn = document.createElement("button");
    closeBtn.className = "image-preview-close material-icons";
    closeBtn.textContent = "close";
    closeBtn.setAttribute("title", "Close Preview");

    const imgPreview = document.createElement("img");
    imgPreview.alt = `Preview: ${imageName}`;

    const infoDiv = document.createElement("div");
    infoDiv.className = "image-preview-info";
    infoDiv.textContent = "Loading image...";

    content.appendChild(closeBtn);
    content.appendChild(imgPreview);
    content.appendChild(infoDiv);
    overlay.appendChild(content);

    const close = () => {
        overlay.remove();
        document.removeEventListener("keydown", escapeHandler);
    };

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
            close();
        }
    });
    closeBtn.addEventListener("click", close);

    const escapeHandler = (e) => {
        if (e.key === "Escape") {
            close();
        }
    };
    document.addEventListener("keydown", escapeHandler);

    const tempImg = new Image();
    tempImg.onload = () => {
        imgPreview.src = imageUrl;
        infoDiv.innerHTML = `
 <strong>${imageName}</strong>
 <br>
 Dimensions: ${tempImg.naturalWidth} x ${tempImg.naturalHeight} pixels
          `;
    };
    tempImg.onerror = () => {
        infoDiv.textContent = `Error: Could not load preview for ${imageName}.`;
        console.error(
            "Image Preview Modal: Failed to load",
            imageUrl
        );
    };
    tempImg.src = imageUrl;

    document.body.appendChild(overlay);
}
