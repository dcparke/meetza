# Testing

## Automated checks

Run:

```bash
npm run check
```

This runs:

- availability tests
- break-padding tests
- exact-workday data-minimization checks
- daylight-saving conversion tests
- manifest permission checks
- OAuth scope checks
- remote-script checks
- dangerous DOM sink checks

## Manual security regression

### Optional Gmail permission

1. Install Meetza from source.
2. Confirm Gmail access is not granted at install time.
3. Open settings and enable **Enabled in Gmail**.
4. Confirm Chrome asks for access to `mail.google.com`.
5. Confirm the launcher appears in open Gmail tabs without a refresh.
6. Disable Meetza.
7. Confirm the UI disappears.
8. Confirm the Gmail host permission is removed.
9. Refresh Gmail and confirm the content script is not injected.

### Shared-calendar FreeBusy test

Use two Google accounts:

- Account A runs Meetza.
- Account B owns the test calendar.

On Account B, share the calendar with Account A using the permission that exposes free/busy availability but hides event details.

Create a busy block on Account B. In Meetza on Account A:

1. remove `Me`
2. add Account B's calendar email
3. generate availability
4. confirm the busy period is excluded
5. remove the sharing permission
6. generate again
7. confirm Meetza fails closed and identifies the inaccessible calendar

### Sparse-date data minimization

Select two non-consecutive dates far apart. In the service-worker Network panel, confirm Meetza sends one narrowly bounded FreeBusy request for each selected workday rather than one request covering the entire gap.

### Storage boundary

From the Gmail content-script console, confirm `chrome.storage.local` is not exposed after the service worker applies `TRUSTED_CONTEXTS` access.

### Rate limiting and cancellation

Attempt rapid generation requests and confirm Meetza prevents concurrent requests and excessive request frequency. Start a request, then close the Gmail tab or disable Meetza and confirm the active Calendar request is aborted.

### Panel capability

Open `panel/panel.html` directly from the extension package without a capability token and confirm privileged state and generation requests are rejected. Confirm a normal Gmail-launched panel works.

### Content Security Policy

Confirm extension pages load normally with the packaged scripts and styles. Confirm no remote script, arbitrary form submission, or non-Google network destination is required.
