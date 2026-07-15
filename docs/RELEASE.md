# Release Process

A release is a security-sensitive operation.

## Before release

1. Run `npm run check`.
2. Review the manifest permission diff.
3. Review OAuth scope changes.
4. Review every network destination.
5. Review web-accessible resources.
6. Confirm there are no runtime dependencies or remotely hosted scripts.
7. Confirm the release artifact matches the reviewed source.

## Recommended controls

For organizational distribution:

- use an organization-owned Google Cloud project
- use an organization-owned extension publisher account
- require phishing-resistant multi-factor authentication
- protect the main branch
- require pull-request approval
- require a second person to approve releases
- sign release tags
- archive the exact published ZIP and its SHA-256 hash

## OAuth client ID

Normal users should use the OAuth client embedded in the published extension.

Developers loading unpacked source generally need a Chrome Extension OAuth client associated with their local unpacked extension ID.
