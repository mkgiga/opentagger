class ContextMenu extends HTMLElement {
    constructor() {
        super();
        this._boundHide = this.hide.bind(this);
        this._boundPreventContextMenu = (e) => e.preventDefault();
    }
    connectedCallback() {
        this.style.display = "none";
        this.addEventListener(
            "contextmenu",
            this._boundPreventContextMenu
        );
    }
    disconnectedCallback() {
        document.removeEventListener("click", this._boundHide, {
            capture: true,
        });
        document.removeEventListener(
            "contextmenu",
            this._boundHide,
            { capture: true }
        );
        this.removeEventListener(
            "contextmenu",
            this._boundPreventContextMenu
        );
    }
    show(x, y, anchorElement = null) {
        for (const menu of document.querySelectorAll(
            "context-menu.visible"
        )) {
            menu.hide();
        }

        let targetX = x;
        let targetY = y;

        if (anchorElement) {
            const anchorRect =
                anchorElement.getBoundingClientRect();
            targetY = anchorRect.bottom + 2;
            targetX = anchorRect.left;
        } else {
            this.style.minWidth = "150px";
        }

        this.style.left = `${targetX}px`;
        this.style.top = `${targetY}px`;
        this.classList.add("visible");
        this.style.display = "flex";

        requestAnimationFrame(() => {
            const rect = this.getBoundingClientRect();
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;

            let adjustedX = parseFloat(this.style.left);
            let adjustedY = parseFloat(this.style.top);

            if (rect.right > screenWidth) {
                adjustedX = anchorElement
                    ? anchorElement.getBoundingClientRect().right -
                      rect.width
                    : screenWidth - rect.width - 5;
            }
            if (rect.bottom > screenHeight) {
                adjustedY = anchorElement
                    ? anchorElement.getBoundingClientRect().top -
                      rect.height -
                      2
                    : screenHeight - rect.height - 5;
            }
            if (adjustedX < 0) adjustedX = 5;
            if (adjustedY < 0) adjustedY = 5;

            this.style.left = `${adjustedX}px`;
            this.style.top = `${adjustedY}px`;
        });

        setTimeout(() => {
            document.addEventListener("click", this._boundHide, {
                capture: true,
                once: true,
            });
            document.addEventListener(
                "contextmenu",
                this._boundHide,
                { capture: true, once: true }
            );
        }, 0);
    }
    hide() {
        if (this.classList.contains("visible")) {
            this.style.display = "none";
            this.classList.remove("visible");

            document.removeEventListener("click", this._boundHide, {
                capture: true,
            });
            document.removeEventListener(
                "contextmenu",
                this._boundHide,
                { capture: true }
            );

            for (const submenu of this.querySelectorAll(
                "context-menu"
            )) {
                submenu.style.display = "none";
            }
        }
    }
}
customElements.define("context-menu", ContextMenu);
