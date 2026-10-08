# Provincie Limburg Excel MVP

## Scope

This feature implements two bounded operations for the existing central GovChat n8n orchestrator:

1. `inspect_excel` returns workbook structure only: sheet names, column names, and at most three sample rows per sheet.
2. `generate_styled_excel` creates a styled `.xlsx` table using the Provincie Limburg header color `#002F6C`, bold white header text, borders, a frozen header row, filters, and bounded automatic column widths.

It deliberately excludes formulas, charts, macros, Microsoft 365, and Graph API integrations.

## Components

| Component | Responsibility |
| --- | --- |
| [`excel-worker/app.py`](../excel-worker/app.py) | Private inspection and generation API. Validates only n8n-authenticated calls and creates owner-bound artifact metadata. |
| [`excel-artifacts/server.js`](../excel-artifacts/server.js) | Download authority. Validates LibreChat's signed `refreshToken` against `JWT_REFRESH_SECRET`, verifies artifact owner identity and expiry, then streams the XLSX. |
| [`n8n/workflows/provincie_agent_mvp.json`](../n8n/workflows/provincie_agent_mvp.json) | Importable bounded subworkflow that validates the tool request and calls the worker. |
| [`scripts/patch-orchestrator-excel-tool.js`](../scripts/patch-orchestrator-excel-tool.js) | Patches the central orchestrator export to propagate verified bridge identity and expose the Excel tool. |
| [`nginx/librechat-overlay.conf`](../nginx/librechat-overlay.conf) | Proxies `/api/files/download/<opaque-uuid>` to the authorization service. Files are never statically web-served. |

## Trust boundaries

The LLM may propose only business data:

- operation (`inspect_excel` or `generate_styled_excel`)
- input file content/name for inspection
- display filename, sheet name, headers, and cell values for generation

The workflow must ignore model-provided identity and security data. The orchestrator patch derives `trustedUserId` and `trustedConversationId` only from bridge headers configured in [`librechat.yaml`](../librechat.yaml), and n8n passes these values to the worker. The worker—not the LLM—creates the UUID artifact ID, storage filename, owner metadata, hash, and expiry.

The browser download request is independently authorized by the artifact service. A valid artifact UUID alone is insufficient: the request must include a valid LibreChat `refreshToken` whose owner ID matches the immutable artifact metadata. The originating conversation ID remains immutable metadata for auditing and a later shared-conversation policy, but is not used as a browser authorization factor because LibreChat does not provide an authenticated conversation ID on a file download request. Missing, malformed, expired, unknown, and unauthorized requests all return `404` to prevent enumeration.

## Storage and retention

The named `storage_files` volume has the following internal layout:

```text
/storage/files/<artifact-uuid>.xlsx
/storage/metadata/<artifact-uuid>.json
```

`excel-worker` has read/write access; `excel-artifacts` mounts it read-only. The `EXCEL_ARTIFACT_TTL_HOURS` value controls download expiry. Expired metadata is denied even if a cleanup run has not yet removed the physical file. Add a scheduled volume cleanup job before production deployment to delete expired metadata and files.

## Deployment

1. Copy [`.env.example`](../.env.example) to `.env` as normal.
2. Set `EXCEL_INTERNAL_API_TOKEN` to a unique random secret of at least 32 characters. Do not reuse `N8N_WEBHOOK_TOKEN`.
3. Review the workbook and artifact limits in `.env`:
   - `EXCEL_MAX_UPLOAD_BYTES`
   - `EXCEL_MAX_SHEETS`
   - `EXCEL_MAX_ROWS`
   - `EXCEL_MAX_COLUMNS`
   - `EXCEL_ARTIFACT_TTL_HOURS`
4. Start or recreate the changed services:

```sh
docker compose --env-file .env up -d --build excel-worker excel-artifacts n8n n8n-runners n8n-bootstrap librechat-proxy
```

The bootstrap process imports [`provincie_agent_mvp.json`](../n8n/workflows/provincie_agent_mvp.json), patches the downloaded/local orchestrator export, then imports and publishes the Excel workflow before the patched orchestrator. Set `AGENTS_BOOTSTRAP_FORCE=true` for one deployment when replacing an already seeded workflow set.

## LibreChat behavior

The central `govchat-orchestrator` custom endpoint remains unchanged. The patched orchestrator calls the Excel tool for explicit Excel inspection/generation requests. Generation returns an accessible Markdown download card with filename, row count, creation timestamp, and a clickable protected download route. This uses standard Markdown because a custom OpenAI-compatible endpoint cannot force LibreChat's upstream-native Artifact component without maintaining a LibreChat frontend patch.

## Test cases

Validate at least:

- normal inspection with multiple sheets, columns, and no more than three preview rows
- corrupt, encrypted, oversize, unsupported, and ZIP-bomb-like uploads
- generated workbook header fill/font/borders/filter/frozen row
- missing or invalid service token
- missing/invalid/expired browser refresh token
- owner mismatch and unknown UUID returning indistinguishable `404`
- `Content-Disposition`, XLSX MIME, and no-store response headers

## Deferred work

The existing image route remains unchanged in this branch. Its browser-level Referer/cookie-presence checks should be upgraded later to the same independent authenticated-authorization model.
