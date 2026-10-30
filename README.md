# cdn — VoidCDN

**Fast, private file delivery for the VoidSuite family.** Sign in once with **VoidAuth**, drop
files, and share clean links served from your own Bunny pull zone. Every account gets a
storage quota, per-file visibility, and admin-configurable retention — with direct-to-storage
uploads where the backend supports it.

> **Security model (be aware):** VoidCDN is server-authoritative. File metadata lives in the
> app's SQLite database and the gateway can read stored objects (needed for quota, retention
> sweeps, admin management and private downloads). Access is gated by your VoidAuth account and
> transport is TLS in production. Private files are **never** exposed through the pull zone.

## Highlights

| Feature | How it works |
| --- | --- |
| Sign in with VoidAuth | OAuth 2.0 + PKCE; the gateway mints an httpOnly session cookie and keeps tokens server-side. |
| 1 GB per user | Per-account quota (default 1 GiB) with live usage, overrideable per user by an admin. |
| Automatic retention | Files over 50 MB expire after 7 days by default; admins pick 24 h → unlimited. |
| Unlisted / private | Per-file visibility, unlisted by default. Private files are served only by the gateway after an ownership check. |
| Admin panel | `role=admin` is re-validated against VoidAuth userinfo before a short-lived admin cookie is minted. |
| Uploads that scale | Presigned direct-to-S3 where supported; otherwise the gateway streams the upload. |
| Unpredictable URLs | Objects are stored as `[random16]_original-name.ext` inside per-user date folders. |
| API tokens | Scoped personal tokens for scripts and CI, hashed at rest. |

## Architecture

```
client/   Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui — AppShell UI
server/   Bun + Hono gateway: VoidAuth OAuth proxy, REST API, SQLite metadata,
          storage drivers (local / S3 / Bunny), retention sweeper
```

- Client dev server `:5180` · gateway `:3007` · SQLite at `server/data/voidcdn.db`.
- The gateway serves `client/dist` in production, so one process hosts UI + API.
- Storage drivers: `local` (dev fallback), `s3` (any S3-compatible store, presigned uploads),
  `bunny` (native Storage API + pull-zone delivery).
- A background sweeper deletes expired files and stale upload intents.

## Getting started

