(() => {
  "use strict";

  const {
    storageGet,
    storageSet,
    storageRemove,
    permissionContains,
    permissionRequest,
    permissionRemove,
    sendMessage
  } = MeetzaPlatform;
  const {
    SETTINGS_KEY,
    PEOPLE_KEY,
    GMAIL_MATCH,
    MESSAGES,
    LIMITS,
    TIMEZONES,
    DEFAULTS,
    timezoneName,
    normalizeSettings,
    isTime,
    timeToMinutes
  } = Meetza;

  const fields = Object.fromEntries(
    [...document.querySelectorAll("[data-field]")].map((field) => [field.dataset.field, field])
  );
  const feedback = document.querySelector("[data-feedback]");

  initialize().catch(showError);

  async function initialize() {
    populateTimezones();
    const stored = await storageGet(SETTINGS_KEY);
    const settings = normalizeSettings(stored[SETTINGS_KEY]);
    const hasGmail = await permissionContains({ origins: [GMAIL_MATCH] });
    write({ ...settings, enabled: settings.enabled && hasGmail });

    document.querySelector("[data-save]").addEventListener("click", save);
    document.querySelector("[data-reset]").addEventListener("click", (event) => {
      if (!event.isTrusted) {
        return;
      }

      // Reset scheduling preferences without silently changing Gmail access.
      write({ ...DEFAULTS, enabled: fields.enabled.checked });
      clearFeedback();
    });
    document.querySelector("[data-clear]").addEventListener("click", async () => {
      await storageRemove(PEOPLE_KEY);
      clearFeedback();
    });
  }

  async function save(event) {
    if (!event.isTrusted) {
      return;
    }

    clearFeedback();

    try {
      const next = read();
      let hadPermission = false;

      if (next.enabled) {
        // Keep the permission request as the first asynchronous call so the
        // browser can tie it to the user's Save click.
        const granted = await permissionRequest({ origins: [GMAIL_MATCH] });
        if (!granted) {
          throw new Error("Gmail permission was not granted.");
        }
        hadPermission = true;
      } else {
        hadPermission = await permissionContains({ origins: [GMAIL_MATCH] });
      }

      await storageSet({ [SETTINGS_KEY]: next });
      if (!next.rememberRecentPeople) {
        await storageRemove(PEOPLE_KEY);
      }

      await sendMessage({ type: MESSAGES.SYNC_GMAIL });

      if (!next.enabled && hadPermission) {
        await permissionRemove({ origins: [GMAIL_MATCH] });
      }

      setTimeout(() => window.close(), 100);
    } catch (error) {
      showError(error);
    }
  }

  function read() {
    const duration = wholeMinutes(fields.duration.value, "Meeting Length", 1, 1440);
    const breakMinutes = wholeMinutes(
      fields.breakMinutes.value,
      "Break",
      0,
      LIMITS.breakMinutes
    );
    const workdayStart = normalizedTime(fields.workdayStart.value, "start time");
    const workdayEnd = normalizedTime(fields.workdayEnd.value, "end time");

    if (timeToMinutes(workdayEnd) <= timeToMinutes(workdayStart)) {
      throw new Error("End time must be later than start time.");
    }

    return {
      enabled: fields.enabled.checked,
      duration,
      breakMinutes,
      workdayStart,
      workdayEnd,
      outputTimezone: fields.outputTimezone.value,
      rememberRecentPeople: fields.rememberRecentPeople.checked
    };
  }

  function write(settings) {
    fields.enabled.checked = settings.enabled;
    fields.duration.value = String(settings.duration);
    fields.breakMinutes.value = String(settings.breakMinutes);
    fields.workdayStart.value = settings.workdayStart;
    fields.workdayEnd.value = settings.workdayEnd;
    fields.outputTimezone.value = settings.outputTimezone;
    fields.rememberRecentPeople.checked = settings.rememberRecentPeople;
  }

  function populateTimezones() {
    for (const item of TIMEZONES) {
      const option = document.createElement("option");
      option.value = item.zone;
      option.textContent = timezoneName(item.zone);
      fields.outputTimezone.appendChild(option);
    }
  }

  function wholeMinutes(value, label, min, max) {
    const text = value.trim();
    if (!/^\d+$/.test(text)) {
      throw new Error(`${label} must be entered in whole minutes.`);
    }
    const number = Number(text);
    if (number < min || number > max) {
      throw new Error(`${label} must be between ${min} and ${max} minutes.`);
    }
    return number;
  }

  function normalizedTime(value, label) {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
    if (!match || Number(match[1]) > 23) {
      throw new Error(`Enter a valid ${label}, such as 09:00.`);
    }
    const result = `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
    if (!isTime(result)) {
      throw new Error(`Enter a valid ${label}, such as 09:00.`);
    }
    return result;
  }

  function showError(error) {
    feedback.textContent = error instanceof Error ? error.message : String(error);
    feedback.dataset.kind = "error";
    feedback.hidden = false;
  }

  function clearFeedback() {
    feedback.textContent = "";
    feedback.hidden = true;
    delete feedback.dataset.kind;
  }
})();
