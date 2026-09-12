# AI agents (MCP)

Postloop exposes a [Model Context Protocol](https://modelcontextprotocol.io) server over Streamable HTTP at
`/mcp`, on the same port as the UI (default `http://localhost:8025/mcp`). It lets an AI agent drive the same
two-way loop you drive in the UI: read caught mail, reply back into your app, send new messages, and wait for
expected mail to arrive.

The endpoint binds to loopback only and is unauthenticated, matching the JSON API; requests are validated
against the loopback `Host` (DNS-rebinding protection). The transport is stateless.

## Connecting

Point any MCP client at `http://<host>:<PORT>/mcp`. For Claude Code, a project `.mcp.json`:

```json
{
  "mcpServers": {
    "postloop": { "type": "http", "url": "http://localhost:8025/mcp" }
  }
}
```

On connect the server tells the agent, via the MCP `instructions`, that this is a local test sink and not
real mail.

## Tools

- **`list_inboxes`** — list every inbox that has caught or sent mail, most recent activity first.
- **`list_messages`** — list one inbox's messages, newest first, as summaries.
- **`get_message`** — read one message in full: headers, the plain-text and sanitised HTML bodies, threading
  ids and attachment metadata, or the raw `.eml` with `raw: true`.
- **`reply`** — reply to a message as its inbox, threaded via `In-Reply-To`/`References`, POSTed to
  `OUTBOUND_URL` (which must be set, as for replies in the UI). Give `text` or `html`.
- **`send`** — start a new conversation, or forward one, with the same forward profiles as the composer. Pass
  profile-specific fields (e.g. `groupAddress`) in `params`.
- **`wait_for_message`** — return as soon as a message matching a `from` / `subject` / `direction` filter
  exists, or block until one arrives (or a timeout): the primitive for "trigger an action in my app, then
  await the resulting mail and reply to it". Pass `since` (ISO) to ignore older mail.
- **`delete_message`** / **`clear_inbox`** — reset state between runs.

## Running several instances

Each Postloop instance serves its own `/mcp` on its own port. To run several (for example one per git
worktree), give each its own `PORT` and point that project's `.mcp.json` at that instance. An agent opened in
a project then talks to that project's Postloop and its mail.
