# GovChat-NL-LibreChat

Deze variant houdt het bewust simpel:

- OpenWebUI is vervangen door LibreChat
- GovChat overlay blijft actief (help + app launcher)
- n8n is inbegrepen voor een Orchestrator-agent + Versimpelaar B1 sub-agent (via LiteLLM)
- RAG/pgvector/pgadmin zijn optioneel via compose-profielen

## Services in de standaard (simpele) start

Standaard actief met `docker compose up -d`:

- `librechat`
- `librechat-proxy` (injecteert overlay in HTML)
- `admin-panel` (LibreChat admin panel op `${ADMIN_PANEL_PORT:-3100}`)
- `n8n-openai-bridge` (OpenAI-compatibele bridge tussen LibreChat en n8n)
- `mongodb`
- `redis`
- `meilisearch`
- `govchat-overlay-admin`
- `n8n-postgres`
- `n8n`
- `n8n-bootstrap` (eenmalige workflow-import)

> n8n versie is gepind via `N8N_VERSION` (default: `2.25.7`).

Niet standaard actief:

- `pgvector` (profiel: `rag` of `admin`)
- `rag-api` (profiel: `rag`)
- `pgadmin` (profiel: `admin`)

## Waarom `pgvector`, `rag-api`, `pgadmin`?

- [`pgvector`](docker-compose.yml:217): PostgreSQL + vector-extensie voor RAG-indexen.
- [`rag-api`](docker-compose.yml:244): ingest/retrieval service voor document-RAG.
- [`pgadmin`](docker-compose.yml:332): beheertool voor pgvector DB.

Als je nu **geen RAG** nodig hebt, hoef je deze services niet te starten.

## Lokaal draaien (simpel)

1. Kopieer [`.env.example`](.env.example) naar [`.env`](.env).
2. Vul minimaal in [`.env`](.env):
   - `LC_PORT`
   - `APP_TITLE`
   - `PUBLIC_BASE_URL`
   - `ADMIN_PANEL_PUBLIC_URL`
   - `LITELLM_URL`
   - `LITELLM_API_KEY`
   - `OPENAI_API_KEY`
   - `LITELLM_CONFIG_PATH` (default: `./litellm/config.yaml`)
   - `N8N_OPENAI_BRIDGE_BEARER_TOKEN`
   - `GOVCHAT_ADMIN_PASSWORD`
   - `N8N_POSTGRES_PASSWORD`
   - `N8N_ENCRYPTION_KEY`
   - `N8N_WEBHOOK_TOKEN`
   - DB/secrets (`MONGO_ROOT_PASS`, `MEILI_MASTER_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`, `CREDS_KEY`, `CREDS_IV`)
3. Zorg dat hostmappen uit [`docker-compose.yml`](docker-compose.yml:9) bestaan.
4. Standaard wordt [`librechat.yaml`](librechat.yaml) uit de repo gemount. Overschrijven kan met `LIBRECHAT_CONFIG_PATH` in [`.env`](.env).
5. LiteLLM config-file route staat standaard aan via [`litellm/config.yaml`](litellm/config.yaml) en mount in [`docker-compose.yml`](docker-compose.yml:259).
6. Start:

```bash
docker compose -f docker-compose.yml --env-file .env up -d
```

## Optioneel: RAG later inschakelen

Met RAG services:

```bash
docker compose -f docker-compose.yml --env-file .env --profile rag up -d
```

Met pgAdmin:

```bash
docker compose -f docker-compose.yml --env-file .env --profile admin up -d
```

LibreChat admin-panel start automatisch mee in de standaard `docker compose up -d`.

## LibreChat standaard koppeling via n8n-openai-bridge

De versimpelaar-URL staat standaard op [`/n8n/webhook/versimpelaar`](overlay/defaults/apps.json) en wordt geproxied naar interne n8n.

De **standaard chat** is gekoppeld via [`librechat.yaml`](librechat.yaml) aan [`n8n-openai-bridge/models.json`](n8n-openai-bridge/models.json):

- custom endpoint `govchat-orchestrator`
- LibreChat -> `http://n8n-openai-bridge:3333/v1`
- bridge model `govchat-orchestrator` -> `http://n8n:5678/webhook/orchestrator`
- bridge-authenticatie via `${N8N_OPENAI_BRIDGE_BEARER_TOKEN}`

## Taalmodellen beheren: twee routes

### Route A (aanbevolen): via LiteLLM config file (Git-managed)

Deze route is nu geïmplementeerd en actief in compose:

- Config file: [`litellm/config.yaml`](litellm/config.yaml)
- Mount + startup flag: [`litellm` service in `docker-compose.yml`](docker-compose.yml:240)
- Env variabele: `LITELLM_CONFIG_PATH` in [`.env.example`](.env.example)

Werkwijze:
1. Voeg/werk modellen bij in [`litellm/config.yaml`](litellm/config.yaml) onder `model_list`.
2. Zorg dat provider-sleutels in [`.env`](.env) staan (bijv. `OPENAI_API_KEY`).
3. Herstart LiteLLM:

