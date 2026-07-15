"use strict";

importScripts(
  chrome.runtime.getURL("shared/config.js"),
  chrome.runtime.getURL("core/availability.js"),
  chrome.runtime.getURL("core/time.js")
);

const {
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
  getSystemTimezone,
  isSupportedOutputTimezone,
  isValidTime,
  timeToMinutes,
  normalizeSettings
} = MeetzaConfig;

const { findFreeRanges } = MeetzaAvailability;
const { zonedDateTimeToDate } = MeetzaTime;

const FREE_BUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CALENDAR_ID_LENGTH = 512;
const MAX_BUSY_RANGES_PER_CALENDAR = 5_000;
const MIN_REQUEST_INTERVAL_MS = 750;
const MAX_REQUESTS_PER_MINUTE = 20;
const MAX_FREEBUSY_WINDOWS_PER_MINUTE = 60;

const PANEL_TOKENS_KEY = "meetzaPanelTokens";
const PANEL_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_PANEL_TOKENS_PER_TAB = 10;

const requestStateByTab = new Map();

// Privileged message handling waits for the storage boundary to be enforced.
const securityReady = restrictStorageAccess();
securityReady.catch(logOperationalFailure);

initializeExtension().catch(logOperationalFailure);

chrome.runtime.onInstalled.addListener(() => {
  initializeExtension().catch(logOperationalFailure);
});

chrome.runtime.onStartup.addListener(() => {
  initializeExtension().catch(logOperationalFailure);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  abortRequestForTab(tabId);
  requestStateByTab.delete(tabId);
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (!permissions.origins?.includes(GMAIL_MATCH)) {
    return;
  }

  disableMeetzaAfterPermissionRemoval().catch(logOperationalFailure);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error
          ? error.message
          : "Meetza could not complete the request."
      });
    });

  return true;
});

async function restrictStorageAccess() {
  await Promise.all([
    chrome.storage.local.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS"
    }),
    chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS"
    })
  ]);
}

async function initializeExtension() {
  await securityReady;
  await synchronizeGmailRegistration();
}

// All privileged actions enter through this message boundary.
async function handleMessage(message, sender) {
  await securityReady;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { ok: false, error: "The request is invalid." };
  }

  switch (message.type) {
    case MESSAGES.GET_STATE:
      if (isPopupSender(sender)) {
        return getPublicState(false);
      }

      await assertTrustedPanelSender(sender, message.panelToken);
      return getPublicState(true);

    case MESSAGES.SAVE_SETTINGS:
      assertTrustedExtensionPage(sender, ["popup"]);
      return saveSettings(message.settings);

    case MESSAGES.SET_ENABLED:
      assertTrustedExtensionPage(sender, ["popup"]);
      return setEnabled(Boolean(message.enabled));

    case MESSAGES.CLEAR_RECENT_PEOPLE:
      assertTrustedExtensionPage(sender, ["popup"]);
      await chrome.storage.local.remove(RECENT_PEOPLE_KEY);
      return { ok: true };

    case MESSAGES.REGISTER_PANEL:
      assertTrustedContentSender(sender);
      return registerPanelToken(sender.tab.id, message.panelToken);

    case MESSAGES.REMEMBER_PERSON:
      await assertTrustedPanelSender(sender, message.panelToken);
      return rememberPerson(message.email);

    case MESSAGES.GENERATE:
      await assertTrustedPanelSender(sender, message.panelToken);
      return handleGenerateRequest(message.payload, sender.tab.id);

    default:
      return { ok: false, error: "The request type is not supported." };
  }
}

function assertTrustedExtensionPage(sender, allowedPages) {
  if (sender?.id !== chrome.runtime.id || typeof sender.url !== "string") {
    throw new Error("Untrusted request source.");
  }

  const url = new URL(sender.url);

  if (url.protocol !== "chrome-extension:") {
    throw new Error("Untrusted request source.");
  }

  const pageName = url.pathname.split("/").filter(Boolean)[0];

  if (!allowedPages.includes(pageName)) {
    throw new Error("Untrusted request source.");
  }
}

