# Changelog

## 2.0.0

Security architecture release.

### Changed

- Gmail host access is now optional and removed when Meetza is disabled.
- Gmail injection is dynamically registered instead of declared statically.
- The Gmail-side script is reduced to a launcher and iframe positioner.
- The availability UI now runs in an extension-origin iframe.
- Extension storage is restricted to trusted extension contexts.
- Generate requests contain only dates, calendar identifiers, duration, and output time zone.
- Workday boundary and break settings are read by the service worker, not trusted from the Gmail UI.
- FreeBusy requests are limited to each selected workday, avoiding unselected dates and overnight gaps.
- Per-tab request rate limiting and one-active-request enforcement were added.
- FreeBusy responses and busy ranges are validated before use.
- Recent-people storage defaults to off.
- Repository security checks and dependency-free unit tests were added.

### Removed

- Static Gmail content-script registration.
- Direct storage access from the Gmail content script.
- Direct rendering of the Meetza form into the Gmail DOM.
- Unused UI and workday-boundary controls from the Gmail panel.
