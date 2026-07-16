(() => {
  "use strict";

  if (globalThis.__meetzaContentLoaded) {
    return;
  }
  globalThis.__meetzaContentLoaded = true;

  const { raw, sendMessage, url } = MeetzaContentApi;
  const {
    MESSAGES,
    TIMEZONES,
    systemTimezone,
    timezoneAbbreviation,
    timezoneName,
    nextBusinessDate,
    today,
    weekday,
    dateLabel
  } = Meetza;

  const ATTACH_SELECTOR = '[command="Files"]';
  const MAX_INSTANCES = 8;
  const COLORS = [
    { text: "#0C4636", background: "#E7F1EE" },
    { text: "#D3B267", background: "#FBF7EC" },
    { text: "#47AE84", background: "#ECF8F3" },
    { text: "#5E8B51", background: "#EFF5EC" },
    { text: "#1B5B46", background: "#E8F2EE" },
    { text: "#7ECC91", background: "#F2FAF4" }
  ];

  const instances = new Set();
  const anchored = new WeakSet();
  let scanQueued = false;

  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  raw.runtime.onMessage.addListener(onRuntimeMessage);
  document.addEventListener("keydown", onKeydown, true);
  scan();

  function queueScan() {
    if (scanQueued) {
      return;
    }

    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
    });
  }

  function scan() {
    cleanup();

    if (instances.size >= MAX_INSTANCES) {
      return;
    }

    for (const attach of document.querySelectorAll(ATTACH_SELECTOR)) {
      if (instances.size >= MAX_INSTANCES) {
        break;
      }
      if (anchored.has(attach) || !attach.parentElement) {
        continue;
      }

      anchored.add(attach);
      instances.add(createInstance(attach));
    }
  }

  function cleanup() {
    for (const instance of instances) {
      if (
        !instance.attach.isConnected ||
        !instance.launcherHost.isConnected ||
        !instance.panelHost.isConnected
      ) {
        instance.destroy();
        instances.delete(instance);
      }
    }
  }

  function createInstance(attach) {
    // Keep the launcher beside Gmail's toolbar, but portal the panel to the
    // document body. Gmail's compose toolbar uses clipping and stacking
    // contexts that can cover a panel nested inside it, regardless of z-index.
    const launcherHost = document.createElement("span");
    launcherHost.className = "meetza-launcher-host";
    const launcherShadow = launcherHost.attachShadow({ mode: "closed" });
    const panelHost = document.createElement("div");
    panelHost.className = "meetza-panel-host";
    const panelShadow = panelHost.attachShadow({ mode: "closed" });
    const launcher = make("button", { className: "launcher", type: "button", title: "Open Meetza" });
    const launcherIcon = make("img", { src: url("icons/icon32.png"), alt: "" });
    const panel = buildPanel();
    const state = {
      settings: null,
      recentPeople: [],
      calendars: new Set(["primary"]),
      dates: [today(systemTimezone())],
      timer: null
    };

    launcher.setAttribute("aria-label", "Open Meetza");
    launcher.appendChild(launcherIcon);

    launcherShadow.append(stylesheet(), launcher);
    panelShadow.append(stylesheet(), panel.root);
    attach.insertAdjacentElement("beforebegin", launcherHost);
    document.body.appendChild(panelHost);

    launcher.addEventListener("click", trusted(async () => {
      if (panel.root.hidden) {
        await open();
      } else {
        close();
      }
    }));

    panel.close.addEventListener("click", trusted(close));
    panel.addDate.addEventListener("click", trusted(() => {
      state.dates.push(nextBusinessDate(state.dates));
      renderDates();
    }));
    panel.addPerson.addEventListener("click", trusted(addPerson));

    // Gmail listens for several keyboard and text-input events in compose.
    // Stop those events at the Meetza panel boundary without cancelling their
    // default behavior, so typing, paste, and IME input still work normally.
    for (const eventName of [
      "keydown",
      "keypress",
      "keyup",
      "beforeinput",
      "input",
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "paste"
    ]) {
      panel.root.addEventListener(eventName, (event) => {
        if (event.isTrusted) {
          event.stopPropagation();
        }
      });
    }

    panel.personInput.addEventListener("keydown", (event) => {
      if (!event.isTrusted || event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      addPerson();
    });
    panel.personInput.addEventListener("focus", renderSuggestions);
    panel.personInput.addEventListener("input", renderSuggestions);
    panel.personInput.addEventListener("blur", () => {
      setTimeout(() => { panel.suggestions.hidden = true; }, 100);
    });
    panel.generate.addEventListener("click", trusted(generate));

    renderDates();
    renderPeople();
    populateTimezones();

    return { attach, launcherHost, panelHost, close, destroy };

    async function open() {
      clearFeedback();
      try {
        const result = await sendMessage({ type: MESSAGES.STATE });
        if (!result?.ok) {
          throw new Error(result?.error || "Meetza could not load settings.");
        }

        state.settings = result.settings;
        state.recentPeople = result.recentPeople || [];
        panel.duration.value = String(state.settings.duration);
        panel.timezone.value = state.settings.outputTimezone;
        panel.root.hidden = false;
        position();
        startTracking();
      } catch (error) {
        panel.root.hidden = false;
        showFeedback(message(error));
        position();
      }
    }

    function close() {
      panel.root.hidden = true;
      panel.suggestions.hidden = true;
      stopTracking();
    }

    function destroy() {
      stopTracking();
      launcherHost.remove();
      panelHost.remove();
    }

    function startTracking() {
      stopTracking();
      state.timer = setInterval(position, 120);
    }

    function stopTracking() {
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
    }

    function position() {
      if (panel.root.hidden || !launcher.isConnected) {
        return;
      }

      const margin = 8;
      const gap = 8;
      const anchor = launcher.getBoundingClientRect();
      const width = panel.root.offsetWidth;
      const height = Math.min(panel.root.scrollHeight, innerHeight - margin * 2);
      const above = anchor.top - margin;
      const below = innerHeight - anchor.bottom - margin;
      let top = above > below ? anchor.top - height - gap : anchor.bottom + gap;
      let left = anchor.left;

      top = clamp(top, margin, innerHeight - height - margin);
      left = clamp(left, margin, innerWidth - width - margin);
      panel.root.style.top = `${top}px`;
      panel.root.style.left = `${left}px`;
    }

    function renderDates() {
      panel.dates.replaceChildren();

      state.dates.forEach((date, index) => {
        const row = make("div", { className: "date-row" });
        const day = make("span", { className: "weekday", textContent: weekday(date) });
        const input = make("input", { className: "input", type: "date", value: date });
        const remove = make("button", { className: "icon-button", type: "button", textContent: "×" });

        remove.title = "Remove date";
        remove.setAttribute("aria-label", "Remove date");

        input.addEventListener("change", (event) => {
          if (!event.isTrusted || !input.value) {
            return;
          }
          if (state.dates.some((item, itemIndex) => itemIndex !== index && item === input.value)) {
            input.value = state.dates[index];
            showFeedback("That date is already selected.");
            return;
          }
          state.dates[index] = input.value;
          clearFeedback();
          renderDates();
        });

        remove.addEventListener("click", trusted(() => {
          state.dates.splice(index, 1);
          renderDates();
        }));

        row.append(day, input, remove);
        panel.dates.appendChild(row);
      });
    }

    function addPerson() {
      const email = normalizeEmail(panel.personInput.value);
      if (!email) {
        showFeedback("Enter a valid email address.");
        return;
      }

      state.calendars.add(email);
      panel.personInput.value = "";
      clearFeedback();
      renderPeople();
      panel.suggestions.hidden = true;

      if (state.settings?.rememberRecentPeople) {
        sendMessage({ type: MESSAGES.REMEMBER_PERSON, email }).then((result) => {
          if (result?.ok) {
            state.recentPeople = result.recentPeople || [];
          }
        }).catch(() => {});
      }
    }

    function renderPeople() {
      panel.people.replaceChildren();

      [...state.calendars].forEach((calendar, index) => {
        const color = COLORS[index % COLORS.length];
        const pill = make("span", { className: "pill" });
        const label = make("span", {
          className: "pill-label",
          textContent: calendar === "primary" ? "Me" : calendar
        });
        const remove = make("button", { className: "pill-remove", type: "button", textContent: "×" });

        pill.style.background = color.background;
        pill.style.color = color.text;
        remove.setAttribute("aria-label", `Remove ${label.textContent}`);
        remove.addEventListener("click", trusted(() => {
          state.calendars.delete(calendar);
          renderPeople();
        }));
        pill.append(label, remove);
        panel.people.appendChild(pill);
      });
    }

    function renderSuggestions() {
      if (!state.settings?.rememberRecentPeople) {
        panel.suggestions.hidden = true;
        return;
      }

      const query = panel.personInput.value.trim().toLowerCase();
      const matches = state.recentPeople
        .filter((email) => !state.calendars.has(email) && email.includes(query))
        .slice(0, 6);

      panel.suggestions.replaceChildren();
      for (const email of matches) {
        const option = make("button", { className: "suggestion", type: "button", textContent: email });
        option.addEventListener("mousedown", (event) => {
          if (!event.isTrusted) {
            return;
          }
          event.preventDefault();
          panel.personInput.value = email;
          addPerson();
        });
        panel.suggestions.appendChild(option);
      }
      panel.suggestions.hidden = matches.length === 0;
    }

    function populateTimezones() {
      for (const item of TIMEZONES) {
        panel.timezone.appendChild(make("option", {
          value: item.zone,
          textContent: timezoneName(item.zone)
        }));
      }
    }

    async function generate() {
      clearFeedback();
      panel.results.replaceChildren();

      const duration = Number(panel.duration.value.trim());
      if (!state.dates.length) {
        showFeedback("Choose at least one date.");
        return;
      }
      if (!state.calendars.size) {
        showFeedback("Add at least one person or calendar.");
        return;
      }
      if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
        showFeedback("Meeting Length must be between 1 and 1440 minutes.");
        return;
      }

      panel.generate.disabled = true;
      panel.generate.textContent = "Generating…";

      try {
        const result = await sendMessage({
          type: MESSAGES.GENERATE,
          payload: {
            dates: [...state.dates],
            calendars: [...state.calendars],
            duration,
            outputTimezone: panel.timezone.value
          }
        });

        if (!result?.ok) {
          if (result?.code === "CALENDAR_UNAVAILABLE") {
            const names = (result.calendars || [])
              .map((id) => id === "primary" ? "Me" : id)
              .join(", ");
            throw new Error(
              `Calendar availability could not be read for: ${names}. Check sharing permissions.`
            );
          }
          throw new Error(result?.error || "Meetza could not generate availability.");
        }

        renderResults(result);
      } catch (error) {
        showFeedback(message(error));
      } finally {
        panel.generate.disabled = false;
        panel.generate.textContent = "Generate";
      }
    }

    function renderResults(result) {
      const header = make("div", { className: "results-header" });
      const title = make("div", { className: "results-title", textContent: "Available Times" });
      const copy = make("button", {
        className: "copy-button copy-pulse",
        type: "button",
        textContent: "Copy"
      });

      copy.addEventListener("click", trusted(async () => {
        try {
          await navigator.clipboard.writeText(copyText(result));
          close();
        } catch {
          showFeedback("Availability could not be copied.");
        }
      }));
      header.append(title, copy);
      panel.results.appendChild(header);

      for (const item of result.days) {
        const day = make("div", { className: "day" });
        day.appendChild(make("div", { className: "day-title", textContent: dateLabel(item.date) }));

        if (!item.slots.length) {
          day.appendChild(make("div", {
            className: "empty",
            textContent: `No ${result.duration}-minute availability`
          }));
        } else {
          for (const slot of item.slots) {
            day.appendChild(make("div", {
              className: "slot",
              textContent: `- ${formatRange(slot, result.outputTimezone)}`
            }));
          }
        }
        panel.results.appendChild(day);
      }
    }

    function copyText(result) {
      return result.days.map((item) => {
        const lines = item.slots.length
          ? item.slots.map((slot) => `- ${formatRange(slot, result.outputTimezone)}`)
          : [`- No ${result.duration}-minute availability`];
        return [dateLabel(item.date), ...lines].join("\n");
      }).join("\n\n");
    }

    function showFeedback(text) {
      panel.feedback.textContent = text;
      panel.feedback.dataset.kind = "error";
      panel.feedback.hidden = false;
    }

    function clearFeedback() {
      panel.feedback.hidden = true;
      panel.feedback.textContent = "";
      delete panel.feedback.dataset.kind;
    }
  }

  function stylesheet() {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url("content.css");
    return link;
  }

  function buildPanel() {
    const root = make("div", { className: "panel", hidden: true });
    const header = make("div", { className: "header" });
    const brand = make("div", { className: "brand" });
    const brandText = make("div");
    const close = make("button", { className: "icon-button", type: "button", textContent: "×" });
    const body = make("div", { className: "body" });
    const dates = make("div");
    const addDate = make("button", { className: "add-button", type: "button", textContent: "+ Add day" });
    const people = make("div", { className: "people" });
    const personInput = make("input", {
      className: "input",
      type: "email",
      placeholder: "Add email address",
      autocomplete: "email",
      inputMode: "email"
    });
    const addPerson = make("button", { className: "small-button", type: "button", textContent: "+" });
    const suggestions = make("div", { className: "suggestions", hidden: true });
    const duration = make("input", {
      type: "text",
      inputMode: "numeric",
      pattern: "[0-9]*",
      autocomplete: "off"
    });
    const timezone = make("select", { className: "select" });
    const feedback = make("div", { className: "feedback", hidden: true });
    const generate = make("button", { className: "generate", type: "button", textContent: "Generate" });
    const results = make("div", { className: "results" });

    close.title = "Close Meetza";
    close.setAttribute("aria-label", "Close Meetza");
    addPerson.title = "Add person";
    addPerson.setAttribute("aria-label", "Add person");

    brand.append(
      make("img", { src: MeetzaContentApi.url("icons/icon32.png"), alt: "" }),
      brandText
    );
    brandText.append(
      make("div", { className: "title", textContent: "Meetza" }),
      make("div", { className: "tagline", textContent: "Give a slice of your calendar" })
    );
    header.append(brand, close);

    body.append(
      section("Dates", dates, addDate),
      section("People", people, make("div", { className: "inline" }, personInput, addPerson, suggestions)),
      make("div", { className: "section controls" },
        field("Meeting Length", make("div", { className: "number-field" },
          duration,
          make("span", { textContent: "minutes" })
        )),
        field("Time Zone", timezone)
      ),
      feedback,
      generate,
      results
    );
    root.append(header, body);

    return {
      root,
      close,
      dates,
      addDate,
      people,
      personInput,
      addPerson,
      suggestions,
      duration,
      timezone,
      feedback,
      generate,
      results
    };
  }

  function section(label, ...children) {
    return make("section", { className: "section" },
      make("label", { className: "label", textContent: label }),
      ...children
    );
  }

  function field(label, control) {
    return make("label", {},
      make("span", { className: "label", textContent: label }),
      control
    );
  }

  function make(tag, properties = {}, ...children) {
    const element = document.createElement(tag);

    for (const [key, value] of Object.entries(properties)) {
      if (key === "className") {
        element.className = value;
      } else if (key === "textContent") {
        element.textContent = value;
      } else if (key === "hidden") {
        element.hidden = value;
      } else if (key in element) {
        element[key] = value;
      } else {
        element.setAttribute(key, value);
      }
    }

    for (const child of children.flat()) {
      if (child) {
        element.appendChild(child);
      }
    }
    return element;
  }

  function onRuntimeMessage(message) {
    if (message?.type === MESSAGES.SHUTDOWN) {
      shutdown();
    }
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      for (const instance of instances) {
        instance.close();
      }
    }
  }

  function shutdown() {
    observer.disconnect();
    document.removeEventListener("keydown", onKeydown, true);
    raw.runtime.onMessage.removeListener(onRuntimeMessage);
    for (const instance of instances) {
      instance.destroy();
    }
    instances.clear();
    globalThis.__meetzaContentLoaded = false;
  }

  function trusted(handler) {
    return (event) => {
      if (!event.isTrusted) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      return handler(event);
    };
  }

  function formatRange(slot, timezone) {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    return `${formatTime(start, timezone)}–${formatTime(end, timezone)} ${timezoneAbbreviation(timezone, start)}`;
  }

  function formatTime(date, timezone) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(date);
  }

  function normalizeEmail(value) {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
  }

  function clamp(value, min, max) {
    return max < min ? min : Math.min(Math.max(value, min), max);
  }

  function message(error) {
    return error instanceof Error ? error.message : "Meetza could not complete the request.";
  }
})();
