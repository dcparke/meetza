"use strict";

const {
  GMAIL_ORIGIN,
  MESSAGES,
  TIMEZONE_OPTIONS,
  DEFAULT_SETTINGS,
  getSystemTimezone,
  getTimezoneAbbreviation,
  getTimezoneDisplayName
} = MeetzaConfig;

const PEOPLE_COLORS = Object.freeze([
  Object.freeze({ text: "#0C4636", background: "#E7F1EE" }),
  Object.freeze({ text: "#D3B267", background: "#FBF7EC" }),
  Object.freeze({ text: "#47AE84", background: "#ECF8F3" }),
  Object.freeze({ text: "#5E8B51", background: "#EFF5EC" }),
  Object.freeze({ text: "#1B5B46", background: "#E8F2EE" }),
  Object.freeze({ text: "#7ECC91", background: "#F2FAF4" })
]);

const SYSTEM_TIMEZONE = getSystemTimezone();
const calendars = new Set(["primary"]);

let settings = { ...DEFAULT_SETTINGS };
let recentPeople = [];
let panelToken = readPanelToken();

const elements = {
  dates: document.querySelector("[data-dates]"),
  people: document.querySelector("[data-people]"),
  personInput: document.querySelector("[data-person-input]"),
  suggestions: document.querySelector("[data-suggestions]"),
  duration: document.querySelector("[data-duration]"),
  timezone: document.querySelector("[data-timezone]"),
  feedback: document.querySelector("[data-feedback]"),
  generate: document.querySelector("[data-generate]"),
  results: document.querySelector("[data-results]")
};

initialize();

async function initialize() {
  try {
    if (!panelToken) {
      throw new Error("Panel session token is missing.");
    }

    history.replaceState(null, "", location.pathname);

    populateTimezoneOptions();
    installEventHandlers();

    const state = await sendMessage({ type: MESSAGES.GET_STATE });

    if (!state?.ok) {
      throw new Error(state?.error || "Meetza state could not be loaded.");
    }

    applyState(state);
    addDateRow(todayInTimeZone(SYSTEM_TIMEZONE));
    renderPeople();
    schedulePanelResize();
  } catch {
    showFeedback("Meetza could not establish a secure panel session.", "error");
  }
}

function installEventHandlers() {
  document.querySelector("[data-close]").addEventListener("click", closePanel);

  document.querySelector("[data-add-date]").addEventListener("click", () => {
    addDateRow(nextUnusedDate(getSelectedDates()));
  });

  document.querySelector("[data-add-person]").addEventListener("click", () => {
    addPersonFromInput();
  });

  elements.personInput.addEventListener("focus", renderPeopleSuggestions);
  elements.personInput.addEventListener("input", renderPeopleSuggestions);

  elements.personInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    addPersonFromInput();
  });

  elements.personInput.addEventListener("blur", () => {
    setTimeout(() => {
      elements.suggestions.hidden = true;
    }, 100);
  });

  elements.generate.addEventListener("click", generateAvailability);

  chrome.storage.onChanged.addListener(() => {
    refreshState().catch(() => {
      showFeedback("Meetza settings could not be refreshed.", "error");
    });
  });
}

async function refreshState() {
  const state = await sendMessage({ type: MESSAGES.GET_STATE });

  if (!state?.ok) {
    throw new Error(state?.error || "Meetza state could not be loaded.");
  }

  applyState(state);
}

function applyState(state) {
  settings = state.settings;
  recentPeople = state.recentPeople;
  elements.duration.value = String(settings.duration);
  elements.timezone.value = settings.outputTimezone;
}

function populateTimezoneOptions() {
  elements.timezone.replaceChildren();

  for (const option of TIMEZONE_OPTIONS) {
    const item = document.createElement("option");
    item.value = option.zone;
    item.textContent = getTimezoneDisplayName(option.zone);
    elements.timezone.appendChild(item);
  }
}

async function generateAvailability() {
  clearFeedback();
  clearResults();

  let payload;

  try {
    payload = collectGeneratePayload();
  } catch (error) {
    showFeedback(errorMessage(error), "error");
    return;
  }

  setGenerateState(true);

  try {
    const response = await sendMessage({
      type: MESSAGES.GENERATE,
      payload
    });

    if (!response?.ok) {
      showGenerationError(response);
      return;
    }

    renderResults(response);
  } catch (error) {
    showFeedback(errorMessage(error), "error");
  } finally {
    setGenerateState(false);
  }
}

