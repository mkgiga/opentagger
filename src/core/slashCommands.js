// Slash-command table for the dev console.
//
// Each entry maps a command name (used as `/name args...`) to a
// runner that delegates to opentaggerAPI. The shape includes a
// `signature` string for hint rendering and `apiRef` for help text.

import { opentaggerAPI } from "./api.js";
import { parseRawTagInput } from "../utils/text.js";

export const slashCommands = {
    search: {
        func: (args) => {
            if (args.length < 2) return "Usage: /search <query>";
            const query = args.slice(1).join(" ");
            return opentaggerAPI.search(query);
        },
        signature: "<query terms...>",
        apiRef: "search",
    },
    select: {
        func: (args) => {
            const query = args.slice(1).join(" ");
            return opentaggerAPI.selectEntries(query, false);
        },
        signature: "[query terms... (empty for all visible)]",
        apiRef: "selectEntries",
    },
    selectappend: {
        func: (args) => {
            const query = args.slice(1).join(" ");
            if (!query)
                return "Usage: /selectappend <query terms...>";
            return opentaggerAPI.selectEntries(query, true);
        },
        signature: "<query terms...>",
        apiRef: "selectEntries",
    },
    filter: {
        func: (args) => {
            if (args.length < 2)
                return "Usage: /filter <query terms...>";
            const query = args.slice(1).join(" ");
            return opentaggerAPI.filterSelectedEntries(query);
        },
        signature: "<query terms...>",
        apiRef: "filterSelectedEntries",
    },
    deselectall: {
        func: (args) => {
            return opentaggerAPI.deselectAllEntries();
        },
        signature: "",
        apiRef: "deselectAllEntries",
    },
    add: {
        func: (args) => {
            if (args.length < 2)
                return "Usage: /add <tag1>, [tag2], ...";
            const rawTagsString = args.slice(1).join(" ");
            const tagsArray = parseRawTagInput(rawTagsString);
            if (tagsArray.length === 0)
                return "No valid tags provided.";
            return opentaggerAPI.addTagsToSelected(tagsArray);
        },
        signature: "<tag1>, [tag2 with spaces], ...",
        apiRef: "addTagsToSelected",
    },
    remove: {
        func: (args) => {
            if (args.length < 2)
                return "Usage: /remove <tag1>, [tag2], ...";
            const rawTagsString = args.slice(1).join(" ");
            const tagsArray = parseRawTagInput(rawTagsString);
            if (tagsArray.length === 0)
                return "No valid tags provided.";
            return opentaggerAPI.removeTagsFromSelected(tagsArray);
        },
        signature: "<tag1>, [tag2 with spaces], ...",
        apiRef: "removeTagsFromSelected",
    },
    rename: {
        func: (args) => {
            let global = false;
            const positionalArgs = [];
            for (const arg of args.slice(1)) {
                if (arg.toLowerCase() === "--global=true") {
                    global = true;
                } else {
                    positionalArgs.push(arg);
                }
            }

            if (positionalArgs.length < 2) {
                return "Usage: /rename <targetTag> <replaceValue> [--global=true]";
            }

            const targetTag = positionalArgs[0];
            const replaceValue = positionalArgs[1];

            return opentaggerAPI.rename({
                targetTag,
                replaceValue,
                global,
            });
        },
        signature: "<targetTag> <replaceValue> [--global=true]",
        apiRef: "rename",
    },
    count: {
        func: (args) => {
            if (args.length < 2)
                return "Usage: /count <tag1>, [tag2], ...";
            const rawTagsString = args.slice(1).join(" ");
            const tagsArray = parseRawTagInput(rawTagsString);
            if (tagsArray.length === 0)
                return "No valid tags provided.";
            return opentaggerAPI.count(tagsArray);
        },
        signature: "<tag1>, [tag2 with spaces], ...",
        apiRef: "count",
    },
    clear: {
        func: (args) => {
            return opentaggerAPI.clear();
        },
        signature: "",
        apiRef: "clear",
    },
    help: {
        func: (args) => {
            return opentaggerAPI.help();
        },
        signature: "",
        apiRef: "help",
    },
};
