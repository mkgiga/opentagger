// Color helpers.

/**
 * Deterministically map a tag string to a colored HSL value. Used to
 * highlight search-matched tags with a stable color per term.
 */
export function getTagColor(tagText) {
    let hash = 0;
    for (let i = 0; i < tagText.length; i++) {
        hash = tagText.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 45%)`;
}