function collectGeneratePayload() {
  const duration = parseWholeMinutes(
    elements.duration.value,
    "Meeting length",
    1,
    1440
  );

  if (calendars.size === 0) {
    throw new Error("Add at least one person or calendar.");
  }

  return {
    dates: collectDates(),
    calendars: [...calendars],
    duration,
    outputTimezone: elements.timezone.value
  };
}

function addDateRow(dateValue) {
  const row = document.createElement("div");
  const weekday = document.createElement("span");
  const input = document.createElement("input");
  const removeButton = document.createElement("button");

  row.className = "date-row";
  weekday.className = "weekday";

  input.type = "date";
  input.className = "text-input";
  input.dataset.date = "true";
  input.value = dateValue;
  input.dataset.previousDate = dateValue;

  removeButton.type = "button";
  removeButton.className = "row-remove";
  removeButton.textContent = "×";
  removeButton.title = "Remove date";
  removeButton.setAttribute("aria-label", "Remove date");

  const updateWeekday = () => {
    weekday.textContent = input.value ? weekdayForDate(input.value) : "";
  };

  input.addEventListener("change", () => {
    if (!input.value) {
      updateWeekday();
      return;
    }

    const duplicates = [...elements.dates.querySelectorAll("[data-date]")]
      .filter((dateInput) => dateInput.value === input.value)
      .length;

    if (duplicates > 1) {
      input.value = input.dataset.previousDate;
      updateWeekday();
      showFeedback("That date is already selected.", "error");
      return;
    }

    input.dataset.previousDate = input.value;
    clearFeedback();
    updateWeekday();
  });

  removeButton.addEventListener("click", () => {
    row.remove();
  });

  updateWeekday();
  row.append(weekday, input, removeButton);
  elements.dates.appendChild(row);
  schedulePanelResize();
}

function getSelectedDates() {
  return [...elements.dates.querySelectorAll("[data-date]")]
    .map((input) => input.value)
    .filter(Boolean);
}

function collectDates() {
  const dates = getSelectedDates();

  if (dates.length === 0) {
    throw new Error("Choose at least one date.");
  }

  if (new Set(dates).size !== dates.length) {
    throw new Error("Each date can only be selected once.");
  }

  return [...dates].sort();
}

function nextUnusedDate(dates) {
  const used = new Set(dates);
  let nextDate = dates.length === 0
    ? todayInTimeZone(SYSTEM_TIMEZONE)
    : addDays([...dates].sort().at(-1), 1);

  /*
   * Meetza defaults the Add day button to business days.
   *
   * FOSS maintainers who want the old behavior can change this loop to only
   * check used.has(nextDate), which will allow Saturdays and Sundays again.
   */
  while (used.has(nextDate) || isWeekend(nextDate)) {
    nextDate = addDays(nextDate, 1);
  }

  return nextDate;
}

function isWeekend(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return dayOfWeek === 0 || dayOfWeek === 6;
}

async function addPersonFromInput() {
  const email = normalizeEmail(elements.personInput.value);

  if (!email) {
    showFeedback("Enter a valid email address.", "error");
    return;
  }

  clearFeedback();
  calendars.add(email);
  elements.personInput.value = "";
  renderPeople();
  elements.suggestions.hidden = true;

  if (settings.rememberRecentPeople) {
    const result = await sendMessage({
      type: MESSAGES.REMEMBER_PERSON,
      email
    });

    if (result?.ok && Array.isArray(result.recentPeople)) {
      recentPeople = result.recentPeople;
    }
  }
}

function renderPeople() {
  elements.people.replaceChildren();

  [...calendars].forEach((calendarId, index) => {
    const color = PEOPLE_COLORS[index % PEOPLE_COLORS.length];
    const pill = document.createElement("span");
    const label = document.createElement("span");
    const removeButton = document.createElement("button");

    pill.className = "pill";
    pill.style.background = color.background;
    pill.style.color = color.text;

    label.className = "pill-label";
    label.textContent = calendarId === "primary" ? "Me" : calendarId;

    removeButton.type = "button";
    removeButton.className = "pill-remove";
    removeButton.textContent = "×";
    removeButton.title = `Remove ${label.textContent}`;
    removeButton.setAttribute("aria-label", `Remove ${label.textContent}`);

    removeButton.addEventListener("click", () => {
      calendars.delete(calendarId);
      renderPeople();
    });

    pill.append(label, removeButton);
    elements.people.appendChild(pill);
  });

  schedulePanelResize();
}

