(() => {
  "use strict";

  function zonedDateTimeToDate(dateString, hour, minute, timezone) {
    const [year, month, day] = dateString.split("-").map(Number);

    const desiredWallTime = Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      0
    );

    let guess = desiredWallTime;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = getZonedParts(new Date(guess), timezone);

      const actualWallTime = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
      );

      const difference = desiredWallTime - actualWallTime;

      if (difference === 0) {
        break;
      }

      guess += difference;
    }

    return new Date(guess);
  }

  function getZonedParts(date, timezone) {
    return Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      })
        .formatToParts(date)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)])
    );
  }

  const api = Object.freeze({ zonedDateTimeToDate, getZonedParts });
  globalThis.MeetzaTime = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
