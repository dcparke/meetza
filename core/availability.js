(() => {
  "use strict";

  const MINUTE_MS = 60_000;

  function mergeRanges(ranges) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged = [];

    for (const range of sorted) {
      const previous = merged.at(-1);

      if (!previous || range.start > previous.end) {
        merged.push({ ...range });
        continue;
      }

      previous.end = Math.max(previous.end, range.end);
    }

    return merged;
  }

  function findFreeRanges({
    busyRanges,
    windowStart,
    windowEnd,
    minimumMinutes,
    breakMinutes = 0
  }) {
    const start = windowStart.getTime();
    const end = windowEnd.getTime();
    const minimumDuration = minimumMinutes * MINUTE_MS;
    const breakDuration = breakMinutes * MINUTE_MS;

    const preparedBusyRanges = mergeRanges(
      busyRanges
        .filter((range) => {
          return (
            Number.isFinite(range.start) &&
            Number.isFinite(range.end) &&
            range.start < end &&
            range.end > start
          );
        })
        .map((range) => ({
          start: Math.max(start, range.start - breakDuration),
          end: Math.min(end, range.end + breakDuration)
        }))
    );

    const freeRanges = [];
    let cursor = start;

    for (const busy of preparedBusyRanges) {
      if (busy.start - cursor >= minimumDuration) {
        freeRanges.push({ start: cursor, end: busy.start });
      }

      cursor = Math.max(cursor, busy.end);
    }

    if (end - cursor >= minimumDuration) {
      freeRanges.push({ start: cursor, end });
    }

    return freeRanges;
  }

  const api = Object.freeze({ mergeRanges, findFreeRanges });
  globalThis.MeetzaAvailability = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
