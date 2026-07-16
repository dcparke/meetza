(() => {
  "use strict";

  const MINUTE = 60_000;
  const DAY = 86_400_000;

  const SETTINGS_KEY = "meetza.settings";
  const PEOPLE_KEY = "meetza.people";
  const GMAIL_ORIGIN = "https://mail.google.com";
  const GMAIL_MATCH = `${GMAIL_ORIGIN}/*`;
  const CONTENT_SCRIPT_ID = "meetza-gmail";
  const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
  const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events.freebusy";

  const MESSAGES = Object.freeze({
    STATE: "meetza:state",
    GENERATE: "meetza:generate",
    REMEMBER_PERSON: "meetza:remember-person",
    SYNC_GMAIL: "meetza:sync-gmail",
    SHUTDOWN: "meetza:shutdown"
  });

  const LIMITS = Object.freeze({
    dates: 31,
    calendars: 50,
    dateSpanDays: 120,
    recentPeople: 15,
    breakMinutes: 240,
    busyRangesPerCalendar: 10_000,
    calendarIdLength: 320
  });

  const TIMEZONES = Object.freeze([
    Object.freeze({ zone: "America/New_York", name: "Eastern Time" }),
    Object.freeze({ zone: "America/Chicago", name: "Central Time" }),
    Object.freeze({ zone: "America/Denver", name: "Mountain Time" }),
    Object.freeze({ zone: "America/Phoenix", name: "Arizona Time" }),
    Object.freeze({ zone: "America/Los_Angeles", name: "Pacific Time" }),
    Object.freeze({ zone: "America/Anchorage", name: "Alaska Time" }),
    Object.freeze({ zone: "Pacific/Honolulu", name: "Hawaii Time" }),
    Object.freeze({ zone: "UTC", name: "Coordinated Universal Time" })
  ]);

  const TIMEZONE_ALIASES = Object.freeze({
    "America/Detroit": "America/New_York",
    "America/Indiana/Indianapolis": "America/New_York",
    "America/Kentucky/Louisville": "America/New_York",
    "America/Boise": "America/Denver",
    "America/Juneau": "America/Anchorage",
    "America/Sitka": "America/Anchorage",
    "America/Yakutat": "America/Anchorage"
  });

  function systemTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }

  function timezoneOption(zone) {
    return TIMEZONES.find((item) => item.zone === zone) || null;
  }

  function defaultTimezone(zone = systemTimezone()) {
    if (timezoneOption(zone)) {
      return zone;
    }

    return TIMEZONE_ALIASES[zone] || "UTC";
  }

  function timezoneAbbreviation(zone, date = new Date()) {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "short"
    })
      .formatToParts(date)
      .find((item) => item.type === "timeZoneName");

    return part?.value || zone;
  }

  function timezoneName(zone, date = new Date()) {
    const option = timezoneOption(zone);
    return option
      ? `${timezoneAbbreviation(zone, date)} - ${option.name}`
      : zone;
  }

  const DEFAULTS = Object.freeze({
    enabled: false,
    duration: 60,
    breakMinutes: 0,
    workdayStart: "09:00",
    workdayEnd: "17:00",
    outputTimezone: defaultTimezone(),
    rememberRecentPeople: false
  });

  function isTime(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
  }

  function timeToMinutes(value) {
    if (!isTime(value)) {
      return NaN;
    }

    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  }

  function integer(value, fallback, min, max) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max
      ? number
      : fallback;
  }

  function normalizeSettings(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const start = isTime(source.workdayStart) ? source.workdayStart : DEFAULTS.workdayStart;
    const end = isTime(source.workdayEnd) ? source.workdayEnd : DEFAULTS.workdayEnd;
    const boundaryIsValid = timeToMinutes(end) > timeToMinutes(start);

    return {
      enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULTS.enabled,
      duration: integer(source.duration, DEFAULTS.duration, 1, 1440),
      breakMinutes: integer(
        source.breakMinutes,
        DEFAULTS.breakMinutes,
        0,
        LIMITS.breakMinutes
      ),
      workdayStart: boundaryIsValid ? start : DEFAULTS.workdayStart,
      workdayEnd: boundaryIsValid ? end : DEFAULTS.workdayEnd,
      outputTimezone: timezoneOption(source.outputTimezone)
        ? source.outputTimezone
        : DEFAULTS.outputTimezone,
      rememberRecentPeople:
        typeof source.rememberRecentPeople === "boolean"
          ? source.rememberRecentPeople
          : DEFAULTS.rememberRecentPeople
    };
  }

  function isDate(value) {
    if (typeof value !== "string") {
      return false;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
      return false;
    }

    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  function addDays(dateString, amount) {
    const [year, month, day] = dateString.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + amount);

    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
  }

  function isWeekend(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return weekday === 0 || weekday === 6;
  }

  function nextBusinessDate(dates, timezone = systemTimezone()) {
    const used = new Set(dates);
    let next = dates.length
      ? addDays([...dates].sort().at(-1), 1)
      : today(timezone);

    /*
     * Add Day skips weekends by default. To restore calendar-day behavior,
     * remove the isWeekend(next) check below.
     */
    while (used.has(next) || isWeekend(next)) {
      next = addDays(next, 1);
    }

    return next;
  }

  function today(timezone = systemTimezone()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());

    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );

    return `${values.year}-${values.month}-${values.day}`;
  }

  function weekday(dateString) {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      weekday: "long"
    }).format(new Date(`${dateString}T12:00:00Z`));
  }

  function dateLabel(dateString) {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      weekday: "long",
      month: "short",
      day: "numeric"
    }).format(new Date(`${dateString}T12:00:00Z`));
  }

  function dateSpanDays(dates) {
    if (dates.length < 2) {
      return 0;
    }

    const sorted = [...dates].sort();
    return Math.round(
      (Date.parse(`${sorted.at(-1)}T00:00:00Z`) - Date.parse(`${sorted[0]}T00:00:00Z`)) /
        DAY
    );
  }

  function zonedDateTime(dateString, time, timezone) {
    const [year, month, day] = dateString.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
    let guess = wanted;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = zonedParts(new Date(guess), timezone);
      const actual = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
      );
      const difference = wanted - actual;

      if (difference === 0) {
        break;
      }

      guess += difference;
    }

    return new Date(guess);
  }

  function zonedParts(date, timezone) {
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

  function mergeRanges(ranges) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged = [];

    for (const range of sorted) {
      const previous = merged.at(-1);

      if (!previous || range.start > previous.end) {
        merged.push({ ...range });
      } else {
        previous.end = Math.max(previous.end, range.end);
      }
    }

    return merged;
  }

  function freeRanges({ busy, start, end, duration, breakMinutes = 0 }) {
    const windowStart = start.getTime();
    const windowEnd = end.getTime();
    const minimum = duration * MINUTE;
    const padding = breakMinutes * MINUTE;

    const blocked = mergeRanges(
      busy
        .filter(
          (range) =>
            Number.isFinite(range.start) &&
            Number.isFinite(range.end) &&
            range.start < windowEnd &&
            range.end > windowStart
        )
        .map((range) => ({
          start: Math.max(windowStart, range.start - padding),
          end: Math.min(windowEnd, range.end + padding)
        }))
    );

    const free = [];
    let cursor = windowStart;

    for (const range of blocked) {
      if (range.start - cursor >= minimum) {
        free.push({ start: cursor, end: range.start });
      }
      cursor = Math.max(cursor, range.end);
    }

    if (windowEnd - cursor >= minimum) {
      free.push({ start: cursor, end: windowEnd });
    }

    return free;
  }

  const api = Object.freeze({
    SETTINGS_KEY,
    PEOPLE_KEY,
    GMAIL_ORIGIN,
    GMAIL_MATCH,
    CONTENT_SCRIPT_ID,
    FREEBUSY_URL,
    GOOGLE_SCOPE,
    MESSAGES,
    LIMITS,
    TIMEZONES,
    DEFAULTS,
    systemTimezone,
    defaultTimezone,
    timezoneOption,
    timezoneAbbreviation,
    timezoneName,
    isTime,
    timeToMinutes,
    normalizeSettings,
    isDate,
    addDays,
    nextBusinessDate,
    today,
    weekday,
    dateLabel,
    dateSpanDays,
    zonedDateTime,
    mergeRanges,
    freeRanges
  });

  globalThis.Meetza = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
