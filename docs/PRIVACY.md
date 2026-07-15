# Privacy

## Data Meetza requests from Google

Meetza uses the Google Calendar FreeBusy API and requests only busy time ranges for calendars the signed-in user is allowed to query.

Meetza does not request:

- event titles
- event descriptions
- event locations
- event attendees
- event notes
- Gmail messages
- Gmail recipients
- Google Contacts

## Data processed locally

The service worker temporarily processes:

- selected calendar identifiers
- selected dates
- busy start and end timestamps
- generated free ranges

Raw busy ranges are not persisted and are not sent to Gmail. Each selected date is requested only for the configured workday window. Active requests are cancelled when the originating Gmail tab closes or Meetza is disabled.

## Data stored locally

Meetza stores settings:

- enabled state
- default meeting length
- break padding
- workday boundary
- output time zone
- recent-person preference

When **Remember Recent People** is enabled, Meetza stores up to 15 email addresses that the user manually entered. This feature defaults to off.

Meetza does not operate a backend and does not send this stored data to a Meetza server.

## Clipboard

Availability is written to the clipboard only when the user selects **Copy**.
