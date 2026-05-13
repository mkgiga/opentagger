class MenuItem extends HTMLElement {
    constructor() {
        super();
        this._callback = null;
        this.submenu = null;
    }
    connectedCallback() {
        this.submenu = this.querySelector("context-menu");
        if (this.submenu) {
            const arrow = document.createElement("span");
            arrow.className = "submenu-arrow material-icons";
            arrow.textContent = "arrow_right";
            this.appendChild(arrow);

            this.addEventListener("mouseenter", () => {
                this.submenu.style.display = "flex";
            });
            this.addEventListener("mouseleave", () => {
                this.submenu.style.display = "none";
            });

            this.addEventListener("click", (e) => {
                e.stopPropagation();
            });
        } else {
            this.addEventListener("click", (e) => {
                e.stopPropagation();
                if (
                    !this.classList.contains("disabled") &&
                    typeof this._callback === "function"
                ) {
                    this._callback(e);
                }
                this.closestContextMenu()?.hide();
            });
        }
    }
    set callback(t) {
        this._callback = t;
    }
    closestContextMenu() {
        let e = this.closest("context-menu");
        while (e && e.parentElement instanceof MenuItem) {
            e = e.parentElement.closest("context-menu");
        }
        return e;
    }
}
customElements.define("menu-item", MenuItem);
