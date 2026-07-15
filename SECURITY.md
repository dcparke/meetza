# Security Policy

## Supported versions

Security fixes are applied to the latest release line.

| Version | Supported |
|---|---|
| 2.x | Yes |
| Earlier prototypes | No |

## Reporting a vulnerability

Please do not open a public GitHub issue for a suspected vulnerability.

Use GitHub private vulnerability reporting when it is enabled for the repository. If private reporting is unavailable, contact the maintainers through a private channel listed by the repository owner.

Include:

- affected version or commit
- reproduction steps
- expected and observed behavior
- impact assessment
- proof of concept, if safe to provide

Do not include real user calendar data, OAuth tokens, email content, or other personal data in a report.

## Security boundaries

The project treats these as high-value assets:

- Google OAuth access tokens
- raw calendar busy timestamps
- entered calendar identifiers
- generated availability
- release and publisher credentials

The intended boundaries are:

- OAuth tokens never leave the service worker.
- Raw busy ranges never leave the service worker.
- The Gmail content script does not read email content.
- The Gmail content script does not read extension storage.
- The Meetza form is isolated from the Gmail DOM in an extension-origin iframe.
- Gmail host access is optional and removed when Meetza is disabled.

See [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Changes that require explicit security review

The following changes must not be treated as routine feature work:

- new OAuth scopes
- new host permissions
- new required extension permissions
- Gmail API access
- Contacts API access
- calendar event-list access
- remote network destinations
- analytics or telemetry
- a backend service
- runtime dependencies
- remotely hosted code
- use of `innerHTML`, `eval`, or `new Function`
- exposing additional web-accessible resources
- changing message sender validation
- changing publisher or release controls

Any such change should include an updated threat model and permission justification in the pull request.
