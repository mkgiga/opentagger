// Search expression engine: pure parsing/evaluation of the search
// syntax. DOM filtering (filterEntries) lives in ui/search.js.

/**
 * Recursively evaluate a boolean tag-search expression against a list
 * of tag strings. Supported tokens:
 *   - bare term            -> substring match against any tag
 *   - !expr                -> negation
 *   - (expr)               -> grouping
 *   - expr && expr         -> AND
 *   - expr || expr         -> OR
 *   - "true" / "false"     -> literal
 */
export function evaluateExpression(expression, tags) {
    expression = expression.trim();
    if (expression === "") {
        return false;
    }
    if (expression.toLowerCase() === "true") return true;
    if (expression.toLowerCase() === "false") return false;
    if (expression.startsWith("(") && expression.endsWith(")")) {
        let balance = 0;
        let fullyEnclosed = true;
        for (let i = 0; i < expression.length - 1; i++) {
            if (expression[i] === "(") balance++;
            else if (expression[i] === ")") balance--;
            if (balance === 0) {
                fullyEnclosed = false;
                break;
            }
        }
        if (expression[expression.length - 1] === ")") balance--;
        if (fullyEnclosed && balance === 0) {
            const innerExpression = expression
                .substring(1, expression.length - 1)
                .trim();
            if (innerExpression === "") return false;
            return evaluateExpression(innerExpression, tags);
        }
    }
    if (expression.startsWith("!")) {
        const subExpression = expression.substring(1).trim();
        return !evaluateExpression(subExpression, tags);
    }
    let balance = 0;
    for (let i = expression.length - 1; i >= 1; i--) {
        if (expression[i] === ")") balance++;
        else if (expression[i] === "(") balance--;
        else if (
            expression[i - 1] === "|" &&
            expression[i] === "|" &&
            balance === 0
        ) {
            const left = expression.substring(0, i - 1).trim();
            const right = expression.substring(i + 1).trim();
            return (
                evaluateExpression(left || "false", tags) ||
                evaluateExpression(right || "false", tags)
            );
        }
    }
    balance = 0;
    for (let i = expression.length - 1; i >= 1; i--) {
        if (expression[i] === ")") balance++;
        else if (expression[i] === "(") balance--;
        else if (
            expression[i - 1] === "&" &&
            expression[i] === "&" &&
            balance === 0
        ) {
            const left = expression.substring(0, i - 1).trim();
            const right = expression.substring(i + 1).trim();
            return (
                evaluateExpression(left || "true", tags) &&
                evaluateExpression(right || "true", tags)
            );
        }
    }
    const term = expression.toLowerCase();
    return tags.some((tag) => tag.toLowerCase().includes(term));
}

/**
 * Pull out the leaf identifiers from a search expression. Used to
 * decide which tags should be highlighted in the UI for the current
 * query. Strips operators, parens, and quote characters.
 */
export function getQueryLeafTerms(expression) {
    const terms = new Set();
    const termExtractionRegex = /(?:[^\s()&|!]+|"[^"]*")+/g;
    let match;
    while ((match = termExtractionRegex.exec(expression)) !== null) {
        const term = match[0].replace(/^"|"$/g, "").toLowerCase();
        if (term && term !== "true" && term !== "false") {
            if (!/^[&|!]+$/.test(term) && term.length > 0) {
                terms.add(term);
            }
        } else if (
            (term === "true" || term === "false") &&
            match[0].startsWith('"')
        ) {
            terms.add(term);
        }
    }
    return Array.from(terms).sort();
}
