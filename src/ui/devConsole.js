// Developer console -- the F1-toggled CodeMirror panel that lets
// you run slash commands or JavaScript against opentaggerAPI.

import { state } from "../core/state.js";
import { opentaggerAPI } from "../core/api.js";
import { slashCommands } from "../core/slashCommands.js";
import { parseFunctionSignature } from "../utils/text.js";

export function logToConsole(
    message,
    type = "info",
    isPreformatted = false
) {
    if (!state.consoleOutputElement) return;

    const messageDiv = document.createElement("div");
    messageDiv.classList.add("console-message", type);

    if (typeof message === "object") {
        try {
            message = JSON.stringify(message, null, 2);
            isPreformatted = true;
        } catch (e) {
            message = String(message);
        }
    } else {
        message = String(message);
    }

    if (isPreformatted) {
        const pre = document.createElement("pre");
        pre.textContent = message;
        messageDiv.appendChild(pre);
    } else {
        messageDiv.textContent = message;
    }

    state.consoleOutputElement.appendChild(messageDiv);
    state.consoleOutputElement.scrollTop =
        state.consoleOutputElement.scrollHeight;
}

export function customCodeMirrorHints(editor, options) {
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    const token = editor.getTokenAt(cursor);

    if (line.trim().startsWith("/") && cursor.ch > 0) {
        let currentSlashCommandPart = "";
        const textBeforeCursor = line.substring(0, cursor.ch);
        const match = /^\/([^\s]*)/.exec(textBeforeCursor);

        if (match && cursor.ch <= 1 + match[1].length) {
            currentSlashCommandPart = match[1];

            const suggestions = Object.keys(slashCommands)
                .filter((cmd) =>
                    cmd.startsWith(currentSlashCommandPart)
                )
                .map((cmd) => {
                    const commandObject = slashCommands[cmd];
                    let displaySignature = "";

                    if (
                        commandObject &&
                        commandObject.signature !== undefined
                    ) {
                        displaySignature =
                            commandObject.signature.trim()
                                ? ` ${commandObject.signature.trim()}`
                                : "";
                    } else {
                        let funcToParseForSig = commandObject.func;
                        if (
                            commandObject.apiRef &&
                            typeof opentaggerAPI[
                                commandObject.apiRef
                            ] === "function"
                        ) {
                            funcToParseForSig =
                                opentaggerAPI[commandObject.apiRef];
                        }
                        const parsedSig =
                            parseFunctionSignature(
                                funcToParseForSig
                            );
                        if (parsedSig && parsedSig !== "()") {
                            const paramsString = parsedSig
                                .slice(1, -1)
                                .trim();
                            if (paramsString === "") {
                                displaySignature = "";
                            } else {
                                const paramsList = [];
                                let currentParam = "";
                                let p_openBrackets = 0;
                                let p_openParens = 0;
                                for (
                                    let i = 0;
                                    i < paramsString.length;
                                    i++
                                ) {
                                    const char = paramsString[i];
                                    currentParam += char;
                                    if (char === "{")
                                        p_openBrackets++;
                                    else if (char === "}")
                                        p_openBrackets--;
                                    else if (char === "(")
                                        p_openParens++;
                                    else if (char === ")")
                                        p_openParens--;
                                    else if (
                                        char === "," &&
                                        p_openBrackets === 0 &&
                                        p_openParens === 0
                                    ) {
                                        paramsList.push(
                                            currentParam
                                                .slice(0, -1)
                                                .trim()
                                        );
                                        currentParam = "";
                                    }
                                }
                                if (currentParam.trim()) {
                                    paramsList.push(
                                        currentParam.trim()
                                    );
                                }
                                const transformedParams = paramsList
                                    .map((p_str) => {
                                        let p = p_str.trim();
                                        if (p.startsWith("...")) {
                                            return `[${p}]`;
                                        } else if (
                                            p.includes("=")
                                        ) {
                                            const name = p
                                                .split("=")[0]
                                                .trim();
                                            return `[${name}]`;
                                        } else if (p) {
                                            return `<${p}>`;
                                        }
                                        return "";
                                    })
                                    .filter((p) => p)
                                    .join(" ");
                                displaySignature = transformedParams
                                    ? ` ${transformedParams}`
                                    : "";
                            }
                        } else {
                            displaySignature = "";
                        }
                    }
                    return {
                        text: "/" + cmd + " ",
                        displayText: `/${cmd}${displaySignature}`,
                        render: function (element, self, data) {
                            const cmdNameEl =
                                document.createElement("span");
                            cmdNameEl.textContent = "/" + cmd;
                            cmdNameEl.style.fontWeight = "bold";
                            element.appendChild(cmdNameEl);
                            if (displaySignature.trim()) {
                                const sigEl =
                                    document.createElement("span");
                                sigEl.textContent =
                                    displaySignature;
                                sigEl.style.color = "#777";
                                sigEl.style.marginLeft = "5px";
                                element.appendChild(sigEl);
                            }
                        },
                        className: "CodeMirror-hint-slash-command",
                    };
                });
            if (suggestions.length > 0) {
                return {
                    list: suggestions,
                    from: CodeMirror.Pos(
                        cursor.line,
                        textBeforeCursor.lastIndexOf("/")
                    ),
                    to: CodeMirror.Pos(cursor.line, cursor.ch),
                };
            }
        }
    }

    const jsGlobals = {};

    for (const key of Object.keys(opentaggerAPI)) {
        if (typeof opentaggerAPI[key] === "function") {
            jsGlobals[key] = opentaggerAPI[key];
        }
    }
    const commonBrowserGlobals = [
        "document",
        "window",
        "console",
        "Math",
        "JSON",
        "localStorage",
        "sessionStorage",
        "navigator",
        "location",
        "alert",
        "prompt",
        "confirm",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "fetch",
        "Promise",
        "URL",
        "Image",
        "File",
        "Blob",
        "FileReader",
        "FormData",
        "Date",
    ];

    for (const g of commonBrowserGlobals) {
        if (typeof window[g] !== "undefined") {
            jsGlobals[g] = window[g];
        }
    }
    const currentWord = token.string.trim().toLowerCase();
    const topLevelSuggestions = [];
    if (!token.string.includes(".")) {
        for (const key of Object.keys(jsGlobals)) {
            if (key.toLowerCase().startsWith(currentWord)) {
                const val = jsGlobals[key];
                let displayText = key;
                let signature = "";
                if (typeof val === "function") {
                    signature = parseFunctionSignature(val);
                    displayText = `${key}${signature}`;
                }
                topLevelSuggestions.push({
                    text: key,
                    displayText: displayText,
                    render: function (element, self, data) {
                        const nameEl =
                            document.createElement("span");
                        nameEl.textContent = key;
                        nameEl.style.fontWeight = "bold";
                        element.appendChild(nameEl);
                        if (signature) {
                            const sigEl =
                                document.createElement("span");
                            sigEl.textContent = signature;
                            sigEl.style.color = "#555";
                            sigEl.style.marginLeft = "6px";
                            element.appendChild(sigEl);
                        }
                    },
                });
            }
        }
    }
    const cmJsHintOptions = { ...options, globalVars: jsGlobals };
    let cmJsHintResult = CodeMirror.hint.javascript(
        editor,
        cmJsHintOptions
    );
    if (cmJsHintResult && cmJsHintResult.list.length > 0) {
        const combinedList = [...topLevelSuggestions];
        const topLevelTexts = new Set(
            topLevelSuggestions.map((s) => s.text)
        );

        for (const cmHint of cmJsHintResult.list) {
            const hintText =
                typeof cmHint === "string" ? cmHint : cmHint.text;
            if (!topLevelTexts.has(hintText)) {
                if (typeof cmHint === "string") {
                    combinedList.push({
                        text: cmHint,
                        displayText: cmHint,
                    });
                } else {
                    combinedList.push(cmHint);
                }
            }
        }
        cmJsHintResult.list = combinedList;
        if (token.string.length > 0 && token.start < cursor.ch) {
            cmJsHintResult.from = CodeMirror.Pos(
                cursor.line,
                token.start
            );
            cmJsHintResult.to = CodeMirror.Pos(
                cursor.line,
                token.end
            );
        }
        return cmJsHintResult;
    } else if (topLevelSuggestions.length > 0) {
        return {
            list: topLevelSuggestions,
            from: CodeMirror.Pos(cursor.line, token.start),
            to: CodeMirror.Pos(cursor.line, token.end),
        };
    }
    return cmJsHintResult;
}
