function isPopupSender(sender) {
  try {
    assertTrustedExtensionPage(sender, ["popup"]);
    return true;
  } catch {
    return false;
  }
}

function assertTrustedContentSender(sender) {
  if (
    sender?.id !== chrome.runtime.id ||
    !Number.isInteger(sender.tab?.id) ||
    typeof sender.url !== "string"
  ) {
    throw new Error("Untrusted request source.");
  }

  const url = new URL(sender.url);

  if (url.origin !== GMAIL_ORIGIN) {
    throw new Error("Untrusted request source.");
  }
}

async function assertTrustedPanelSender(sender, panelToken) {
  assertTrustedExtensionPage(sender, ["panel"]);

  if (!Number.isInteger(sender.tab?.id) || typeof sender.tab?.url !== "string") {
    throw new Error("Panel is not attached to a Gmail tab.");
  }

  const tabUrl = new URL(sender.tab.url);

  if (tabUrl.origin !== GMAIL_ORIGIN) {
    throw new Error("Panel is not attached to Gmail.");
  }

  if (!(await isRegisteredPanelToken(sender.tab.id, panelToken))) {
    throw new Error("Panel session is not authorized.");
  }
}

// Panel tokens are short-lived capabilities bound to one Gmail tab.
async function registerPanelToken(tabId, panelToken) {
  if (!isValidPanelToken(panelToken)) {
    throw new Error("Panel session token is invalid.");
  }

  const now = Date.now();
  const stored = await chrome.storage.session.get(PANEL_TOKENS_KEY);
  const records = normalizePanelTokenRecords(stored[PANEL_TOKENS_KEY], now);
  const tabRecords = records.filter((record) => record.tabId === tabId);

  if (tabRecords.length >= MAX_PANEL_TOKENS_PER_TAB) {
    const oldest = tabRecords.sort((a, b) => a.createdAt - b.createdAt)[0];
    const index = records.findIndex((record) => {
      return record.tabId === oldest.tabId && record.token === oldest.token;
    });

    if (index >= 0) {
      records.splice(index, 1);
    }
  }

  records.push({ tabId, token: panelToken, createdAt: now });

  await chrome.storage.session.set({
    [PANEL_TOKENS_KEY]: records
  });

  return { ok: true };
}

async function isRegisteredPanelToken(tabId, panelToken) {
  if (!isValidPanelToken(panelToken)) {
    return false;
  }

  const now = Date.now();
  const stored = await chrome.storage.session.get(PANEL_TOKENS_KEY);
  const records = normalizePanelTokenRecords(stored[PANEL_TOKENS_KEY], now);

  return records.some((record) => {
    return record.tabId === tabId && record.token === panelToken;
  });
}

function normalizePanelTokenRecords(value, now) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((record) => {
    return (
      record &&
      Number.isInteger(record.tabId) &&
      isValidPanelToken(record.token) &&
      Number.isFinite(record.createdAt) &&
      now - record.createdAt < PANEL_TOKEN_TTL_MS
    );
  });
}

