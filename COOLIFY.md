# Postiz on Coolify

Fork: https://github.com/namkiba13/postiz-app

Deployment branch: `deploy/coolify`, based on upstream `v2.25.0`.
Compose file: `/docker-compose.coolify.yml`.
`Dockerfile.coolify` extends the official Postiz image pinned by version and
digest, rebuilding the backend and orchestrator with configurable AI models.
The frontend and installed dependencies come from that pinned image.

## Configuration

Create a public Git application with Docker Compose as its build pack. Assign
`https://postiz.66.163.122.150.sslip.io:5000` to the `postiz` service in Coolify.
The `:5000` selects the internal proxy target; visitors use HTTPS on port 443.
Keep auto-deploy disabled and let Coolify manage HTTPS.

Set these runtime variables in Coolify (never commit their values):

| Variable | Value |
| --- | --- |
| `POSTIZ_URL` | `https://postiz.66.163.122.150.sslip.io` |
| `JWT_SECRET` | Random secret, at least 32 bytes |
| `POSTGRES_PASSWORD` | Random hexadecimal password |
| `REDIS_PASSWORD` | Random hexadecimal password |
| `TEMPORAL_POSTGRES_PASSWORD` | Random hexadecimal password |
| `FACEBOOK_APP_ID` | Your Meta application ID, when ready |
| `FACEBOOK_APP_SECRET` | Your Meta application secret, when ready |
| `OPENAI_API_KEY` | Your AI provider key, when ready |
| `OPENAI_BASE_URL` | `https://94api.dev/v1` for 94API; defaults to OpenAI |
| `OPENAI_MODEL` | Text/Agent model ID available to your key |
| `OPENAI_IMAGE_MODEL` | Image model ID available to your key |
| `OPENVIKING_URL` | Optional HTTPS server origin, e.g. `https://memory.94api.dev` |
| `OPENVIKING_API_KEY` | OpenViking user key for the dedicated Postiz account |
| `OPENVIKING_ORGANIZATION_ID` | Postiz organization ID allowed to use this key |

Hexadecimal database/Redis passwords are safe inside connection URLs without
additional URL encoding. `DISABLE_REGISTRATION=true` permits the first local
account while the database is empty, then closes public registration. Open
`/auth` and create that account. No email provider is configured, so initial
registration does not require an activation email; password-reset emails need
an email provider added later.

## Services and checks

Postiz runs its frontend, backend and orchestrator in the official image.
PostgreSQL stores application data; Redis uses append-only persistence.
Temporal 1.28.1 stores workflow state and visibility in a separate PostgreSQL
instance, using Temporal's supported SQL visibility backend.

All five services have health checks. Postiz's check covers its web frontend,
the database-backed registration endpoint and the orchestrator's Temporal
namespace connectivity. Only Postiz's web service is routed publicly.

After deploying, verify:

```bash
curl --fail https://postiz.66.163.122.150.sslip.io/auth
curl --fail https://postiz.66.163.122.150.sslip.io/api/auth/can-register
```

Coolify should report healthy containers. Check Postiz logs for successful
orchestrator startup and Temporal worker registration. Testing an actual
scheduled Facebook post requires a connected Page and an approved draft.

## Facebook and AI

Follow https://docs.postiz.com/providers/facebook to create your own Meta app
and configure its OAuth callback for this hostname. Save the two Facebook
variables in Coolify and redeploy before connecting your Page in Postiz.
The callback is `${POSTIZ_URL}/integrations/social/facebook`.
AI generation requires `OPENAI_API_KEY` and a redeploy. For 94API, set
`OPENAI_BASE_URL=https://94api.dev/v1`, `OPENAI_MODEL=gpt-6.1-sol` and
`OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst`. The Agent uses Responses API with
`store=false`, carrying the complete conversation and tool results between
requests instead of depending on server-bound item IDs. This allows
`gpt-6.1-sol` to use reasoning with function tools; its Chat Completions endpoint
only supports function tools when reasoning is disabled. Verify streaming and
a complete tool-call round trip when changing providers.
Other text tools use Chat Completions; image generation uses Images API.
The image setting alone does not establish image-generation compatibility.
Leaving either model variable empty retains its upstream model defaults.

