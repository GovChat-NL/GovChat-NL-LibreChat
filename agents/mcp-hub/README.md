# GovChat MCP Hub

The MCP executor hub connects to each remote MCP service through its own native
n8n **MCP Client Tool** node. JEMS is the first configured server and appears as
the dedicated **JEMS MCP** node in `mcp-executor-hub.workflow.json`.

## JEMS settings

Set these in the deployment `.env` (do not commit real credential values):

| Variable | Purpose |
| --- | --- |
| `JEMS_MCP_API_KEY` | JEMS API key |
| `JEMS_MCP_USERNAME` | JEMS account email (sent in the `X-Jems-Email` header) |
| `JEMS_MCP_PASSWORD` | JEMS account password |
| `MCP_HUB_JEMS_REQUIRED_GROUP_IDS` | JSON array of Entra group IDs allowed to use JEMS |
| `MCP_HUB_REGISTRY_TABLE_ID` | n8n Data Table ID used for the MCP function registry |

The JEMS staging MCP endpoint is fixed in the JEMS-specific MCP Client Tool and
registry-sync workflow nodes: `https://emr-jems-stage.rechenwerk.com/mcp`.
It is intentionally not an environment variable because it belongs to this
specific integration.

The one-shot bootstrap imports these three values as an encrypted n8n
`httpMultipleHeadersAuth` credential named **JEMS MCP Auth**. The secret values
are passed only to the bootstrap container, are written to a mode-0600 temporary
file for the n8n credential import, and that file is deleted immediately after
import. They are not embedded in a workflow export or passed to the n8n Code
task runners. The header names are fixed to `X-API-Key`, `X-Jems-Email`, and
`X-Jems-Password`, matching the JEMS staging gateway contract.

After changing a JEMS credential value, restart/re-run the bootstrap service so
it re-imports the credential. After changing a workflow JSON, set
`AGENTS_BOOTSTRAP_FORCE=true` for the bootstrap run so n8n imports and publishes
the updated workflow.

The n8n bootstrap creates a **MCP Hub Registry** Data Table in the project that
owns the MCP workflows. Its ID defaults to `GovChatMcpHubRegistry01` and is
passed to n8n and its task runners as `MCP_HUB_REGISTRY_TABLE_ID`. The table has
these columns:

| Column | Type |
| --- | --- |
| `mcp_id` | String |
| `server_name` | String |
| `tool_name` | String |
| `description` | String |
| `input_schema` | String |
| `required_group_ids` | String |
| `public` | Boolean |
| `enabled` | Boolean |
| `synced_at` | String |

The scheduled registry workflow initializes JEMS, fetches `tools/list`, and
upserts each function name, description, input schema, and configured Entra
group allowlist into this table. The table is created idempotently during
bootstrap. If overriding its ID in `.env`, use a 1–36 character alphanumeric ID
and keep it the same for n8n, the runners, and bootstrap. After the first
bootstrap, run the registry-sync workflow once to populate the table before
testing JEMS calls.

`n8n-openai-bridge` verifies the signed Entra access token and forwards its
verified group IDs as `user_authorized_groups`. Before each model run, the
orchestrator filters registry entries against those groups and injects only the
authorized JEMS names, descriptions, and schemas into the `mcp_hub` tool
description. The executor repeats the group and registry checks before calling
the native JEMS MCP Client Tool node. An empty group list denies access.

Add future MCP integrations as their own named MCP Client Tool nodes and their
own bootstrap-managed credentials; do not put remote MCP transport or
credentials into a catch-all Code node.