function isValidPanelToken(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

// Settings and recent-person history are owned by trusted extension contexts.
async function getPublicState(includeRecentPeople) {
  const [settings, hasGmailPermission] = await Promise.all([
    getStoredSettings(),
    hasGmailHostPermission()
  ]);

  const state = {
    ok: true,
    settings: {
      ...settings,
      enabled: settings.enabled && hasGmailPermission
    },
    hasGmailPermission
  };

  if (includeRecentPeople) {
    state.recentPeople = settings.rememberRecentPeople
      ? await getRecentPeople()
      : [];
  }

  return state;
}

async function saveSettings(candidate) {
  const current = await getStoredSettings();
  const next = validateSettingsUpdate(candidate, current.enabled);

  await chrome.storage.local.set({
    [SETTINGS_KEY]: next
  });

  if (!next.rememberRecentPeople) {
    await chrome.storage.local.remove(RECENT_PEOPLE_KEY);
  }

  return { ok: true, settings: next };
}

// Gmail access is optional and exists only while Meetza is enabled.
async function setEnabled(enabled) {
  if (enabled) {
    if (!(await hasGmailHostPermission())) {
      return {
        ok: false,
        code: "GMAIL_PERMISSION_REQUIRED",
        error: "Gmail access must be granted before Meetza can be enabled."
      };
    }

    const current = await getStoredSettings();
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { ...current, enabled: true }
    });

    await ensureGmailContentScriptRegistered();
    await injectIntoOpenGmailTabs();

    return { ok: true, enabled: true };
  }

  const current = await getStoredSettings();
  await chrome.storage.local.set({
    [SETTINGS_KEY]: { ...current, enabled: false }
  });

  abortAllRequests();
  await removeMeetzaFromOpenGmailTabs();
  await unregisterGmailContentScript();
  await chrome.storage.session.remove(PANEL_TOKENS_KEY);
  await chrome.permissions.remove({ origins: [GMAIL_MATCH] });

  return { ok: true, enabled: false };
}

async function disableMeetzaAfterPermissionRemoval() {
  const current = await getStoredSettings();

  if (current.enabled) {
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { ...current, enabled: false }
    });
  }

  await unregisterGmailContentScript();
}

async function synchronizeGmailRegistration() {
  const [settings, hasPermission] = await Promise.all([
    getStoredSettings(),
    hasGmailHostPermission()
  ]);

  if (settings.enabled && hasPermission) {
    await ensureGmailContentScriptRegistered();
    return;
  }

  if (settings.enabled && !hasPermission) {
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { ...settings, enabled: false }
    });
  }

  await unregisterGmailContentScript();
}

async function hasGmailHostPermission() {
  return chrome.permissions.contains({ origins: [GMAIL_MATCH] });
}

async function ensureGmailContentScriptRegistered() {
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [DYNAMIC_CONTENT_SCRIPT_ID]
  });

  if (registered.length > 0) {
    return;
  }

  await chrome.scripting.registerContentScripts([
    {
      id: DYNAMIC_CONTENT_SCRIPT_ID,
      matches: [GMAIL_MATCH],
      js: ["content/content.js"],
      runAt: "document_idle",
      world: "ISOLATED",
      persistAcrossSessions: true
    }
  ]);
}

async function unregisterGmailContentScript() {
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [DYNAMIC_CONTENT_SCRIPT_ID]
  });

  if (registered.length === 0) {
    return;
  }

  try {
    await chrome.scripting.unregisterContentScripts({
      ids: [DYNAMIC_CONTENT_SCRIPT_ID]
    });
  } catch (error) {
    // A stale dynamic-script record should not prevent startup or disable flows.
    console.warn("[Meetza] Dynamic Gmail script cleanup skipped.", error);
  }
}

async function injectIntoOpenGmailTabs() {
  const tabs = await chrome.tabs.query({ url: GMAIL_MATCH });

  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => {
        return chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content/content.js"]
        });
      })
  );
}

async function removeMeetzaFromOpenGmailTabs() {
  if (!(await hasGmailHostPermission())) {
    return;
  }

  const tabs = await chrome.tabs.query({ url: GMAIL_MATCH });

  await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .flatMap((tab) => {
        return [
          chrome.tabs.sendMessage(tab.id, {
            type: MESSAGES.REMOVE_GMAIL_UI
          }),
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.dispatchEvent(new Event("meetza:disable"))
          })
        ];
      })
  );
}

// Rate limits protect both the user and the shared Calendar API quota.
async function handleGenerateRequest(payload, tabId) {
  const request = validateGeneratePayload(payload);
  const operation = beginRateLimitedRequest(tabId, request.dates.length);

  try {
    return await generateAvailability(request, operation.signal);
  } finally {
    operation.finish();
  }
}

