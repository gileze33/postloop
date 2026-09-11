# Postloop

A local two-way mail dev tool. Postloop catches the email your app sends (over SMTP), shows it in a
two-list-plus-reading-pane inbox, and lets you **reply back into your app** by
POSTing the reply to an inbound endpoint you configure. It closes the loop: your app emails someone, you
read it in Postloop, you reply as that someone, and the reply lands back in your app as inbound mail.

Distributed as a single runnable package: `npx postloop`, no separate frontend and backend to deploy.

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

- **`plain`** — no wrapping; `From` is the original sender.
- **`google-groups`** — list rewrite: `From` becomes `"'Name' via Group"`, the real sender moves to
  `X-Original-From` / `X-Original-Sender` / `Reply-To`, and `List-Id` / `Precedence: list` /
  `X-Google-Group-Id` / `X-Forwarded-To` are added. Needs the group address.
- **`gmail-forward`** — manual Gmail forward: `From` is the forwarder, `Subject: Fwd:`, the original quoted
  in a `---------- Forwarded message ---------` body block. Needs the forwarder address.
- **`outlook-forward`** — manual Outlook (new/OWA) forward: `From` is the forwarder, `Subject: FW:`, the
  original in a `divRplyFwdMsg` block with a `Sent:` date. Needs the forwarder address.

The header shapes are drawn from RFCs, Google/Microsoft docs and real parser fixtures. Later profiles
(Microsoft 365 distribution group / redirect, classic Outlook, the DMARC-not-rewritten Google Groups
variant) are on the TODO list.

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

## TODO

- **Raw source view** per message: show the raw `.eml` (headers and body) so you can see exactly what was sent or caught.
- **Header panel**: surface `Message-ID`, `In-Reply-To`, `References` and `Date` on a message, to verify threading.
- **More forward profiles**: Microsoft 365 distribution group / inbox-rule redirect (`Resent-*`, `X-MS-Exchange-*`, SRS `Return-Path`), classic Outlook for Windows (`-----Original Message-----` / Word HTML), and the DMARC-not-rewritten Google Groups variant. Ideally modelled from one captured sample each.
- **Custom headers in the composer**: set arbitrary ad-hoc headers, beyond the built-in forward profiles.
- **Bcc and reply-all**, and a **plain-text alternative** part alongside the HTML (`multipart/alternative`).
- **Housekeeping**: delete a message, clear an inbox.
- **Carry the original's attachments when forwarding** (forward currently quotes the body only).
- **Search message subjects and bodies**, not just addresses.
- **Canned scenarios** in the UI (new thread, reply, forward, distribution-list) for one-click test sends.
- **Sanitise received HTML** before rendering it in the reading pane.
- **Persist compose attachments** across reopens (currently only the text fields of the New-message draft persist).
- Test coverage and a test framework (unit for the store/compose, an SMTP round-trip integration test).
- Live updates: replace the UI's polling with SSE or a websocket.
- Optional Vite middleware mode for HMR in dev (currently `vite build --watch`).