### Agent writing workflow

The Agent chat uses selected `marketingskills/social` guidance to draft and
`blader/humanizer` guidance to edit before returning the final text in the same
model response. It follows the user's language, includes Vietnamese style
guidance, and uses facts and voice samples from the current conversation.
Sources, pinned revisions and MIT notices are in
[`WRITING-SOURCES.md`](libraries/nestjs-libraries/src/chat/WRITING-SOURCES.md).

This is configured in `LoadToolsService.agent().instructions` and takes effect
after a backend rebuild/redeploy. Writing a draft returns text in chat;
creating a calendar draft or scheduling still uses the existing Postiz tools.
The separate Generate Posts feature has its own instructions.

After deploying, open `/agents/new` and verify:

1. Ask in Vietnamese for a short Facebook introduction to 94API, supplying
   `https://94api.dev`, text model `gpt-6.1-sol` and image model
   `gpt-image-2.5-sunburst`. Request chat text only. Expect a complete Vietnamese
   post preserving those facts, without invented prices, speed or customer
   claims, raw HTML, or a scheduling/composer tool call.
2. Ask to shorten the same post while preserving the URL and both model IDs.
   Expect an edited post that follows the same voice and preserves those facts.
3. Ask the Agent to list connected channels. Expect the existing channel-list
   tool to run and its real result to be reported normally.

### OpenViking long-term memory

The optional `openvikingMemory` Agent tool calls the remote server configured
above. All three variables are required. The key stays on the backend and is
bound to one authenticated Postiz organization; use a tenant user key rather
than a root key. Other organizations cannot use that memory connection.

The Agent searches relevant brand context before drafting, and uses `remember`
when the user asks to save facts, preferences or samples across chats. The note
is preserved in an OpenViking session; session commit queues native memory
extraction. An `accepted` result is pending, and `status` reports completion or
failure. `read` retrieves source text from a search result. Search context is
limited to 1,600 tokens and each HTTP request times out after 30 seconds.

Run the isolated tool check with:

```sh
node libraries/nestjs-libraries/src/chat/tools/openviking.memory.check.cjs
node libraries/nestjs-libraries/src/chat/mastra.history.check.cjs
```

The Coolify image build runs this check before compiling. For a live check:

1. Ask the Agent to remember a supplied brand fact. Confirm the tool returns a
   session and task ID; check the task reaches `completed`.
2. Open a new Agent chat and ask about that fact without repeating it. Confirm
   `openvikingMemory` searches and returns the saved fact from the remote server.
3. Ask for a post using that context and verify the facts and voice are applied.
   Inspect the returned source with the tool's `read` action if needed.
4. Send a follow-up, then reload the chat. The earlier post and subsequent
   response should both remain visible. Completed tool results replayed by
   CopilotKit are filtered before the Mastra bridge so it cannot overwrite a
   stored assistant turn with a tool-call-only fragment.

Self-hosted Postiz has no software subscription. External AI usage is billed
by its provider. The optional Polotno design editor requires a separate
commercial SDK license for production; no Polotno license is configured here.

## Persistence, backup and upgrades

Five named volumes preserve Postiz configuration, uploaded media, application
PostgreSQL, Redis and Temporal PostgreSQL across redeployments. Coolify prefixes
them with the application's Compose project name. Keep that application and
volume naming stable.

Before an upgrade, stop Postiz briefly and back up both PostgreSQL instances
with `pg_dumpall`, plus the uploads/config volumes and encrypted runtime
secrets. Resume Postiz after a consistent backup. Restore PostgreSQL dumps
into the corresponding matching major versions, restore files and secrets,
then restart Temporal and Postiz. Changing `JWT_SECRET` invalidates sessions.

Upgrade deliberately by changing the image version/digest on this branch,
reviewing upstream migration notes, and deploying in Coolify. Restoring an
older image after a schema change can require restoring the matching backup.
Use volume-preserving stop/redeploy for recovery; `docker compose down -v` or
Coolify's delete-volumes action permanently removes this installation's data.