function beginRateLimitedRequest(tabId, queryCost) {
  const now = Date.now();
  const current = requestStateByTab.get(tabId) || {
    active: false,
    controller: null,
    requests: []
  };

  current.requests = current.requests.filter(
    (request) => now - request.timestamp < 60_000
  );

  if (current.active) {
    throw new Error("An availability request is already running.");
  }

  const lastRequest = current.requests.at(-1);

  if (lastRequest && now - lastRequest.timestamp < MIN_REQUEST_INTERVAL_MS) {
    throw new Error("Please wait a moment before generating again.");
  }

  if (current.requests.length >= MAX_REQUESTS_PER_MINUTE) {
    throw new Error("Too many availability requests. Try again in a minute.");
  }

  const recentQueryCost = current.requests.reduce(
    (total, request) => total + request.queryCost,
    0
  );

  if (recentQueryCost + queryCost > MAX_FREEBUSY_WINDOWS_PER_MINUTE) {
    throw new Error("Too many calendar windows were requested. Try again in a minute.");
  }

  const controller = new AbortController();
  current.active = true;
  current.controller = controller;
  current.requests.push({ timestamp: now, queryCost });
  requestStateByTab.set(tabId, current);

  return {
    signal: controller.signal,
    finish() {
      const latest = requestStateByTab.get(tabId);

      if (!latest || latest.controller !== controller) {
        return;
      }

      latest.active = false;
      latest.controller = null;
    }
  };
}

function abortRequestForTab(tabId) {
  const state = requestStateByTab.get(tabId);

  if (state?.controller) {
    state.controller.abort();
  }
}

function abortAllRequests() {
  for (const tabId of requestStateByTab.keys()) {
    abortRequestForTab(tabId);
  }
}

// Each selected date is queried only for its configured workday window.
async function generateAvailability(request, signal) {
  const settings = await getStoredSettings();
  const days = [];
  let token = await getAuthToken();

  for (const date of request.dates) {
    const day = makeDayWindow(date, settings);

    if (signal.aborted) {
      throw new Error("Availability request was cancelled.");
    }

    const result = await queryFreeBusy({
      token,
      calendars: request.calendars,
      windowStart: day.start,
      windowEnd: day.end,
      timezone: getSystemTimezone(),
      signal
    });

    token = result.token;

    const unavailableCalendars = findUnavailableCalendars(
      result.data,
      request.calendars
    );

    if (unavailableCalendars.length > 0) {
      return {
        ok: false,
        code: "CALENDAR_UNAVAILABLE",
        error: "Availability could not be read for every selected calendar.",
        calendars: unavailableCalendars
      };
    }

    const busyRanges = collectValidatedBusyRanges(
      result.data,
      request.calendars
    );

    days.push({
      date: day.date,
      slots: findFreeRanges({
        busyRanges,
        windowStart: day.start,
        windowEnd: day.end,
        minimumMinutes: request.duration,
        breakMinutes: settings.breakMinutes
      }).map((range) => ({
        start: new Date(range.start).toISOString(),
        end: new Date(range.end).toISOString()
      }))
    });
  }

  return {
    ok: true,
    duration: request.duration,
    outputTimezone: request.outputTimezone,
    days: days.sort((a, b) => a.date.localeCompare(b.date))
  };
}

function makeDayWindow(date, settings) {
  const [startHour, startMinute] = settings.workdayStart.split(":").map(Number);
  const [endHour, endMinute] = settings.workdayEnd.split(":").map(Number);
  const timezone = getSystemTimezone();

  return {
    date,
    start: zonedDateTimeToDate(date, startHour, startMinute, timezone),
    end: zonedDateTimeToDate(date, endHour, endMinute, timezone)
  };
}

// OAuth tokens remain in the service worker and are never returned to the UI.
function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!token) {
        reject(new Error("Google authorization did not return an access token."));
        return;
      }

      resolve(token);
    });
  });
}

function removeCachedAuthToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