export function toggleDevConsole(focusInput = true) {
    if (!state.devConsoleElement || !state.mainView) return;

    state.isConsoleVisible = !state.isConsoleVisible;
    if (state.isConsoleVisible) {
        // Ensure state.mainView is the flex container for the console
        const consoleParent = state.devConsoleElement.parentElement;
        if (
            consoleParent !== state.mainView &&
            state.mainView.contains(state.devConsoleElement)
        ) {
            // This case should ideally not happen if HTML structure is correct
            console.warn(
                "Developer console is not a direct child of main-view. Layout might be unexpected."
            );
        } else if (consoleParent !== state.mainView) {
            // If console is elsewhere, this logic might need adjustment or be removed
            // For now, assuming it's meant to be part of state.mainView's flex layout
        }

        const mainViewHeight = state.mainView.clientHeight;
        const consoleHeight = Math.min(
            mainViewHeight * (state.CONSOLE_MAX_HEIGHT_PERCENT / 100),
            300
        );
        state.devConsoleElement.style.maxHeight = `${consoleHeight}px`;
        state.devConsoleElement.classList.add("visible");

        if (state.consoleCodeMirrorInstance && focusInput) {
            state.consoleCodeMirrorInstance.focus();
            state.consoleCodeMirrorInstance.refresh();
        }

        if (
            !state.hasShownConsoleWelcomeMessage &&
            state.consoleCodeMirrorInstance &&
            state.consoleCodeMirrorInstance.getValue().trim() === ""
        ) {
            logToConsole(
                "Console opened. Type /help or JS code. Ctrl+Space for hints. Up/Down for history.",
                "info"
            );
            state.hasShownConsoleWelcomeMessage = true;
        }
    } else {
        state.devConsoleElement.style.maxHeight = "0";
        state.devConsoleElement.classList.remove("visible");

        if (state.consoleCodeMirrorInstance) {
            state.consoleCodeMirrorInstance.getInputField().blur();
        }
    }

    // Refresh CodeMirror after transition if it became visible
    // and ensure focus if requested.
    setTimeout(() => {
        if (state.isConsoleVisible && state.consoleCodeMirrorInstance) {
            state.consoleCodeMirrorInstance.refresh();
            if (
                focusInput &&
                document.activeElement !==
                    state.consoleCodeMirrorInstance.getInputField()
            ) {
                state.consoleCodeMirrorInstance.focus();
            }
        }
    }, 310); // Slightly after transition duration
}

