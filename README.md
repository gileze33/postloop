# Postloop

[![npm version](https://img.shields.io/npm/v/postloop.svg)](https://www.npmjs.com/package/postloop)

A local two-way mail dev tool. Postloop catches the email your app sends (over SMTP), shows it in a
two-list-plus-reading-pane inbox, and lets you **reply back into your app** by
POSTing the reply to an inbound endpoint you configure. It closes the loop: your app emails someone, you
read it in Postloop, you reply as that someone, and the reply lands back in your app as inbound mail.

![Postloop's inbox: caught mail on the left, a message open with a reply drafted above the quoted original](https://raw.githubusercontent.com/gileze33/postloop/main/docs/screenshots/inbox.png)

## Run

```bash
npx postloop
# or: npm i -g postloop && postloop
```

Open the UI on http://localhost:8025 and point your app's outbound SMTP transport at `localhost:1025`.

## Configuration

All via environment variables:

| Var | Default | What |
| --- | --- | --- |
| `PORT` | `8025` | HTTP port for the UI and JSON API |
| `SMTP_PORT` | `1025` | SMTP port the sink listens on |
| `OUTBOUND_URL` | _(unset)_ | Your app's inbound endpoint; replies POST here. **Replies are disabled until this is set.** |
| `DATA_DIR` | `./data` | Filesystem store root |
| `DEFAULT_FORWARD_PROFILE` | `plain` | Default forward wrapper the composer pre-selects (see Forward styles) |

## How replies work

When you reply, Postloop composes an RFC 5322 message (From the inbox you're viewing, To the original
sender, with `In-Reply-To`/`References` chained onto the original) and POSTs it to `OUTBOUND_URL` as
`Content-Type: message/rfc822`. The recipient is the `To` of that message, so your inbound endpoint reads
it from there; Postloop sends nothing out-of-band.

If `OUTBOUND_URL` is unset, catching and reading still work; the reply button is disabled with a prompt to
set it.

## Forward styles

The composer can wrap a message in a provider's forwarding shape before it POSTs, so you can exercise how
an ingestion pipeline recovers the true sender and destination inbox. Pick one from the "Forward style"
dropdown, or set `DEFAULT_FORWARD_PROFILE` to pre-select it. Every profile sets `Delivered-To` to the
target inbox so a header-based router can resolve it.

![Composing a new message wrapped as a Google Groups distribution list](https://raw.githubusercontent.com/gileze33/postloop/main/docs/screenshots/compose.png)

- **`plain`** — no wrapping; `From` is the original sender.
- **`google-groups`** — list rewrite: `From` becomes `"'Name' via Group"`, the real sender moves to
  `X-Original-From` / `X-Original-Sender` / `Reply-To`, and `List-Id` / `Precedence: list` /
  `X-Google-Group-Id` / `X-Forwarded-To` are added. Needs the group address.
- **`gmail-forward`** — manual Gmail forward: `From` is the forwarder, `Subject: Fwd:`, the original quoted
  in a `---------- Forwarded message ---------` body block. Needs the forwarder address.
- **`outlook-forward`** — manual Outlook (new/OWA) forward: `From` is the forwarder, `Subject: FW:`, the
  original in a `divRplyFwdMsg` block with a `Sent:` date. Needs the forwarder address.

## Storage

Mail is stored on the filesystem as `data/{received-address}/{timestamp}.eml`, one folder per address the
mail was received on. The `data/` directory is gitignored.

## Development

```bash
pnpm install
pnpm dev     # vite build --watch + tsx-watched server on one port
pnpm build   # build the UI and compile the server to dist/
pnpm start   # run the built server
```

- `src/server` — Fastify (HTTP UI + JSON API), the SMTP sink, the filesystem store, and reply composition.
- `src/web` — React UI (Vite): the two lists and the reading/reply pane.
- `src/shared` — DTOs shared by both.
- `tests/e2e` — Playwright end-to-end tests that drive the real UI.
- `examples/demo-app` — a runnable stand-in for the app under test (sends mail in, receives replies back).

## Testing

End-to-end tests run in a real browser (Playwright) against the built UI, with a small
[demo app](examples/demo-app) standing in for your application. The demo app sends a message into Postloop
over SMTP; the test reads it and replies through the UI; it then asserts the reply arrives back at the demo
app's inbound endpoint, correctly threaded.

```bash
pnpm exec playwright install chromium   # one-off: fetch the browser
pnpm test                               # build, then run the E2E suite
pnpm test:e2e                           # run against an existing build
```

The stack boots on its own ports (HTTP `8130`, SMTP `1130`, demo app `4130` by default, all
env-overridable) so it never clashes with a Postloop instance running on the usual `8025`/`1025`. Caught
mail goes to a throwaway, gitignored `.e2e-data/` directory, never your normal `./data`. CI runs the suite
on every push and pull request (`.github/workflows/ci.yml`).

The README screenshots are produced by the same suite from a seeded inbox; regenerate them with
`POSTLOOP_CAPTURE=1 pnpm test:e2e`.

## TODO

- **AI Agent integrations**: Add an MCP server or similar. Consider how this could be used if multiple copies of Postloop are being run for different worktrees.
- **Header panel**: surface `Message-ID`, `In-Reply-To`, `References` and `Date` on a message, to verify threading.
- **More forward profiles**: Microsoft 365 distribution group / inbox-rule redirect (`Resent-*`, `X-MS-Exchange-*`, SRS `Return-Path`), classic Outlook for Windows (`-----Original Message-----` / Word HTML), and the DMARC-not-rewritten Google Groups variant.
- **Custom headers in the composer**: set arbitrary ad-hoc headers, beyond the built-in forward profiles.
- **Bcc and reply-all**, and a **plain-text alternative** part alongside the HTML (`multipart/alternative`).
- **Carry the original's attachments when forwarding** (forward currently quotes the body only).
- **Search message subjects and bodies**, not just addresses.
- **Canned scenarios** in the UI (new thread, reply, forward, distribution-list) for one-click test sends.
- **Persist compose attachments** across reopens (currently only the text fields of the New-message draft persist).
- Unit coverage for the store and compose/forwarding helpers (the Playwright E2E suite covers the full loop end to end; pure-function unit tests are still thin).
- Live updates: replace the UI's polling with SSE or a websocket.
- Optional Vite middleware mode for HMR in dev (currently `vite build --watch`).
