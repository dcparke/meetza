(() => {
  "use strict";

  const SETTINGS_KEY = "meetzaSettings";
  const RECENT_PEOPLE_KEY = "meetzaRecentPeople";

  const GMAIL_ORIGIN = "https://mail.google.com";
  const GMAIL_MATCH = `${GMAIL_ORIGIN}/*`;
  const DYNAMIC_CONTENT_SCRIPT_ID = "meetza-gmail-anchor";

  const MAX_RECENT_PEOPLE = 15;
  const MAX_SELECTED_DATES = 31;
  const MAX_CALENDARS = 50;
  const MAX_DATE_SPAN_DAYS = 120;
  const MAX_BREAK_MINUTES = 240;

  const MESSAGES = Object.freeze({
    GET_STATE: "MEETZA_GET_STATE",
    SAVE_SETTINGS: "MEETZA_SAVE_SETTINGS",
    SET_ENABLED: "MEETZA_SET_ENABLED",
    GENERATE: "MEETZA_GENERATE",
    REMEMBER_PERSON: "MEETZA_REMEMBER_PERSON",
    CLEAR_RECENT_PEOPLE: "MEETZA_CLEAR_RECENT_PEOPLE",
    REGISTER_PANEL: "MEETZA_REGISTER_PANEL",
    REMOVE_GMAIL_UI: "MEETZA_REMOVE_GMAIL_UI"
  });

  const TIMEZONE_OPTIONS = Object.freeze([
    Object.freeze({ name: "Eastern Time", zone: "America/New_York" }),
    Object.freeze({ name: "Central Time", zone: "America/Chicago" }),
    Object.freeze({ name: "Mountain Time", zone: "America/Denver" }),
    Object.freeze({ name: "Arizona Time", zone: "America/Phoenix" }),
    Object.freeze({ name: "Pacific Time", zone: "America/Los_Angeles" }),
    Object.freeze({ name: "Alaska Time", zone: "America/Anchorage" }),
    Object.freeze({ name: "Hawaii Time", zone: "Pacific/Honolulu" }),
    Object.freeze({ name: "Coordinated Universal Time", zone: "UTC" })
  ]);

  const SYSTEM_TIMEZONE_ALIASES = Object.freeze({
    "America/Detroit": "America/New_York",
    "America/Indiana/Indianapolis": "America/New_York",
    "America/Kentucky/Louisville": "America/New_York",
    "America/Boise": "America/Denver",
    "America/Juneau": "America/Anchorage",
    "America/Sitka": "America/Anchorage",
    "America/Yakutat": "America/Anchorage"
  });

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    duration: 60,
    breakMinutes: 0,
    workdayStart: "09:00",
    workdayEnd: "17:00",
    outputTimezone: getDefaultOutputTimezone(),
    rememberRecentPeople: false
  });

  function getSystemTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }

  function getTimezoneOption(zone) {
    return TIMEZONE_OPTIONS.find((option) => option.zone === zone) || null;
  }

  function getDefaultOutputTimezone(systemTimezone = getSystemTimezone()) {
    if (getTimezoneOption(systemTimezone)) {
      return systemTimezone;
    }

    const alias = SYSTEM_TIMEZONE_ALIASES[systemTimezone];
    return getTimezoneOption(alias)?.zone || "UTC";
  }

  function getTimezoneAbbreviation(zone, date = new Date()) {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "short"
    })
      .formatToParts(date)
      .find((item) => item.type === "timeZoneName");

    return part?.value || zone;
  }

  function getTimezoneDisplayName(zone, date = new Date()) {
    const option = getTimezoneOption(zone);

    if (!option) {
      return zone;
    }

    return `${getTimezoneAbbreviation(zone, date)} - ${option.name}`;
  }

  function isSupportedOutputTimezone(zone) {
    return Boolean(getTimezoneOption(zone));
  }

  function isValidTime(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
  }

  function timeToMinutes(value) {
    if (!isValidTime(value)) {
      return NaN;
    }

    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  }

  function clampInteger(value, fallback, minimum, maximum) {
    const number = Number(value);

    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      return fallback;
    }

    return number;
  }

  function normalizeSettings(value = {}) {
    const candidate = value && typeof value === "object" ? value : {};

    const workdayStart = isValidTime(candidate.workdayStart)
      ? candidate.workdayStart
      : DEFAULT_SETTINGS.workdayStart;

    const workdayEnd = isValidTime(candidate.workdayEnd)
      ? candidate.workdayEnd
      : DEFAULT_SETTINGS.workdayEnd;

    const validBoundary = timeToMinutes(workdayEnd) > timeToMinutes(workdayStart);

    return {
      enabled:
        typeof candidate.enabled === "boolean"
          ? candidate.enabled
          : DEFAULT_SETTINGS.enabled,

      duration: clampInteger(
        candidate.duration,
        DEFAULT_SETTINGS.duration,
        1,
        1440
      ),

      breakMinutes: clampInteger(
        candidate.breakMinutes,
        DEFAULT_SETTINGS.breakMinutes,
        0,
        MAX_BREAK_MINUTES
      ),

      workdayStart: validBoundary
        ? workdayStart
        : DEFAULT_SETTINGS.workdayStart,

      workdayEnd: validBoundary
        ? workdayEnd
        : DEFAULT_SETTINGS.workdayEnd,

      outputTimezone: isSupportedOutputTimezone(candidate.outputTimezone)
        ? candidate.outputTimezone
        : DEFAULT_SETTINGS.outputTimezone,

      rememberRecentPeople:
        typeof candidate.rememberRecentPeople === "boolean"
          ? candidate.rememberRecentPeople
          : DEFAULT_SETTINGS.rememberRecentPeople
    };
  }

  const api = Object.freeze({
    SETTINGS_KEY,
    RECENT_PEOPLE_KEY,
    GMAIL_ORIGIN,
    GMAIL_MATCH,
    DYNAMIC_CONTENT_SCRIPT_ID,
    MAX_RECENT_PEOPLE,
    MAX_SELECTED_DATES,
    MAX_CALENDARS,
    MAX_DATE_SPAN_DAYS,
    MAX_BREAK_MINUTES,
    MESSAGES,
    TIMEZONE_OPTIONS,
    DEFAULT_SETTINGS,
    getSystemTimezone,
    getDefaultOutputTimezone,
    getTimezoneAbbreviation,
    getTimezoneDisplayName,
    isSupportedOutputTimezone,
    isValidTime,
    timeToMinutes,
    normalizeSettings
  });

  globalThis.MeetzaConfig = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
