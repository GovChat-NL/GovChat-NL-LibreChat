# Native LibreChat XLSX Attachment Patch Specification

## Decision context

The existing Excel MVP securely generates an `.xlsx` outside LibreChat and returns a protected URL through the custom OpenAI-compatible endpoint. LibreChat's custom endpoint response protocol treats that response as assistant text; it does **not** convert arbitrary external URLs or a JSON attachment field into a persisted LibreChat file.

LibreChat [`v0.8.7`](../docker-compose.yml) already has a native file-attachment UI and download routing for LibreChat-managed files. Its later releases also document richer Office/XLSX preview improvements, but an upgrade alone does not make a custom n8n endpoint's externally generated file become a native attachment. A bridge/core integration is still required.

This document describes the patch to implement later in a dedicated LibreChat fork or patch-image repository.

## Scope

Create a narrow, auditable **external generated-file registration contract** for the trusted GovChat bridge. It must:

- accept only an internal, authenticated bridge-to-LibreChat request;
- copy a generated file into LibreChat-managed file storage;
- create a native LibreChat [`File`](../excel-artifacts/server.js) record;
- attach the native file reference to the assistant message that produced it;
- emit LibreChat's standard `attachment` SSE event;
- rely on built-in native attachment UI and `/api/files/download/...` owner ACLs;
- never accept browser-provided owner, conversation, file path, or storage metadata.

The patch must not expose a generic public file-import endpoint.

## Proposed components

### 1. Internal registration endpoint

Add `POST /api/internal/generated-files/register` in the LibreChat API server. It is reachable only from Docker's internal network or through a strict Nginx deny rule.

Authenticate using a dedicated `LIBRECHAT_GENERATED_FILES_TOKEN` secret with a constant-time comparison. This secret is separate from `N8N_WEBHOOK_TOKEN`, `JWT_SECRET`, and `EXCEL_INTERNAL_API_TOKEN`.

Accepted input shape:

```json
{
  "requestId": "bridge correlation UUID",
  "ownerUserId": "LibreChat Mongo user ObjectId",
  "conversationId": "LibreChat conversation UUID",
  "assistantMessageId": "LibreChat assistant message UUID",
  "source": {
    "kind": "excel-worker",
    "artifactId": "opaque artifact UUID"
  },
  "filename": "sales_data_mockup.xlsx",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "expectedSha256": "hex digest",
  "rowCount": 10
}
```

Do **not** accept a caller-controlled file system path or arbitrary URL. The handler retrieves the source through a fixed internal service name, for example `http://excel-artifacts-internal:8081/internal/artifacts/<artifactId>`, authenticated with a second service credential. Alternatively, move the source file into a read-only staging volume mounted into the LibreChat patch container.

### 2. Server-side validation and storage

The endpoint must validate:

- owner is an existing LibreChat user;
- conversation exists and belongs to that owner;
- assistant message exists and belongs to the same user/conversation;
- MIME type is the XLSX MIME type only for this feature;
- filename is normalized and ends in `.xlsx`;
- size does not exceed `fileConfig.serverFileSizeLimit`;
- uploaded stream magic bytes start with ZIP `PK` and SHA-256 matches `expectedSha256`;
- the artifact has not expired and is not already imported (`source.kind + artifactId` idempotency key).

Store it using the existing LibreChat local file strategy. Reuse the same strategy abstraction already used by [`/api/files`](../librechat.yaml) so an eventual S3/Azure file strategy remains compatible.

Create a native `File` document with at least:

```js
{
  user: ownerUserId,
  conversationId,
  messageId: assistantMessageId,
  file_id: generatedNativeFileId,
  bytes,
  filename,
  filepath,
  storageKey,
  source: 'local',
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  context: 'message_attachment',
  usage: 0,
  tenantId,
  metadata: {
    generatedBy: 'govchat-excel',
    sourceArtifactId: artifactId,
    sha256: expectedSha256,
    rowCount
  }
}
```

Apply LibreChat's configured retention/TTL policy rather than the Excel worker's independent retention after a successful import. The worker artifact can then be deleted or marked imported.

### 3. Attach to the assistant message and SSE response

The bridge must include a correlation identifier in the custom completion request. LibreChat must retain that identifier while it creates the assistant response message.

After registration, append a safe attachment reference to the exact assistant message:

```js
{
  file_id: generatedNativeFileId,
  filename,
  filepath,
  type: xlsxMimeType,
  source: 'local',
  user: ownerUserId,
  messageId: assistantMessageId,
  conversationId
}
```

Emit the existing SSE event form used by the client attachment handler:

```json
{
  "event": "attachment",
  "data": {
    "file_id": "...",
    "filename": "sales_data_mockup.xlsx",
    "filepath": "...",
    "type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "source": "local",
    "user": "...",
    "messageId": "..."
  }
}
```

The LibreChat client already renders native message attachments with its own `FileAttachment` / file container components. A newer compatible LibreChat version may use richer Office preview components when the attachment has a trusted HTML preview. Do not fabricate `textFormat: 'html'` or spreadsheet HTML in the registration endpoint.

### 4. Bridge changes

Extend the internal n8n OpenAI bridge response schema rather than using Markdown link parsing. Example n8n response to the bridge:

```json
{
  "response": "Excel-bestand gereed.",
  "generatedFile": {
    "artifactId": "opaque UUID",
    "filename": "sales_data_mockup.xlsx",
    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "sha256": "...",
    "rowCount": 10
  }
}
```

The bridge, not the LLM, derives the owner, conversation, and assistant-message correlation data from the authenticated LibreChat request. It calls the internal registration endpoint only after the assistant message exists. It must return the native attachment SSE event to the client.

## Required tests

### Security

- reject missing/invalid bridge credential;
- reject unknown user, conversation, or assistant message;
- reject cross-user conversation/message combinations;
- reject arbitrary URLs, paths, MIME types, hashes, ZIP bombs, and oversized files;
- reject artifact ID replay for a different owner or message;
- verify a different LibreChat user receives `403`/`404` on the native download route;
- verify retention cleans both database record and stored bytes.

### Functional

- native XLSX attachment appears under the same assistant message;
- clicking the native attachment uses LibreChat's built-in download implementation;
- conversation reload retains the attachment;
- shared conversation behavior follows the existing LibreChat share-file policy;
- native UI works for local and OpenID-reuse sessions;
- Office preview is tested separately for the chosen LibreChat version.

## Upgrade guidance

Do not upgrade just to solve registration. Registration is required with any version because custom endpoint text is not automatically converted into a file attachment.

After this patch exists, evaluate a LibreChat upgrade in a separate platform change. The bundled release notes indicate newer releases contain richer native Office/XLSX preview work. Acceptance criteria for an upgrade should include SSO, token reuse, custom endpoint headers, Nginx overlay, n8n bridge, file retention, attachment ACLs, and regression testing of the native XLSX attachment preview.
