// Vendor library bootstrap. App modules use JSZip, saveAs, and
// CodeMirror as window globals rather than importing them directly,
// so pin them to window here.

import JSZip from "jszip";
import { saveAs } from "file-saver";
import CodeMirror from "codemirror";

// CodeMirror v5 modes and addons register themselves on the imported
// CodeMirror object via side effects.
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
