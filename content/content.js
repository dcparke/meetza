(() => {
  "use strict";

  if (globalThis.__MEETZA_CONTENT_SCRIPT_LOADED__) {
    return;
  }

  globalThis.__MEETZA_CONTENT_SCRIPT_LOADED__ = true;

  const ATTACH_BUTTON = '[command="Files"]';
  const ROOT_ATTRIBUTE = "data-meetza-root";
  const REMOVE_MESSAGE = "MEETZA_REMOVE_GMAIL_UI";
  const REGISTER_PANEL_MESSAGE = "MEETZA_REGISTER_PANEL";
  const PANEL_CLOSE_MESSAGE = "MEETZA_FRAME_CLOSE";
  const PANEL_RESIZE_MESSAGE = "MEETZA_FRAME_RESIZE";
  const DISABLE_EVENT = "meetza:disable";
  const DETECTION_INTERVAL_MS = 750;
  const TRACKING_INTERVAL_MS = 120;
  const PANEL_WIDTH = 400;
  const DEFAULT_PANEL_HEIGHT = 520;
  const MAX_PANEL_HEIGHT = 650;
  const MIN_PANEL_HEIGHT = 260;
  const VIEWPORT_MARGIN = 8;
  const PANEL_GAP = 8;

  const instances = new Set();
  let detectionTimer = null;
  let stopped = false;

  const runtimeMessageListener = (message, sender) => {
    if (
      sender?.id === chrome.runtime.id &&
      message?.type === REMOVE_MESSAGE
    ) {
      shutdown();
    }
  };

  const disableEventListener = () => shutdown();

  chrome.runtime.onMessage.addListener(runtimeMessageListener);
  document.addEventListener(DISABLE_EVENT, disableEventListener);

  detectComposeToolbars();
  detectionTimer = setInterval(detectComposeToolbars, DETECTION_INTERVAL_MS);

  function detectComposeToolbars() {
    if (stopped) {
      return;
    }

    cleanupOrphanedInstances();

    for (const attachButton of document.querySelectorAll(ATTACH_BUTTON)) {
      const toolbar = attachButton.parentElement;

      if (!toolbar || toolbar.querySelector(`[${ROOT_ATTRIBUTE}]`)) {
        continue;
      }

      injectLauncher(attachButton);
    }
  }

  function injectLauncher(attachButton) {
    const host = document.createElement("span");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    const button = document.createElement("button");
    const icon = document.createElement("img");
    const iframe = document.createElement("iframe");
    const panelToken = crypto.randomUUID();

    host.setAttribute(ROOT_ATTRIBUTE, "true");
    host.style.display = "inline-flex";
    host.style.alignItems = "center";

    style.textContent = `
      :host {
        display: inline-flex;
        align-items: center;
      }

      button {
        width: 20px;
        height: 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin: 0 8px 0 0;
        padding: 0;
        border: 0;
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
      }

      button:hover,
      button:focus-visible {
        background: rgba(60, 64, 67, 0.08);
      }

      img {
        width: 18px;
        height: 18px;
        display: block;
        object-fit: contain;
      }
    `;

    button.type = "button";
    button.title = "Open Meetza";
    button.setAttribute("aria-label", "Open Meetza");

    icon.src = chrome.runtime.getURL("icons/icon32.png");
    icon.alt = "";

    button.appendChild(icon);
    shadow.append(style, button);

    iframe.hidden = true;
    iframe.src = "about:blank";
    iframe.title = "Meetza";
    iframe.referrerPolicy = "no-referrer";
    iframe.setAttribute("aria-label", "Meetza availability generator");

    Object.assign(iframe.style, {
      position: "fixed",
      zIndex: "999999",
      width: `${PANEL_WIDTH}px`,
      height: `${DEFAULT_PANEL_HEIGHT}px`,
      maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
      border: "0",
      borderRadius: "12px",
      background: "transparent",
      boxShadow: "0 8px 28px rgba(0, 0, 0, 0.22)"
    });

    attachButton.insertAdjacentElement("beforebegin", host);
    document.body.appendChild(iframe);

    const instance = {
      host,
      button,
      iframe,
      ready: false,
      trackingTimer: null,
      messageListener: null,
      height: DEFAULT_PANEL_HEIGHT
    };

    registerPanelToken(panelToken).then((registered) => {
      if (!registered || !iframe.contentWindow || !iframe.isConnected) {
        removeInstance(instance);
        return;
      }

      try {
        const panelUrl = `${chrome.runtime.getURL("panel/panel.html")}#${panelToken}`;
        iframe.contentWindow.location.replace(panelUrl);
        instance.ready = true;
      } catch {
        removeInstance(instance);
      }
    });

    instance.messageListener = (event) => {
      if (event.source !== iframe.contentWindow) {
        return;
      }

      if (event.data?.type === PANEL_CLOSE_MESSAGE) {
        closeInstance(instance);
        return;
      }

      if (event.data?.type === PANEL_RESIZE_MESSAGE) {
        const nextHeight = Number(event.data.height);

        if (Number.isFinite(nextHeight)) {
          instance.height = clamp(
            Math.ceil(nextHeight),
            MIN_PANEL_HEIGHT,
            MAX_PANEL_HEIGHT
          );

          if (!iframe.hidden) {
            positionIframe(instance);
          }
        }
      }
    };

    window.addEventListener("message", instance.messageListener);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (!instance.ready) {
        return;
      }

      if (iframe.hidden) {
        openInstance(instance);
      } else {
        closeInstance(instance);
      }
    });

    instances.add(instance);
  }

  async function registerPanelToken(panelToken) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: REGISTER_PANEL_MESSAGE,
        panelToken
      });

      return response?.ok === true;
    } catch {
      return false;
    }
  }

  function openInstance(instance) {
    for (const other of instances) {
      if (other !== instance) {
        closeInstance(other);
      }
    }

    instance.iframe.hidden = false;
    positionIframe(instance);
    startTracking(instance);
  }

  function closeInstance(instance) {
    instance.iframe.hidden = true;
    stopTracking(instance);
  }

  function startTracking(instance) {
    stopTracking(instance);

    instance.trackingTimer = setInterval(() => {
      if (instance.iframe.hidden) {
        return;
      }

      if (!instance.host.isConnected) {
        removeInstance(instance);
        return;
      }

      positionIframe(instance);
    }, TRACKING_INTERVAL_MS);
  }

  function stopTracking(instance) {
    if (!instance.trackingTimer) {
      return;
    }

    clearInterval(instance.trackingTimer);
    instance.trackingTimer = null;
  }

  function positionIframe(instance) {
    const buttonRect = instance.button.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const height = Math.min(instance.height, window.innerHeight - VIEWPORT_MARGIN * 2);
    const spaceAbove = buttonRect.top - VIEWPORT_MARGIN;
    const spaceBelow = window.innerHeight - buttonRect.bottom - VIEWPORT_MARGIN;

    let top = spaceAbove > spaceBelow
      ? buttonRect.top - height - PANEL_GAP
      : buttonRect.bottom + PANEL_GAP;

    let left = buttonRect.left;

    top = clamp(
      top,
      VIEWPORT_MARGIN,
      window.innerHeight - height - VIEWPORT_MARGIN
    );

    left = clamp(
      left,
      VIEWPORT_MARGIN,
      window.innerWidth - width - VIEWPORT_MARGIN
    );

    instance.iframe.style.width = `${width}px`;
    instance.iframe.style.height = `${height}px`;
    instance.iframe.style.top = `${top}px`;
    instance.iframe.style.left = `${left}px`;
  }

  function cleanupOrphanedInstances() {
    for (const instance of [...instances]) {
      if (!instance.host.isConnected) {
        removeInstance(instance);
      }
    }
  }

  function removeInstance(instance) {
    stopTracking(instance);
    window.removeEventListener("message", instance.messageListener);
    instance.iframe.remove();
    instance.host.remove();
    instances.delete(instance);
  }

  function shutdown() {
    if (stopped) {
      return;
    }

    stopped = true;

    if (detectionTimer) {
      clearInterval(detectionTimer);
      detectionTimer = null;
    }

    for (const instance of [...instances]) {
      removeInstance(instance);
    }

    chrome.runtime.onMessage.removeListener(runtimeMessageListener);
    document.removeEventListener(DISABLE_EVENT, disableEventListener);
    globalThis.__MEETZA_CONTENT_SCRIPT_LOADED__ = false;
  }

  function clamp(value, minimum, maximum) {
    return maximum < minimum
      ? minimum
      : Math.min(Math.max(value, minimum), maximum);
  }
})();