function renderPeopleSuggestions() {
  if (!settings.rememberRecentPeople) {
    elements.suggestions.hidden = true;
    return;
  }

  const query = elements.personInput.value.trim().toLowerCase();
  const matches = recentPeople
    .filter((email) => !calendars.has(email) && email.includes(query))
    .slice(0, 6);

  elements.suggestions.replaceChildren();

  if (matches.length === 0) {
    elements.suggestions.hidden = true;
    return;
  }

  for (const email of matches) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "suggestion";
    option.textContent = email;

    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
      elements.personInput.value = email;
      addPersonFromInput();
    });

    elements.suggestions.appendChild(option);
  }

  elements.suggestions.hidden = false;
}

function renderResults(response) {
  const header = document.createElement("div");
  const title = document.createElement("div");
  const copyButton = document.createElement("button");

  header.className = "results-header";
  title.className = "results-title";
  title.textContent = "Available Times";

  copyButton.type = "button";
  copyButton.className = "copy-button copy-pulse";
  copyButton.textContent = "Copy";
  copyButton.title = "Copy availability";

  header.append(title, copyButton);
  elements.results.appendChild(header);

  setTimeout(() => {
    copyButton.classList.remove("copy-pulse");
  }, 3200);

  for (const day of response.days) {
    const block = document.createElement("div");
    const dateLabel = document.createElement("div");

    block.className = "day";
    dateLabel.className = "day-title";
    dateLabel.textContent = formatDateLabel(day.date);
    block.appendChild(dateLabel);

    if (day.slots.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-slot";
      empty.textContent = `No ${response.duration}-minute availability`;
      block.appendChild(empty);
    } else {
      for (const slot of day.slots) {
        const line = document.createElement("div");
        line.className = "slot";
        line.textContent = `- ${formatRange(slot, response.outputTimezone)}`;
        block.appendChild(line);
      }
    }

    elements.results.appendChild(block);
  }

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(buildCopyText(response));
      closePanel();
    } catch {
      showFeedback("Availability could not be copied to the clipboard.", "error");
    }
  });

  schedulePanelResize();
}

function buildCopyText(response) {
  return response.days
    .map((day) => {
      const lines = day.slots.length > 0
        ? day.slots.map((slot) => {
            return `- ${formatRange(slot, response.outputTimezone)}`;
          })
        : [`- No ${response.duration}-minute availability`];

      return [formatDateLabel(day.date), ...lines].join("\n");
    })
    .join("\n\n");
}

function formatRange(slot, timezone) {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const abbreviation = getTimezoneAbbreviation(timezone, start);

  return `${formatTime(start, timezone)}–${formatTime(end, timezone)} ${abbreviation}`;
}

function showGenerationError(response) {
  if (response?.code === "CALENDAR_UNAVAILABLE") {
    const names = (response.calendars ?? [])
      .map((id) => (id === "primary" ? "Me" : id))
      .join(", ");

    showFeedback(
      names
        ? `Calendar availability could not be read for: ${names}. Remove inaccessible calendars or check sharing permissions.`
        : response.error,
      "error"
    );

    return;
  }

  showFeedback(
    response?.error || "Meetza could not generate availability.",
    "error"
  );
}

function showFeedback(message, type) {
  elements.feedback.textContent = message;
  elements.feedback.dataset.type = type;
  elements.feedback.hidden = false;
  schedulePanelResize();
}

function clearFeedback() {
  elements.feedback.textContent = "";
  elements.feedback.hidden = true;
  delete elements.feedback.dataset.type;
  schedulePanelResize();
}

function clearResults() {
  elements.results.replaceChildren();
  schedulePanelResize();
}

function setGenerateState(isGenerating) {
  elements.generate.disabled = isGenerating;
  elements.generate.textContent = isGenerating ? "Generating…" : "Generate";
}

function schedulePanelResize() {
  requestAnimationFrame(() => {
    const height = Math.ceil(document.documentElement.scrollHeight);

    window.parent.postMessage(
      { type: PANEL_RESIZE_MESSAGE, height },
      GMAIL_ORIGIN
    );
  });
}

function closePanel() {
  window.parent.postMessage({ type: "MEETZA_FRAME_CLOSE" }, GMAIL_ORIGIN);
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ ...message, panelToken }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}

function readPanelToken() {
  const token = location.hash.startsWith("#")
    ? location.hash.slice(1)
    : "";

  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)
    ? token
    : "";
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

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return "";
  }

  const email = value.trim().toLowerCase();

  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : "";
}

function formatTime(date, timezone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function formatDateLabel(dateString) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(new Date(`${dateString}T12:00:00Z`));
}

function weekdayForDate(dateString) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    weekday: "long"
  }).format(new Date(`${dateString}T12:00:00Z`));
}

function todayInTimeZone(timezone) {
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
