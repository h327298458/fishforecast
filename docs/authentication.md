# Account access and invitations

TideLine keeps users, invitation hashes, and session-token hashes in SQLite.
Passwords use scrypt and are never written to logs or returned by an API.

## First administrator

Before the first server start, set the following only in the server `.env`:

```dotenv
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=<a-unique-10-plus-character-password>
COOKIE_SECURE=true
```

When the users table is empty, startup creates that administrator and assigns
existing unowned single-user data to it. Remove `INITIAL_ADMIN_PASSWORD` after
this has succeeded; it is not needed on later starts.

## Invitations

An administrator creates, copies, and revokes invitations in Settings. Codes
can have an expiry and a maximum-use limit. The plaintext code is shown once at
creation; the database stores a SHA-256 hash only.

## Production settings

Use HTTPS and retain `COOKIE_SECURE=true`. For a short-lived plain-HTTP
diagnostic deployment only, explicitly set `COOKIE_SECURE=false`; HTTP exposes
session cookies to network interception and is not suitable for real users.

Set `ALLOWED_ORIGIN` to the comma-separated development origins that may access
the API, for example `http://localhost:5173`. Same-origin deployed requests are
allowed without CORS.