```bash
docker compose -f docker-compose.yml --env-file .env up -d litellm
```

4. Controleer modellen:

```bash
curl ${LITELLM_URL}/v1/models
```

5. Selecteer het model in n8n in de `OpenAI Chat Model` node(s) en publish de workflow opnieuw.

### Route B: via LiteLLM UI + n8n workflow update

Werkwijze:
1. Voeg model toe in LiteLLM UI (admin).
2. Open n8n workflow(s):
   - [`orchestrator-litellm.json`](n8n/bootstrap/workflows/orchestrator-litellm.json)
   - [`versimpelaar-litellm.json`](n8n/bootstrap/workflows/versimpelaar-litellm.json)
3. Kies het gewenste model in `OpenAI Chat Model` node.
4. Publish workflow opnieuw in n8n.
5. Verifieer dat het model zichtbaar is op `${LITELLM_URL}/v1/models`.

## n8n beveiliging (from-scratch baseline)

- n8n is **niet publiek geëxposed** (alleen intern netwerk).
- Alleen [`/n8n/webhook/*`](nginx/librechat-overlay.conf) wordt via proxy doorgelaten.
- Overige [`/n8n/*`](nginx/librechat-overlay.conf) routes geven 404 (editor/API niet publiek).
- Webhook vereist `x-govchat-token` header, gecontroleerd in workflow.
- n8n draait met external task runners (sidecar) volgens n8n production guidance.
- Voor Code-nodes met `$env.*` is `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` gezet (vereist voor deze workflow in runner-mode).
- n8n secrets staan in [`.env.example`](.env.example):
  - `N8N_ENCRYPTION_KEY`
  - `N8N_WEBHOOK_TOKEN`
  - `N8N_RUNNERS_AUTH_TOKEN`

## Standaard n8n workflows

Bij eerste opstart importeert [`n8n-bootstrap`](docker-compose.yml) automatisch deze workflows:

- [`n8n/bootstrap/workflows/versimpelaar-litellm.json`](n8n/bootstrap/workflows/versimpelaar-litellm.json)
- [`n8n/bootstrap/workflows/orchestrator-litellm.json`](n8n/bootstrap/workflows/orchestrator-litellm.json)

Daarnaast bootstrap't [`n8n-bootstrap`](docker-compose.yml) automatisch een n8n credential:

- `openAiApi` met naam `LiteLLM API`
- `apiKey` = `${LITELLM_API_KEY}`
- `url` = `${LITELLM_URL}/v1`

Let op: de eerste LiteLLM start kan langer duren door database-migraties. Daarom is de healthcheck-venster in compose verruimd.

Hierdoor zijn de OpenAI Chat Model nodes in beide workflows direct gekoppeld aan deze credential.

### 1) Versimpelaar B1 sub-agent

Webhook: `POST /n8n/webhook/versimpelaar`

Flow:
1. Valideert `x-govchat-token` en payload (`text`, `preserved_words`)
2. Gebruikt een n8n [`AI Agent`](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/)
3. Agent is gekoppeld aan [`OpenAI Chat Model`](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatopenai/) met Base URL `${LITELLM_URL}/v1`
4. B1-gedrag wordt afgedwongen via system prompt van de agent
4. Retourneert vereenvoudigde tekst als JSON `{ "text": "..." }`

### 2) Orchestrator-agent

Webhook: `POST /n8n/webhook/orchestrator`

Flow:
1. Valideert `x-govchat-token` en payload (`text`, optioneel `task`)
2. Gebruikt een n8n [`AI Agent`](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/)
3. Agent is gekoppeld aan [`OpenAI Chat Model`](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatopenai/) met Base URL `${LITELLM_URL}/v1`
4. Agent heeft een sub-tool (`Call n8n Workflow Tool`) voor B1-versimpeling via `/webhook/versimpelaar`
5. Agent beslist autonoom wanneer deze B1-tool wordt gebruikt
6. Retourneert OpenAI-compatibele `chat.completion` JSON voor LibreChat custom endpoint gebruik

Authenticatie is standaard al voorgeselecteerd via de gebootstrapte `LiteLLM API` credential.

Controleer beschikbare modellen via `${LITELLM_URL}/v1/models`.

## Publish-readiness checklist

Minimale checks vóór publicatie:

1. Compose valideert zonder fouten:

```bash
docker compose -f docker-compose.yml --env-file .env config
```

2. Core services zijn healthy/up (`librechat`, `litellm`, `n8n`, `n8n-openai-bridge`).
3. Bridge endpoint reageert:

```bash
docker compose -f docker-compose.yml --env-file .env exec n8n-openai-bridge wget -qO- http://localhost:3333/health
```

4. Bridge modellen endpoint bevat `govchat-orchestrator`:

```bash
docker compose -f docker-compose.yml --env-file .env exec n8n-openai-bridge wget -qO- http://localhost:3333/v1/models
```

5. LiteLLM modellen endpoint toont verwachte modellen:

```bash
curl ${LITELLM_URL}/v1/models
```
