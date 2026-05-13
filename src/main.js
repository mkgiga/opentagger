// Entry point for the refactored opentagger frontend.
//
// During the Vite migration this is intentionally minimal: the heavy
// lifting still lives in the inline <script> block in index.html. As
// components and core systems get extracted, they will be imported
// here and the inline block will shrink toward zero.

// Vendor libraries first — the legacy inline script reads them off
// window, so they need to be assigned before that script runs.
import "./vendor.js";

// Stylesheets are imported in roughly the same order they appeared in
// the original monolithic <style> block, so any specificity-tied
// cascade outcomes stay unchanged.
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