// Google responses are validated before any busy range is used.
async function queryFreeBusy(args) {
  let token = args.token;
  let response = await fetchFreeBusy(args);

  if (response.status === 401) {
    await removeCachedAuthToken(token);
    token = await getAuthToken();
    response = await fetchFreeBusy({ ...args, token });
  }

  if (!response.ok) {
    console.error(
      `[Meetza] Google FreeBusy request failed with status ${response.status}.`
    );
    throw new Error(calendarApiErrorMessage(response.status));
  }

  const data = await response.json();
  validateFreeBusyResponse(data);

  return { token, data };
}

async function fetchFreeBusy({
  token,
  calendars,
  windowStart,
  windowEnd,
  timezone,
  signal
}) {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromOperation = () => controller.abort();
  signal.addEventListener("abort", abortFromOperation, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(FREE_BUSY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
        timeZone: timezone,
        items: calendars.map((id) => ({ id }))
      }),
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        timedOut
          ? "Google Calendar did not respond in time. Try again."
          : "Availability request was cancelled."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abortFromOperation);
  }
}

function validateFreeBusyResponse(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Google Calendar returned an invalid response.");
  }

  if (!data.calendars || typeof data.calendars !== "object") {
    throw new Error("Google Calendar returned an invalid response.");
  }
}

function findUnavailableCalendars(data, calendars) {
  return calendars.filter((id) => {
    const calendar = data.calendars[id];

    return (
      !calendar ||
      typeof calendar !== "object" ||
      (Array.isArray(calendar.errors) && calendar.errors.length > 0)
    );
  });
}

function collectValidatedBusyRanges(data, calendars) {
  const ranges = [];

  for (const id of calendars) {
    const busy = data.calendars[id]?.busy;

    if (!Array.isArray(busy)) {
      throw new Error("Google Calendar returned an invalid response.");
    }

    if (busy.length > MAX_BUSY_RANGES_PER_CALENDAR) {
      throw new Error("Google Calendar returned too many busy ranges.");
    }

    for (const range of busy) {
      const parsed = parseBusyRange(range);
      ranges.push(parsed);
    }
  }

  return ranges;
}

function parseBusyRange(range) {
  if (!range || typeof range !== "object" || Array.isArray(range)) {
    throw new Error("Google Calendar returned an invalid busy range.");
  }

  if (
    typeof range.start !== "string" ||
    typeof range.end !== "string" ||
    range.start.length > 64 ||
    range.end.length > 64
  ) {
    throw new Error("Google Calendar returned an invalid busy range.");
  }

  const start = Date.parse(range.start);
  const end = Date.parse(range.end);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error("Google Calendar returned an invalid busy range.");
  }

  return { start, end };
}

// The UI is untrusted at this boundary; allow only explicit fields and ranges.
function validateGeneratePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("The availability request is invalid.");
  }

  const allowedKeys = new Set([
    "dates",
    "calendars",
    "duration",
    "outputTimezone"
  ]);

  for (const key of Object.keys(payload)) {
    if (!allowedKeys.has(key)) {
      throw new Error("The availability request contains an unsupported field.");
    }
  }

  return {
    dates: validateDates(payload.dates),
    calendars: validateCalendars(payload.calendars),
    duration: validateInteger(payload.duration, "Meeting length", 1, 1440),
    outputTimezone: validateOutputTimezone(payload.outputTimezone)
  };
}

function dateStringToUtcDay(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function validateDates(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Choose at least one valid date.");
  }

  if (value.length > MAX_SELECTED_DATES) {
    throw new Error(`Choose no more than ${MAX_SELECTED_DATES} dates.`);
  }

  if (new Set(value).size !== value.length) {
    throw new Error("Each date can only be selected once.");
  }

  const dates = value.filter(isValidDateString).sort();

  if (dates.length !== value.length) {
    throw new Error("Choose only valid dates.");
  }

  const spanDays = Math.round(
    (dateStringToUtcDay(dates.at(-1)) - dateStringToUtcDay(dates[0])) /
      86_400_000
  );

  if (spanDays > MAX_DATE_SPAN_DAYS) {
    throw new Error(`Selected dates must fit within ${MAX_DATE_SPAN_DAYS} days.`);
  }

  return dates;
}