export function processConsoleInput(inputValue) {
    if (inputValue.startsWith("/")) {
        const parts =
            inputValue.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
        if (parts.length === 0) return;

        const commandName = parts[0].substring(1).toLowerCase();
        const args = parts.map((p) =>
            p.startsWith('"') && p.endsWith('"')
                ? p.slice(1, -1)
                : p
        );

        const commandObject = slashCommands[commandName];
        if (
            commandObject &&
            typeof commandObject.func === "function"
        ) {
            try {
                const result = commandObject.func(args);
                if (result !== undefined) {
                    logToConsole(
                        result,
                        "success",
                        typeof result === "object" ||
                            (typeof result === "string" &&
                                result.includes("\n"))
                    );
                }
            } catch (e) {
                logToConsole(
                    `Error executing command /${commandName}: ${e.message}`,
                    "error"
                );
                console.error(`Command /${commandName} error:`, e);
            }
        } else {
            logToConsole(
                `Unknown command: ${parts[0]}. Type /help for available commands.`,
                "error"
            );
        }
    } else {
        try {
            const result = (function (api) {
                const apiKeys = Object.keys(api);

                const P = new Proxy(api, {
                    get(target, prop, receiver) {
                        if (apiKeys.includes(prop))
                            return target[prop];
                        if (prop in window) {
                            if (typeof window[prop] === "function")
                                return window[prop].bind(window);
                            return window[prop];
                        }
                        return undefined;
                    },
                });

                return eval.call(P, `with(this) { ${inputValue} }`);
            })(opentaggerAPI);

            if (result !== undefined) {
                logToConsole(
                    result,
                    "info",
                    typeof result === "object" ||
                        (typeof result === "string" &&
                            result.includes("\n"))
                );
            }
        } catch (e) {
            logToConsole(String(e), "error");
            console.error("JS execution error:", e);
        }
    }
}
