# Contributing

Meetza will stay small.

Before adding code, ask whether the feature can be omitted. Every permission and network call is a liability.

## Pull requests

Run:

```bash
npm run check
```

Keep changes narrow. Explain any effect on permissions, OAuth, storage, Gmail access, or network traffic.

Do not add runtime dependencies without a strong reason and a security review.

## Style

Use plain JavaScript and plain language.

Prefer a short function with a clear name over a clever abstraction. Comment the reason for a security decision, not the syntax of the next line.

Avoid logging user data, calendar IDs, tokens, FreeBusy responses, or email addresses.

## Security

Read [SECURITY.md](SECURITY.md) before changing the background process, content script, manifest, or authentication code.
