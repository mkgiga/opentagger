// Time-related helpers.

/**
 * Standard trailing-edge debounce. Returns a wrapper that delays
 * invoking `func` until `wait` ms have elapsed since the last call.
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Start a polling timer that calls `updateCallback(elapsedText)` every
 * `intervalMs`. Returns a handle with `stop()` -> elapsed seconds, and
 * `getElapsedTime()` -> "X.Xs" string.
 */
export function startTimer(updateCallback, intervalMs = 100) {
    const startTime = performance.now();
    const intervalId = setInterval(() => {
        const elapsedMs = performance.now() - startTime;
        updateCallback((elapsedMs / 1000).toFixed(1) + "s");
    }, intervalMs);
    return {
        stop: () => {
            clearInterval(intervalId);
            const elapsedMs = performance.now() - startTime;
            return elapsedMs / 1000;
        },
        getElapsedTime: () => {
            const elapsedMs = performance.now() - startTime;
            return (elapsedMs / 1000).toFixed(1) + "s";
        },
    };
}
