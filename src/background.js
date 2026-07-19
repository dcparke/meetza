if (typeof importScripts === "function") {
  importScripts("platform.js", "common.js", "build-config.js", "auth.js");
}

(() => {
  "use strict";

  const { raw, call, storageGet, storageSet } = MeetzaPlatform;
  const {
    SETTINGS_KEY,
    PEOPLE_KEY,
    GMAIL_ORIGIN,
    GMAIL_MATCH,
    CONTENT_SCRIPT_ID,
    FREEBUSY_URL,
    MESSAGES,
    LIMITS,
    DEFAULTS,
    systemTimezone,
    timezoneOption,
    normalizeSettings,
    isDate,
    dateSpanDays,
    zonedDateTime,
    freeRanges
  } = Meetza;

  const activeRequests = new Map();
  const requestHistory = new Map();
  let globalHistory = [];
  let ready = null;
  let gmailSync = Promise.resolve();

  ensureReady().catch(logInitializationError);

  raw.permissions.onAdded?.addListener((permissions) => {
    if (permissions.origins?.includes(GMAIL_MATCH)) {
      enableAfterPermissionAdded().catch(logInitializationError);
    }
  });

  raw.permissions.onRemoved?.addListener((permissions) => {
    if (permissions.origins?.includes(GMAIL_MATCH)) {
      disableAfterPermissionRemoval().catch(logInitializationError);
    }
  });

  raw.tabs.onRemoved?.addListener((tabId) => {
    activeRequests.get(tabId)?.abort();
    activeRequests.delete(tabId);
    requestHistory.delete(tabId);
  });

  raw.runtime.onMessage.addListener((message, sender, respond) => {
    handleMessage(message, sender)
      .then(respond)
      .catch((error) => respond({ ok: false, error: safeMessage(error) }));
    return true;
  });

  function ensureReady() {
    if (!ready) {
      ready = initialize().catch((error) => {
        ready = null;
        throw error;
      });
    }
    return ready;
  }

  async function initialize() {
    await lockStorage();

    const stored = await storageGet(SETTINGS_KEY);
    const settings = normalizeSettings(stored[SETTINGS_KEY]);

    if (!stored[SETTINGS_KEY]) {
      await storageSet({ [SETTINGS_KEY]: settings });
    }

    await syncGmail(settings);
  }

  async function lockStorage() {
    const trusted = { accessLevel: "TRUSTED_CONTEXTS" };

    if (raw.storage.local.setAccessLevel) {
      await call(raw.storage.local, "setAccessLevel", trusted);
    }

    if (raw.storage.session?.setAccessLevel) {
      await call(raw.storage.session, "setAccessLevel", trusted);
    }
  }

  async function handleMessage(message, sender) {
    await ensureReady();

    if (!message || typeof message !== "object") {
      throw new Error("Invalid request.");
    }

    switch (message.type) {
      case MESSAGES.STATE:
        requireGmailSender(sender);
        return getState();

      case MESSAGES.GENERATE:
        requireGmailSender(sender);
        return generate(message.payload, sender.tab.id);

      case MESSAGES.REMEMBER_PERSON:
        requireGmailSender(sender);
        return rememberPerson(message.email);

      case MESSAGES.SYNC_GMAIL:
        requireExtensionSender(sender);
        return syncGmail();

      default:
        throw new Error("Unknown request.");
    }
  }

  function requireGmailSender(sender) {
    const url = sender.url || sender.tab?.url || "";
    let origin = "";

    try {
      origin = new URL(url).origin;
    } catch {
      throw new Error("Invalid sender.");
    }

    if (
      sender.id !== raw.runtime.id ||
      !Number.isInteger(sender.tab?.id) ||
      origin !== GMAIL_ORIGIN
    ) {
      throw new Error("Request denied.");
    }
  }

  function requireExtensionSender(sender) {
    if (
      sender.id !== raw.runtime.id ||
      sender.tab ||
      typeof sender.url !== "string" ||
      !sender.url.startsWith(raw.runtime.getURL("/"))
    ) {
      throw new Error("Request denied.");
    }
  }

  async function getState() {
    const stored = await storageGet([SETTINGS_KEY, PEOPLE_KEY]);
    const settings = normalizeSettings(stored[SETTINGS_KEY]);
    const recentPeople = settings.rememberRecentPeople
      ? normalizePeople(stored[PEOPLE_KEY])
      : [];

    return { ok: true, settings, recentPeople };
  }

  async function rememberPerson(value) {
    const settings = await loadSettings();
    const email = normalizeEmail(value);

    if (!settings.rememberRecentPeople || !email) {
      return { ok: true, recentPeople: [] };
    }

    const stored = await storageGet(PEOPLE_KEY);
    const recentPeople = [
      email,
      ...normalizePeople(stored[PEOPLE_KEY]).filter((item) => item !== email)
    ].slice(0, LIMITS.recentPeople);

    await storageSet({ [PEOPLE_KEY]: recentPeople });
    return { ok: true, recentPeople };
  }

  async function generate(payload, tabId) {
    checkRateLimit(tabId, Array.isArray(payload?.dates) ? payload.dates.length : 1);

    if (activeRequests.has(tabId)) {
      throw new Error("A Meetza request is already running in this tab.");
    }

    const request = validateRequest(payload);
    const settings = await loadSettings();
    const controller = new AbortController();
    activeRequests.set(tabId, controller);

    try {
      let token = await MeetzaAuth.getToken(true);
      let retriedToken = false;
      const days = [];
      const boundaryTimezone = systemTimezone();

      for (const date of request.dates) {
        const start = zonedDateTime(date, settings.workdayStart, boundaryTimezone);
        const end = zonedDateTime(date, settings.workdayEnd, boundaryTimezone);

        let result = await queryFreeBusy({
          token,
          calendars: request.calendars,
          start,
          end,
          timezone: boundaryTimezone,
          signal: controller.signal
        });

        if (result.status === 401 && !retriedToken) {
          retriedToken = true;
          await MeetzaAuth.invalidate(token);
          token = await MeetzaAuth.getToken(true);
          result = await queryFreeBusy({
            token,
            calendars: request.calendars,
            start,
            end,
            timezone: boundaryTimezone,
            signal: controller.signal
          });
        }

        if (result.status !== 200) {
          throw calendarError(result.status);
        }

        const parsed = parseFreeBusy(result.body, request.calendars);
        if (parsed.unavailable.length) {
          return {
            ok: false,
            code: "CALENDAR_UNAVAILABLE",
            calendars: parsed.unavailable
          };
        }

        const slots = freeRanges({
          busy: parsed.busy,
          start,
          end,
          duration: request.duration,
          breakMinutes: settings.breakMinutes
        }).map((range) => ({
          start: new Date(range.start).toISOString(),
          end: new Date(range.end).toISOString()
        }));

        days.push({ date, slots });
      }

      return {
        ok: true,
        duration: request.duration,
        outputTimezone: request.outputTimezone,
        days
      };
    } finally {
      activeRequests.delete(tabId);
    }
  }

  function validateRequest(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Invalid request.");
    }

    const allowed = ["dates", "calendars", "duration", "outputTimezone"];
    if (Object.keys(payload).some((key) => !allowed.includes(key))) {
      throw new Error("Unexpected request fields.");
    }

    const dates = Array.isArray(payload.dates)
      ? [...new Set(payload.dates)]
      : [];
    const calendars = Array.isArray(payload.calendars)
      ? [...new Set(payload.calendars.map(normalizeCalendar).filter(Boolean))]
      : [];
    const duration = Number(payload.duration);

    if (!dates.length || dates.length > LIMITS.dates || dates.some((date) => !isDate(date))) {
      throw new Error(`Choose between 1 and ${LIMITS.dates} valid dates.`);
    }

    if (dateSpanDays(dates) > LIMITS.dateSpanDays) {
      throw new Error(`Selected dates must fit within ${LIMITS.dateSpanDays} days.`);
    }

    if (!calendars.length || calendars.length > LIMITS.calendars) {
      throw new Error(`Choose between 1 and ${LIMITS.calendars} calendars.`);
    }

    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
      throw new Error("Meeting Length must be between 1 and 1440 minutes.");
    }

    if (!timezoneOption(payload.outputTimezone)) {
      throw new Error("Choose a supported Time Zone.");
    }

    return {
      dates: dates.sort(),
      calendars,
      duration,
      outputTimezone: payload.outputTimezone
    };
  }

  async function queryFreeBusy({ token, calendars, start, end, timezone, signal }) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 15_000);
    const abort = () => timeout.abort();

    if (signal.aborted) {
      timeout.abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }

    try {
      const response = await fetch(FREEBUSY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          timeZone: timezone,
          calendarExpansionMax: calendars.length,
          items: calendars.map((id) => ({ id }))
        }),
        cache: "no-store",
        signal: timeout.signal
      });

      if (response.status === 401) {
        return { status: 401, body: null };
      }

      if (!response.ok) {
        return { status: response.status, body: null };
      }

      return { status: 200, body: await response.json() };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }

  function parseFreeBusy(body, calendars) {
    if (!body || typeof body !== "object" || !body.calendars || typeof body.calendars !== "object") {
      throw new Error("Google returned an invalid response.");
    }

    const busy = [];
    const unavailable = [];

    for (const id of calendars) {
      const calendar = body.calendars[id];

      if (!calendar || !Array.isArray(calendar.busy) || (calendar.errors?.length ?? 0) > 0) {
        unavailable.push(id);
        continue;
      }

      if (calendar.busy.length > LIMITS.busyRangesPerCalendar) {
        throw new Error("Google returned too many busy ranges.");
      }

      for (const range of calendar.busy) {
        if (
          typeof range?.start !== "string" ||
          typeof range?.end !== "string" ||
          range.start.length > 64 ||
          range.end.length > 64
        ) {
          throw new Error("Google returned an invalid busy range.");
        }

        const start = Date.parse(range.start);
        const end = Date.parse(range.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
          throw new Error("Google returned an invalid busy range.");
        }

        busy.push({ start, end });
      }
    }

    return { busy, unavailable };
  }

  function checkRateLimit(tabId, windowCost) {
    const now = Date.now();
    const minuteAgo = now - 60_000;
    const tabHistory = (requestHistory.get(tabId) || []).filter((item) => item.time > minuteAgo);
    globalHistory = globalHistory.filter((item) => item.time > minuteAgo);

    const tabWindows = tabHistory.reduce((sum, item) => sum + item.cost, 0);
    const globalWindows = globalHistory.reduce((sum, item) => sum + item.cost, 0);
    const last = tabHistory.at(-1);

    if (last && now - last.time < 750) {
      throw new Error("Please wait a moment before generating again.");
    }

    if (tabHistory.length >= 20 || tabWindows + windowCost > 60) {
      throw new Error("This tab has generated too many requests. Try again in a minute.");
    }

    if (globalHistory.length >= 60 || globalWindows + windowCost > 180) {
      throw new Error("Meetza has generated too many requests. Try again in a minute.");
    }

    const entry = { time: now, cost: Math.max(1, windowCost) };
    tabHistory.push(entry);
    globalHistory.push(entry);
    requestHistory.set(tabId, tabHistory);
  }

  function syncGmail(settings = null) {
    const run = () => applyGmailState(settings);
    gmailSync = gmailSync.then(run, run);
    return gmailSync;
  }

  async function applyGmailState(settings = null) {
    const current = settings || (await loadSettings());
    const permission = await MeetzaPlatform.permissionContains({ origins: [GMAIL_MATCH] });
    const shouldRun = current.enabled && permission;

    await unregisterContentScript();

    if (shouldRun) {
      await MeetzaPlatform.registerScripts([
        {
          id: CONTENT_SCRIPT_ID,
          matches: [GMAIL_MATCH],
          js: ["content-api.js", "common.js", "content.js"],
          runAt: "document_idle"
        }
      ]);
      await injectExistingGmailTabs();
    } else {
      for (const controller of activeRequests.values()) {
        controller.abort();
      }
      activeRequests.clear();
      await shutdownGmailTabs();
    }

    return { ok: true, enabled: shouldRun };
  }

  async function unregisterContentScript() {
    try {
      await MeetzaPlatform.unregisterScripts({ ids: [CONTENT_SCRIPT_ID] });
    } catch {
      // A missing registration is already the desired state.
    }
  }

  async function injectExistingGmailTabs() {
    const tabs = await MeetzaPlatform.tabsQuery({ url: GMAIL_MATCH });

    for (const tab of tabs) {
      if (!Number.isInteger(tab.id)) {
        continue;
      }

      try {
        await MeetzaPlatform.executeScript({
          target: { tabId: tab.id },
          files: ["content-api.js", "common.js", "content.js"]
        });
      } catch {
        // Gmail may be navigating or the tab may have closed.
      }
    }
  }

  async function shutdownGmailTabs() {
    // Querying every tab avoids depending on Gmail permission during teardown.
    // Tabs without Meetza simply reject the message and are ignored.
    const tabs = await MeetzaPlatform.tabsQuery({});

    for (const tab of tabs) {
      if (!Number.isInteger(tab.id)) {
        continue;
      }

      try {
        await MeetzaPlatform.tabsSendMessage(tab.id, { type: MESSAGES.SHUTDOWN });
      } catch {
        // No Meetza content script is running in this tab.
      }
    }
  }

  async function enableAfterPermissionAdded() {
    await ensureReady();
    const settings = { ...(await loadSettings()), enabled: true };
    await storageSet({ [SETTINGS_KEY]: settings });
    await syncGmail(settings);
  }

  async function disableAfterPermissionRemoval() {
    const settings = await loadSettings();
    await storageSet({ [SETTINGS_KEY]: { ...settings, enabled: false } });
    await unregisterContentScript();
    await shutdownGmailTabs();
  }

  async function loadSettings() {
    const stored = await storageGet(SETTINGS_KEY);
    return normalizeSettings(stored[SETTINGS_KEY]);
  }

  function normalizeCalendar(value) {
    if (typeof value !== "string") {
      return "";
    }

    const id = value.trim().toLowerCase();
    return id && id.length <= LIMITS.calendarIdLength ? id : "";
  }

  function normalizeEmail(value) {
    const email = normalizeCalendar(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
  }

  function normalizePeople(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map(normalizeEmail)
      .filter(Boolean)
      .filter((email, index, all) => all.indexOf(email) === index)
      .slice(0, LIMITS.recentPeople);
  }

  function calendarError(status) {
    if (status === 401) {
      return new Error("Google authorization expired. Try again.");
    }
    if (status === 403) {
      return new Error("Google Calendar denied the availability request.");
    }
    if (status === 429) {
      return new Error("Google Calendar is busy. Try again shortly.");
    }
    return new Error(`Google Calendar request failed (${status}).`);
  }

  function safeMessage(error) {
    if (error?.name === "AbortError") {
      return "The request was cancelled.";
    }
    return error instanceof Error ? error.message : "Meetza could not complete the request.";
  }

  function logInitializationError(error) {
    console.error("[Meetza] Initialization failed.", error);
  }

})();
