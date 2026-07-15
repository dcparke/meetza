"use strict";

const {
  GMAIL_MATCH,
  MAX_BREAK_MINUTES,
  MESSAGES,
  TIMEZONE_OPTIONS,
  DEFAULT_SETTINGS,
  getTimezoneDisplayName,
  isValidTime,
  timeToMinutes
} = MeetzaConfig;

const fields = {
  enabled: document.querySelector('[data-setting="enabled"]'),
  duration: document.querySelector('[data-setting="duration"]'),
  breakMinutes: document.querySelector('[data-setting="breakMinutes"]'),
  workdayStart: document.querySelector('[data-setting="workdayStart"]'),
  workdayEnd: document.querySelector('[data-setting="workdayEnd"]'),
  outputTimezone: document.querySelector('[data-setting="outputTimezone"]'),
  rememberRecentPeople: document.querySelector(
    '[data-setting="rememberRecentPeople"]'
  )
};

const feedback = document.querySelector("[data-feedback]");

initialize();

async function initialize() {
  populateTimezoneOptions();
  installEventHandlers();
  await refreshState();
}

function installEventHandlers() {
  fields.enabled.addEventListener("change", handleEnabledChange);
  document.querySelector("[data-save]").addEventListener("click", saveSettings);
  document.querySelector("[data-reset]").addEventListener("click", resetDefaults);
  document.querySelector("[data-clear-people]").addEventListener(
    "click",
    clearRecentPeople
  );
}

async function refreshState() {
  const state = await sendMessage({ type: MESSAGES.GET_STATE });

  if (!state?.ok) {
    showFeedback(state?.error || "Meetza settings could not be loaded.", "error");
    return;
  }

  writeForm(state.settings);
}

function populateTimezoneOptions() {
  fields.outputTimezone.replaceChildren();

  for (const option of TIMEZONE_OPTIONS) {
    const element = document.createElement("option");
    element.value = option.zone;
    element.textContent = getTimezoneDisplayName(option.zone);
    fields.outputTimezone.appendChild(element);
  }
}

function writeForm(values) {
  fields.enabled.checked = values.enabled;
  fields.duration.value = String(values.duration);
  fields.breakMinutes.value = String(values.breakMinutes);
  fields.workdayStart.value = values.workdayStart;
  fields.workdayEnd.value = values.workdayEnd;
  fields.outputTimezone.value = values.outputTimezone;
  fields.rememberRecentPeople.checked = values.rememberRecentPeople;
}

async function handleEnabledChange() {
  clearFeedback();
  fields.enabled.disabled = true;

  try {
    if (fields.enabled.checked) {
      const granted = await chrome.permissions.request({
        origins: [GMAIL_MATCH]
      });

      if (!granted) {
        fields.enabled.checked = false;
        showFeedback("Gmail access was not granted.", "error");
        return;
      }
    }

    const response = await sendMessage({
      type: MESSAGES.SET_ENABLED,
      enabled: fields.enabled.checked
    });

    if (!response?.ok) {
      fields.enabled.checked = !fields.enabled.checked;
      showFeedback(response?.error || "Meetza could not update Gmail access.", "error");
    }
  } catch (error) {
    fields.enabled.checked = !fields.enabled.checked;
    showFeedback(errorMessage(error), "error");
  } finally {
    fields.enabled.disabled = false;
  }
}

async function saveSettings() {
  clearFeedback();

  try {
    const response = await sendMessage({
      type: MESSAGES.SAVE_SETTINGS,
      settings: readForm()
    });

    if (!response?.ok) {
      showFeedback(response?.error || "Settings could not be saved.", "error");
      return;
    }

    showFeedback("Settings saved. Meetza updates automatically.", "success");
    setTimeout(() => window.close(), 200);
  } catch (error) {
    showFeedback(errorMessage(error), "error");
  }
}

function readForm() {
  const duration = parseWholeMinutes(
    fields.duration.value,
    "Meeting length",
    1,
    1440
  );

  const breakMinutes = parseWholeMinutes(
    fields.breakMinutes.value,
    "Break",
    0,
    MAX_BREAK_MINUTES
  );

  const workdayStart = normalizeTime(fields.workdayStart.value, "start time");
  const workdayEnd = normalizeTime(fields.workdayEnd.value, "end time");

  if (timeToMinutes(workdayEnd) <= timeToMinutes(workdayStart)) {
    throw new Error("End time must be later than start time.");
  }

  return {
    duration,
    breakMinutes,
    workdayStart,
    workdayEnd,
    outputTimezone: fields.outputTimezone.value,
    rememberRecentPeople: fields.rememberRecentPeople.checked
  };
}

function resetDefaults() {
  const enabled = fields.enabled.checked;
  writeForm({ ...DEFAULT_SETTINGS, enabled });
  showFeedback("Defaults loaded. Select Save to apply them.", "success");
}

async function clearRecentPeople() {
  const response = await sendMessage({
    type: MESSAGES.CLEAR_RECENT_PEOPLE
  });

  if (response?.ok) {
    showFeedback("Recent people cleared.", "success");
  } else {
    showFeedback(response?.error || "Recent people could not be cleared.", "error");
  }
}

function parseWholeMinutes(value, label, minimum, maximum) {
  const text = value.trim();

  if (!/^\d+$/.test(text)) {
    throw new Error(`${label} must be entered in whole minutes.`);
  }

  const number = Number(text);

  if (number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum} minutes.`);
  }

  return number;
}

function normalizeTime(value, label) {
  const text = value.trim();
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text);

  if (!match) {
    throw new Error(`Enter a valid ${label}, such as 09:00.`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23) {
    throw new Error(`Enter a valid ${label}, such as 09:00.`);
  }

  const normalized = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  if (!isValidTime(normalized)) {
    throw new Error(`Enter a valid ${label}, such as 09:00.`);
  }

  return normalized;
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function showFeedback(message, type) {
  feedback.textContent = message;
  feedback.dataset.type = type;
  feedback.hidden = false;
}

function clearFeedback() {
  feedback.textContent = "";
  feedback.hidden = true;
  delete feedback.dataset.type;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
