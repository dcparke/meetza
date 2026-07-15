# Browser Support

## Supported

### Google Chrome

Chrome 102 or newer is the current supported target.

The extension currently depends on Chrome-specific behavior for:

- `chrome.identity.getAuthToken`
- dynamic content-script registration
- optional host permissions
- trusted-context storage access

## Not yet supported

### Microsoft Edge

Most WebExtension code is reusable, but the current Google authentication path is Chrome-specific. Edge support requires a separate OAuth adapter.

### Firefox

The UI and pure core are portable, but authentication and permission handling require a Firefox-specific adapter and testing.

### Safari

Safari requires conversion, packaging, authentication work, and separate testing.

## Portability rule

Browser-specific authentication code should remain isolated from the pure core and UI logic. Do not claim support for a browser until authentication, permissions, Gmail injection, and calendar-sharing tests pass on that browser.
