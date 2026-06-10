// Entry point for the opentagger frontend.

// Vendor libraries first — the app reads JSZip, saveAs, CodeMirror
// off window, so they must be assigned before app.js runs.
import "./vendor.js";

// Stylesheet order matters for specificity-tied cascade outcomes.
import "./styles/base.css";
import "./styles/preferences.css";
import "./styles/splash.css";
import "./styles/sidebar.css";
import "./styles/main-view.css";
import "./styles/tag.css";
import "./styles/entry.css";
import "./styles/console.css";
import "./styles/autocomplete.css";
import "./styles/tag-group.css";
import "./styles/menu.css";
import "./styles/modal.css";
import "./styles/status-bar.css";

import "./app.js";