Requires [Bun](https://bun.sh) ≥ 1.2.

```bash
cp .env.example .env        # fill in values (see below)
bun install                 # not needed at the root; install per package
cd client && bun install && cd ..
cd server && bun install && cd ..
bun dev.ts                  # client :5180 + gateway :3007 together
```

Or run each side separately:

```bash
cd server && bun run dev    # gateway :3007
cd client && bun run dev    # client :5180 (proxies /api and /f to :3007)
```

Without a configured storage backend the app uses the `local` driver, so you can sign in and
upload immediately. Files are written to `server/data/blobs` and served through `/f/:key`.

### Registering the OAuth client

VoidAuth seeds a `voidcdn` client on first boot with redirect URIs
`http://localhost:5180/oauth/callback` and `https://cdn.voidsuite.cc/oauth/callback`, and the
scopes `openid profile email read write role`. Copy its generated secret into
`VOIDCDN_CLIENT_SECRET` in `.env`.

For a different deployment, register a client in VoidAuth with:

- **Redirect URI:** `<APP_URL>/oauth/callback`
- **Scopes:** `openid profile email read write role` (`role` enables the admin claim)

The `role` scope is what makes the `role=admin` claim appear in the id_token/userinfo response.
Tokens refreshed by the CDN keep the original session scope. The requested scopes come from
`VOIDAUTH_SCOPES` — omit `role` while the VoidAuth deployment predates the scope, and use the
`CDN_ADMIN_EMAILS` allowlist below instead.

### Admin access

Admin access does **not** use a separate password:

1. The signed-in user must have `role=admin` in VoidAuth, or their email must be listed in
   `CDN_ADMIN_EMAILS` (comma-separated). The allowlist is a local fallback for deployments
   where the `role` scope is not live yet.
2. The **Unlock admin panel** button calls VoidAuth userinfo (refreshing the access token once if
   needed), verifies the user id, then applies the `role` claim or the email allowlist.
3. A short-lived (default 30 min) HttpOnly cookie scoped to `/api/admin` is minted.
4. Every admin request re-checks both that cookie and the local admin flag.

Bootstrap/repair the local cache after the user has signed in at least once:

```bash
cd server
bun run admin:grant you@example.com     # sets the local cache flag
bun run admin:revoke you@example.com
```

When `voidsuite/server` is redeployed with the `role` scope, add `role` back to `VOIDAUTH_SCOPES`
and drop the allowlist; a real `role` claim is authoritative and overrides it.

### Initial setup: workspace install

The project is two independent packages (no root workspace install):

```bash
(cd client && bun install)
(cd server && bun install)
```

## Environment variables

See [`.env.example`](./.env.example) for the full list. The important groups:

| Variable | Purpose |
| --- | --- |
| `PORT` | Gateway port (default `3007`). |
| `APP_URL` | Public app origin (OAuth redirect, CORS, secure cookies). |
| `VOIDAUTH_URL` | VoidAuth issuer (prod `https://auth.voidsuite.cc`). |
| `VOIDCDN_CLIENT_ID` / `VOIDCDN_CLIENT_SECRET` | OAuth client credentials. |
| `VOIDAUTH_SCOPES` | Scopes requested at login (default includes `role`). |
| `CDN_ADMIN_EMAILS` | Comma-separated admin allowlist used when no `role` claim is present. |
| `DATA_DIR` | SQLite database + local blob root (default `./data`). |
| `ADMIN_SESSION_TTL_MINUTES` | Elevated admin session lifetime (default `30`). |
| `STORAGE_DRIVER` | `local` \| `s3` \| `bunny`. |
| `UPLOAD_MODE` | `auto` \| `presigned` \| `proxy`. |
| `STORAGE_PREFIX` | Key prefix (default `u`). |
| `BUNNY_STORAGE_ZONE` / `BUNNY_STORAGE_PASSWORD` | Bunny Storage zone + password. |
| `BUNNY_CDN_BASE_URL` | Pull-zone origin, e.g. `https://storage.void.co.im`. |
| `BUNNY_TOKEN_AUTH_KEY` | Optional pull-zone token authentication key. |
| `S3_*` | S3-compatible endpoint, bucket, keys and optional public base URL. |
| `MAX_REQUEST_BODY_BYTES` | Bun request-body cap for the gateway (default 8 GiB). |
| `DEFAULT_*` / `LARGE_FILE_*` | Default quota, upload limit and retention policy. |

### Bunny setup

1. Create a **Storage Zone** and note its name and password.
2. Create (or reuse) a **Pull Zone** and connect it to that storage zone as its origin.
3. Point a hostname at the pull zone — here, `https://storage.void.co.im`.
4. Set `STORAGE_DRIVER=bunny`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD` and
   `BUNNY_CDN_BASE_URL=https://storage.void.co.im`.
5. Optional: enable **Token Authentication** on the pull zone and set `BUNNY_TOKEN_AUTH_KEY`.
   Unlisted links are then signed with HMAC-SHA256 and a long TTL.

Uploads are proxied through the gateway with Bunny's native Storage API (streamed, not buffered); reads go straight
through the pull zone. If token auth is disabled, unlisted files are served from the pull zone
and private files from the gateway.

> **Private files:** private objects are never given a pull-zone URL. The UI/API always returns
> `/api/files/:id/download`, which validates ownership (or admin) before streaming.

## Object naming and URLs

Each upload gets a short random, unguessable prefix while keeping the original name readable:

```
{STORAGE_PREFIX}/{12-hex-random}_{sanitized-name}.ext
```

Example: uploading `My Photo (1).png` becomes

```
https://storage.void.co.im/u/7ccd02b33c3b_My-Photo-1.png
```

- The 12-hex prefix is 6 random bytes (48 bits), so object keys cannot be guessed from the filename.
- No per-user or per-month folders, so links stay as short as possible.
- The original filename is sanitized (`My Photo (1).png` → `My-Photo-1.png`).
- **Renaming a file in the UI changes only its display name / download filename.** The storage
  key, the object and the public URL stay the same. There is no move-on-rename.

## Retention and quotas

- Default quota: **1 GiB per user** (admin override per account; blank = unlimited).
- Default per-file upload limit: **1 GiB** (global and per-user overrides).
- Files **≥ 50 MiB** get a 7-day expiry by default. Smaller files never expire.
- Admins can choose automatic retention from **24 hours to unlimited** using presets or a custom
  hour value, globally, per user, or per file.
- Expiry is enforced by the sweeper: expired rows are soft-deleted and their objects removed.
- Quota is checked at intent creation and again when a proxied upload completes.

## Admin panel

The `/admin` tab includes:

- **Overview** — storage, users, downloads and recent audit events.
- **Files** — search every user's files, change name/visibility/retention, delete.
- **Users** — search, inspect usage, set quota / max upload / retention overrides.
- **Settings** — global quota, upload limit, large-file threshold and retention, default
  visibility, blocked MIME types.
- **Audit** — who did what, with IP and user agent.

Blocked MIME types (SVG, HTML, JavaScript by default) are rejected with `415` because they can
execute in a browser context. Inline serving is limited to a safe allowlist; everything else is
sent with `Content-Disposition: attachment`.

## API tokens

Create scoped tokens in **Settings → API tokens**. Tokens are shown once and stored as SHA-256
hashes. Scopes:

`files:read`, `files:upload`, `files:delete`, `files:share`, `stats:read`.

Send them as a bearer token:

```bash
curl -H "Authorization: Bearer vcdn_..." https://cdn.voidsuite.cc/api/files
```

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/files` | List your files (`page`, `limit`, `search`, `type`, `sort`, `visibility`). |
| `GET` | `/api/files/stats` | Usage, quota, expiring count and defaults. |
| `POST` | `/api/files/intents` | Create an upload intent (`name`, `size`, `mime`, `visibility`). |
| `PUT` | `/api/files/:id/content` | Proxy upload body (when the intent returns `mode: proxy`). |
| `POST` | `/api/files/:id/complete` | Finalize a presigned upload. |
| `PATCH` | `/api/files/:id` | Rename and/or change visibility. |
| `DELETE` | `/api/files/:id` | Delete a file and its object. |
| `GET` | `/api/files/:id/url` | Fresh share link. |
| `GET` | `/api/files/:id/download` | Download (auth required for private files). |
| `GET` | `/f/:key` | Public object passthrough (local / no pull zone). |

## Docker

```bash
docker compose up --build   # builds client + server; gateway listens on :3011
```

The SQLite database (and any local fallback blobs) live in the `cdn-data` volume, so they
survive container recreates. Set `DATA_DIR` to keep data elsewhere.

## Testing

```bash
bun run verify   # client typecheck + build + server tests + lint
bun run test     # storage naming / MIME safety tests
```

## Production notes

- Put the gateway behind your reverse proxy; terminate TLS there and forward to `127.0.0.1:3011`.
- Set `APP_URL=https://cdn.voidsuite.cc` so cookies are `Secure` and the OAuth callback matches.
- Keep `VOIDCDN_CLIENT_SECRET`, `BUNNY_STORAGE_PASSWORD` and `BUNNY_TOKEN_AUTH_KEY` server-side.
- The admin cookie is scoped to `/api/admin`; the user session cookie to `/`.
- Run `bun run sweep` from cron if you disable the built-in sweeper process, or keep the gateway
  running (it starts the sweeper automatically).
- Back up `DATA_DIR/voidcdn.db` (plus the Bunny zone / S3 bucket for objects).

## License

MIT (see repository root).