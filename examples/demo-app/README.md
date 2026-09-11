# Demo app

A tiny stand-in for "your app" in the Postloop loop, used by the E2E suite and handy for a manual
try-out. It does the two things a real application does with Postloop:

- **Sends mail out** over SMTP into Postloop's sink (`POST /send`).
- **Receives replies back** on an inbound HTTP endpoint (`POST /outbound`) — the address you point
  Postloop's `OUTBOUND_URL` at.

It keeps what it has sent and received in memory and shows both on a dashboard at `/`, so you can watch
a message go out, reply to it in the Postloop UI, and see the reply land back here.

## Run it against Postloop

In one terminal, start Postloop pointed at this app's inbound endpoint:

```bash
OUTBOUND_URL=http://127.0.0.1:4000/outbound npx postloop
```

In another, start the demo app pointed at Postloop's SMTP sink:

```bash
SMTP_PORT=1025 PORT=4000 pnpm exec tsx examples/demo-app/app.ts
```

Open the dashboard on http://localhost:4000, click **Send a test email**, then open Postloop on
http://localhost:8025, read the message and reply. The reply appears back on the dashboard.

## Config

| Var | Default | What |
| --- | --- | --- |
| `PORT` | `4000` | This app's HTTP port (dashboard + `/send` + `/outbound`) |
| `SMTP_HOST` | `127.0.0.1` | Postloop's SMTP sink host |
| `SMTP_PORT` | `1025` | Postloop's SMTP sink port |

## Endpoints

- `GET /` — dashboard of sent and received mail
- `GET /health` — readiness probe
- `POST /send` — send a message into Postloop (JSON body: `from`, `to`, `subject`, `html`)
- `POST /outbound` — inbound endpoint Postloop POSTs replies to (`message/rfc822`)
- `GET /outbound` — the replies received so far, as JSON
- `GET /sent` — the messages sent so far, as JSON
- `POST /reset` — clear both lists