function validateCalendars(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Add at least one person or calendar.");
  }

  if (value.length > MAX_CALENDARS) {
    throw new Error(`Meetza supports up to ${MAX_CALENDARS} calendars at once.`);
  }

  const calendars = value.map(normalizeCalendarId);

  if (calendars.some((id) => !id)) {
    throw new Error("One or more calendar identifiers are invalid.");
  }

  return [...new Set(calendars)];
}

function normalizeCalendarId(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase();

  if (
    !normalized ||
    normalized.length > MAX_CALENDAR_ID_LENGTH ||
    /[\u0000-\u001f\u007f\s]/.test(normalized)
  ) {
    return "";
  }

  return normalized;
}

function validateOutputTimezone(value) {
  if (!isSupportedOutputTimezone(value)) {
    throw new Error("Choose a supported output timezone.");
  }

  return value;
}

function validateSettingsUpdate(candidate, enabled) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("The settings request is invalid.");
  }

  const allowedKeys = new Set([
    "duration",
    "breakMinutes",
    "workdayStart",
    "workdayEnd",
    "outputTimezone",
    "rememberRecentPeople"
  ]);

  for (const key of Object.keys(candidate)) {
    if (!allowedKeys.has(key)) {
      throw new Error("The settings request contains an unsupported field.");
    }
  }

  const workdayStart = validateTime(candidate.workdayStart, "start time");
  const workdayEnd = validateTime(candidate.workdayEnd, "end time");

  if (timeToMinutes(workdayEnd) <= timeToMinutes(workdayStart)) {
    throw new Error("End time must be later than start time.");
  }

  return {
    enabled,
    duration: validateInteger(candidate.duration, "Meeting length", 1, 1440),
    breakMinutes: validateInteger(
      candidate.breakMinutes,
      "Break",
      0,
      MAX_BREAK_MINUTES
    ),
    workdayStart,
    workdayEnd,
    outputTimezone: validateOutputTimezone(candidate.outputTimezone),
    rememberRecentPeople: Boolean(candidate.rememberRecentPeople)
  };
}

function validateInteger(value, label, minimum, maximum) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(
      `${label} must be a whole number between ${minimum} and ${maximum}.`
    );
  }

  return number;
}

function validateTime(value, label) {
  if (!isValidTime(value)) {
    throw new Error(`Choose a valid ${label}.`);
  }

  return value;
}

function isValidDateString(value) {
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

// Persistent data is intentionally limited to settings and optional recent people.
async function getStoredSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

async function getRecentPeople() {
  const stored = await chrome.storage.local.get(RECENT_PEOPLE_KEY);
  return normalizeRecentPeople(stored[RECENT_PEOPLE_KEY]);
}

async function rememberPerson(value) {
  const settings = await getStoredSettings();

  if (!settings.rememberRecentPeople) {
    return { ok: true };
  }

  const email = normalizeEmail(value);

  if (!email) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const recentPeople = await getRecentPeople();
  const next = [email, ...recentPeople.filter((item) => item !== email)].slice(
    0,
    MAX_RECENT_PEOPLE
  );

  await chrome.storage.local.set({
    [RECENT_PEOPLE_KEY]: next
  });

  return { ok: true, recentPeople: next };
}

function normalizeRecentPeople(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeEmail)
    .filter(Boolean)
    .filter((email, index, all) => all.indexOf(email) === index)
    .slice(0, MAX_RECENT_PEOPLE);
}

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return "";
  }

  const email = value.trim().toLowerCase();

  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return "";
  }

  return email;
}

function calendarApiErrorMessage(status) {
  if (status === 401) {
    return "Google authorization expired. Try Generate again.";
  }

  if (status === 403) {
    return (
      "Google Calendar denied the availability request. " +
      "Check Meetza authorization and Calendar API setup."
    );
  }

  if (status === 429) {
    return "Google Calendar is busy. Try again shortly.";
  }

  return `Google Calendar request failed (${status}).`;
}

function logOperationalFailure(error) {
  console.error("[Meetza] Extension initialization failed.", error);
}
