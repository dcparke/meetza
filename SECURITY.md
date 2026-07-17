# Security

Meetza sits next to email and calendar data. That makes the restraint more important than the features.

## What is protected

- Gmail content
- Google access tokens
- Calendar busy ranges
- Entered calendar addresses
- Saved settings

## Trust boundaries

The background process is trusted with OAuth and raw FreeBusy data.

The Gmail content script is not. It receives only settings needed for the form and final free ranges. It cannot read extension storage or make network requests.

The Gmail page is not trusted. The UI lives in a closed Shadow DOM and ignores synthetic button clicks. The page can still remove or cover the extension's host element. That is a denial-of-service risk, not a path to the OAuth token.

Google is trusted to authenticate users and return FreeBusy data over HTTPS.

## Controls

- Gmail permission is optional and off by default
- Content scripts are registered only while enabled
- Storage is restricted to trusted extension contexts
- OAuth tokens never enter Gmail
- Raw busy ranges never enter Gmail
- FreeBusy is queried one selected workday at a time
- Request fields are allowlisted and bounded
- Google responses are validated
- Inaccessible calendars fail closed
- One request may run per Gmail tab
- Per-tab and global rate limits protect API quota
- Network requests have a fixed destination
- Content Security Policy starts with `default-src 'none'`
- No remote code or runtime dependencies

## Accepted risks

A content script with Gmail permission can technically read Gmail's DOM. Meetza's content script does not, but a malicious release could. The strongest defenses are small code, careful review, and a secure release process.

A hostile Gmail page can hide or remove Meetza's injected host. It cannot use Meetza's extension APIs directly.

Free/busy data can reveal patterns. Meetza requests only the selected workday and does not persist the result.

Edge and Firefox use a public-client PKCE flow. Access tokens remain in memory and may need to be reacquired when the background process restarts. Meetza does not store refresh tokens.

## Release rules

Meetza is intentionally small. Changes should preserve that.

Meetza will not add analytics, telemetry, a backend service, runtime dependencies, remote code, or persistent OAuth and availability data.

Published builds should come from a protected branch and a reviewed commit. Keep the release artifact and its checksum.

## Reporting a vulnerability

Use GitHub's private security advisory feature. Do not open a public issue for an unpatched vulnerability.

Include the affected version, a short proof of concept, and the impact. We will confirm receipt before discussing a public disclosure date.
