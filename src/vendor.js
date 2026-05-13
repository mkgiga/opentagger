// Vendor library bootstrap.
//
// The inline <script defer> in index.html (legacy app code) expects
// JSZip, saveAs, and CodeMirror to be available as window globals.
// We import them from npm here and pin them to window so the legacy
// code keeps working. Once the legacy block is refactored into modules
// these globals can be dropped in favour of direct imports.

import JSZip from "jszip";
import { saveAs } from "file-saver";
import CodeMirror from "codemirror";

// CodeMirror v5 modes and addons register themselves on the imported
// CodeMirror object via side effects. Order matches what the old CDN
// script tags loaded.
import "codemirror/lib/codemirror.css";
import "codemirror/theme/neat.css";
import "codemirror/mode/javascript/javascript.js";
import "codemirror/addon/hint/show-hint.js";
import "codemirror/addon/hint/show-hint.css";
import "codemirror/addon/hint/javascript-hint.js";
import "codemirror/addon/edit/closebrackets.js";
import "codemirror/addon/edit/matchbrackets.js";
import "codemirror/addon/comment/comment.js";

window.JSZip = JSZip;
window.saveAs = saveAs;
window.CodeMirror = CodeMirror;
