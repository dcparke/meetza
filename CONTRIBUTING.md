# Contributing

Thank you for contributing to Meetza.

## Before opening a pull request

Run:

```bash
npm run check
```

The repository intentionally has no runtime dependencies. Please keep changes small and auditable.

## Code guidelines

- Prefer plain JavaScript, HTML, and CSS.
- Keep the Gmail content script minimal.
- Keep OAuth and network access in the service worker.
- Keep availability calculations in `core/`.
- Do not place user-controlled data into HTML strings.
- Use `textContent` and DOM construction for dynamic content.
- Validate messages again at the service-worker boundary.
- Fail closed when calendar availability cannot be read.
- Do not log tokens, calendar identifiers, busy ranges, or generated availability.
- Avoid adding dependencies when the browser platform can solve the problem directly.

## Security-sensitive changes

Review [SECURITY.md](SECURITY.md) before changing permissions, OAuth scopes, network destinations, storage, message handling, or Gmail integration.

Pull requests that change the trust model should also update:

- `docs/ARCHITECTURE.md`
- `docs/THREAT-MODEL.md`
- `docs/PRIVACY.md`
- relevant tests or repository validation rules

## Commit and pull request scope

Prefer one focused change per pull request. Security review is easier when behavior, permissions, and data flow can be understood from a small diff.
