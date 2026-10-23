# Live tool-calling integration boundary

## Request and model route

```text
LibreChat → OpenAI-compatible n8n bridge → n8n orchestrator webhook
                                              └→ n8n agent/workflow tools
                                                 └→ LiteLLM directly
streamed webhook response ← bridge ← n8n
```

LibreChat calls the bridge at `http://n8n-openai-bridge:3333/v1`; [`../bridge/models.json`](../bridge/models.json) maps `govchat-orchestrator` to `http://n8n:5678/webhook/orchestrator`. n8n calls LiteLLM directly for model requests: LiteLLM traffic does not pass through the bridge. The bridge remains an independent OpenAI-compatible service/repository and is pinned by OCI digest in the root Compose file.

The architecture's live tool-calling contract is for the n8n webhook stream to return tool lifecycle events through the bridge to LibreChat so the UI can render **native LibreChat tool cards** (start, arguments, result/error). Do not change this to a direct model/proxy path or emit tool lifecycle logs as assistant text.

## Current branch status

This document describes the preserved integration boundary, not a claim that live cards are enabled in the current `feature/monorepo-migration` branch. The current LibreChat stack branch does not contain the runtime event preloader/overlay or n8n streaming runtime patches required to decode and dispatch sideband lifecycle events. The separate `feature/live-tool-calling` branch is intentionally out of scope for this consolidation and remains unmerged/unchanged; review and merge that feature separately when selected.

Until that implementation is merged and validated, verify actual tool-call rendering against the pinned LibreChat image and the separately released bridge before advertising native live cards as available. Keep the request/model route above unchanged when the feature is integrated. See [`monorepo-migration.md`](monorepo-migration.md#bridge-pin-and-compatibility-record) for the bridge artifact/source limitation and current verification status.

## Component responsibilities

- [`../librechat.yaml`](../librechat.yaml): custom OpenAI-compatible endpoint and bridge URL.
- [`../bridge/models.json`](../bridge/models.json): deployment-level bridge model-to-webhook routing; not bridge source code.
- [`../agents/n8n/workflows/orchestrator-litellm.json`](../agents/n8n/workflows/orchestrator-litellm.json): orchestrator workflow, which calls LiteLLM and may use specialist workflows as tools.
- [GovChat-NL/n8n-openai-bridge](https://github.com/GovChat-NL/n8n-openai-bridge): independent bridge implementation and release/tests.
- [`../docker-compose.bridge-dev.yml`](../docker-compose.bridge-dev.yml): optional local source build from an external sibling checkout; not needed in standard deployment.
