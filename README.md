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
   - `N8N_ENABLE_IMAGE_TOOL` (`true`/`false`, default `false`)
   - `N8N_LITELLM_IMAGE_BASE_URL` (default `${LITELLM_URL}`)
   - `N8N_LITELLM_IMAGE_API_KEY` (default `${LITELLM_API_KEY}`)
   - `N8N_LITELLM_IMAGE_MODEL` (default `gpt-image-1`)
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

## Troubleshooting: `admin-panel` pull faalt met GHCR 403

Zie je een fout zoals `failed to fetch oauth token ... 403 Forbidden` voor `ghcr.io/clickhouse/librechat-admin-panel`?

Dit gebeurt vaak als Docker nog oude/onjuiste GHCR-credentials heeft opgeslagen. Docker probeert dan **geauthenticeerd** te pullen met een token zonder package-leesrechten, en GHCR weigert de aanvraag.

Snelle fix:

```bash
docker logout ghcr.io
docker compose -f docker-compose.yml --env-file .env pull admin-panel
docker compose -f docker-compose.yml --env-file .env up -d
```

Verwachte uitkomst:

- `docker logout ghcr.io` meldt `Removing login credentials for ghcr.io`
- `pull admin-panel` downloadt de image zonder 403
- `docker compose ... up -d` start `admin-panel` normaal mee

Alleen als jouw organisatie bewust private GHCR-packages gebruikt: log opnieuw in met een token dat package-read rechten heeft.

## LibreChat standaard koppeling via n8n-openai-bridge

De versimpelaar-URL staat standaard op [`/n8n/webhook/versimpelaar`](overlay/defaults/apps.json) en wordt geproxied naar interne n8n.

De **standaard chat** is gekoppeld via [`librechat.yaml`](librechat.yaml) aan [`n8n-openai-bridge/models.json`](n8n-openai-bridge/models.json):

- custom endpoint `govchat-orchestrator`
- LibreChat -> `http://n8n-openai-bridge:3333/v1`
- bridge model `govchat-orchestrator` -> `http://n8n:5678/webhook/orchestrator`
- bridge-authenticatie via `${N8N_OPENAI_BRIDGE_BEARER_TOKEN}`

### Context/token usage indicator (default uit)

In deze stack staat de LibreChat context/token-indicator standaard uit in [`librechat.yaml`](librechat.yaml):

```yaml
interface:
  contextUsage: false
  contextCost: false
```

Reden: de chatflow loopt via n8n-orchestratie en toolcalls. Daardoor kan de UI-indicator afwijken van de werkelijke end-to-end tokenconsumptie.

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
   - [`orchestrator-litellm.json`](../GovChat-NL-Agents/n8n/workflows/orchestrator-litellm.json)
   - [`versimpelaar-litellm.json`](../GovChat-NL-Agents/n8n/workflows/versimpelaar-litellm.json)
3. Kies het gewenste model in `OpenAI Chat Model` node.
4. Publish workflow opnieuw in n8n.
5. Verifieer dat het model zichtbaar is op `${LITELLM_URL}/v1/models`.

## Afbeeldingen via orchestrator (optioneel, centraal configureerbaar)

De orchestrator kan optioneel een image-tool gebruiken die via LiteLLM naar `/v1/images/generations` gaat.

### Configuratie in [`.env`](.env)

- `N8N_ENABLE_IMAGE_TOOL=false`
  - `false`: feature staat uit; workflow geeft een nette niet-fatale melding terug.
  - `true`: feature staat aan en gebruikt de hieronder genoemde image settings.
- `N8N_LITELLM_IMAGE_BASE_URL`
  - apart image-endpoint (fallback: `LITELLM_URL`)
- `N8N_LITELLM_IMAGE_API_KEY`
  - aparte image-sleutel (fallback: `LITELLM_API_KEY`)
- `N8N_LITELLM_IMAGE_MODEL`
  - image-model (default: `gpt-image-1`)

Deze waarden worden via compose doorgegeven aan zowel [`n8n`](docker-compose.yml:382) als [`n8n-runners`](docker-compose.yml:461).

### Runtime vereisten voor image generation

1. **JS runner modules toegestaan**
   - [`n8n/task-runners.json`](n8n/task-runners.json) zet `NODE_FUNCTION_ALLOW_BUILTIN` op `fs,path,crypto`.
   - Deze file is gemount in [`n8n-runners`](docker-compose.yml:483).

2. **Gedeelde image map beschikbaar**
   - [`/opt/librechat/images:/shared-images`](docker-compose.yml:484) wordt gebruikt om gegenereerde PNG-bestanden op te slaan.
   - Bij Linux host-permissieproblemen (`EACCES`) moet de map schrijfbaar zijn voor runner user (uid/gid `1000`).

3. **Publieke URL opbouw**
   - workflow gebruikt `PUBLIC_BASE_URL` om `/images/<bestand>.png` links te genereren.

### Gedrag bij output

- Bij normale URL-output van model: workflow retourneert direct markdown `![gegenereerde afbeelding](...)`.
- Bij base64-output: workflow schrijft PNG naar `/shared-images` en retourneert ook markdown URL.
- Hierdoor kan LibreChat de afbeelding inline renderen in plaats van alleen tekst te tonen.

### Asynchrone image-jobs met tussentijdse status (aanbevolen)

Voor nette voortgangsfeedback zonder lange spinner ondersteunt deze stack nu een asynchrone route via `govchat-overlay-admin`:

- `POST /govchat-api/image-jobs` → start job (antwoord: `202` + `job_id`)
- `GET /govchat-api/image-jobs/:job_id` → poll status (`queued`/`running`/`succeeded`/`failed`)

De worker in `govchat-overlay-admin` roept intern de bestaande n8n image-webhook aan (`/webhook/image-generator`) en bewaart jobstatus in `/opt/librechat/overlay/data/image-jobs`.

#### Benodigde `.env` variabelen

- `IMAGE_JOBS_ENABLED=true`
- `IMAGE_JOBS_TOKEN=<sterk random token>`
- `IMAGE_JOBS_WEBHOOK_URL=http://n8n:5678/webhook/image-generator`
- `IMAGE_JOBS_WEBHOOK_TOKEN=<n8n webhook token>` (fallback op `N8N_WEBHOOK_TOKEN`)
- `IMAGE_JOBS_CONCURRENCY=1`
- `IMAGE_JOBS_TTL_HOURS=24`

#### Overlay app-configuratie

In [`overlay/defaults/apps.json`](overlay/defaults/apps.json) staat standaard een app `Afbeelding generator` met:

- `target: "imagegen"`
- `url: "/govchat-api/image-jobs"`
- `config.image_jobs_api` en `config.image_jobs_token`

De loader toont tijdens polling statusberichten in het Nederlands, zoals:

- “Je afbeelding staat in de wachtrij.”
- “Je afbeelding wordt nu gegenereerd.”
- “Je afbeelding is klaar.”

### Chat image-statusmeldingen configureerbaar via Admin (apps.json)

De inline statusmeldingen in de chat zijn configureerbaar via `apps.json` (en dus via de Apps-editor in GovChat Admin):

```json
{
  "chat_image_status": {
    "enabled": true,
    "first_message": "Afbeelding wordt gegenereerd. Dit duurt meestal 10–40 seconden.",
    "second_message": "Nog bezig met genereren. De afbeelding verschijnt hier zodra deze klaar is.",
    "second_delay_ms": 40000
  }
}
```

Notities:

- `enabled=false` schakelt deze chat-statusmeldingen uit.
- `second_delay_ms` wordt server-side begrensd op 5000–300000 ms.
- Bij render van de afbeelding verdwijnt de statusmelding automatisch.

## Overheidscrawler (allowlist + robots.txt) via GovChat Admin + n8n

> ⚠️ **Let op (experimenteel):** de webcrawler is op dit moment een **experimentele feature** en nog **ver van af / niet af** voor volledige productie-inzet. De eerste stappen zijn gezet (beheer, runs, historisch overzicht, basis-optimalisaties), maar verdere doorontwikkeling en hardening zijn nog nodig.

Deze stack ondersteunt nu een beheersbare overheidscrawler met:

- bron-allowlist per domein/pad,
- robots.txt-respect,
- handmatige runs vanuit GovChat Admin,
- automatische schedule-runs in n8n,
- run-auditlog in GovChat Admin.

### UI in GovChat Admin

In `govchat-overlay-admin` is een nieuwe pagina beschikbaar:

- `/crawler-editor`

Daar beheer je:

- globale crawlerinstellingen (interval, max pagina's, timeout, user-agent),
- `respect_robots_txt`,
- embedding-instellingen (aan/uit, model alias, max chars),
- allowlist-bronnen (`start_url`, `allowed_domains`, `allowed_path_prefixes`, sitemaps),
- handmatige start van een crawl-run,
- laatste run-overzicht (visited/blocked/errors).

Daarnaast zie je nu:

- geïndexeerde pagina's met timestamp, subwebsite en pad (laatste run),
- tokengebruik per domein,
- tokengebruik per subwebsite.

> Tokengebruik is best-effort: als LiteLLM embedding usage teruggeeft wordt die gebruikt; anders gebruikt de crawler een schatting (`chars/4`).

### Nieuwe workflow

Bootstrap importeert/publisht nu ook:

- [`../GovChat-NL-Agents/n8n/workflows/govcrawler-run.json`](../GovChat-NL-Agents/n8n/workflows/govcrawler-run.json)

Deze workflow heeft:

- `Webhook /webhook/govcrawler-run` (voor handmatige run vanuit admin),
- `Schedule Trigger` (15-min basis; intern skip als crawler disabled of geen actieve bronnen),
- allowlist-validatie,
- robots.txt-check per bron,
- crawl-run metrics,
- run-persist naar GovChat Admin interne API.

### Benodigde `.env` variabelen

Toegevoegd in [`.env.example`](.env.example):

- `AZURE_OPENAI_API_BASE`
- `AZURE_OPENAI_API_VERSION` (default `2023-05-15`)
- `AZURE_OPENAI_API_KEY`
- `CRAWLER_ADMIN_BASE_URL` (default `http://govchat-overlay-admin:3002`)
- `CRAWLER_INTERNAL_TOKEN` (interne auth tussen n8n en overlay-admin)
- `CRAWLER_N8N_WEBHOOK_URL` (default `http://n8n:5678/webhook/govcrawler-run`)
- `CRAWLER_N8N_WEBHOOK_TOKEN` (token voor webhook-calls naar n8n)
- `CRAWLER_RUNS_LIMIT` (max aantal bewaarde runs)
- `CRAWLER_EMBEDDING_MODEL` (default `govchat-embedding`)

LiteLLM bevat embedding alias in [`litellm/config.yaml`](litellm/config.yaml):

- `govchat-embedding` -> `azure/text-embedding-3-large`

Voor jullie Azure endpoint in `.env`:

- `AZURE_OPENAI_API_BASE=https://librechat-construction-foundry.cognitiveservices.azure.com`
- `AZURE_OPENAI_API_VERSION=2023-05-15`
- `AZURE_OPENAI_API_KEY=<jullie key>`

De crawler gebruikt vervolgens altijd LiteLLM (`${LITELLM_URL}/v1/embeddings`).

Aanbeveling:

- zet `CRAWLER_INTERNAL_TOKEN` en `CRAWLER_N8N_WEBHOOK_TOKEN` expliciet op sterke random values,
- gebruik niet overal dezelfde token in productie.

### Bootstrap gedrag

`n8n-bootstrap` gebruikt marker `.govchat-seeded-v5` en importeert de crawler-workflow mee.

Als `AGENTS_WORKFLOW_SOURCE=github` staat en een workflow nog niet in de remote repo staat, valt bootstrap automatisch terug op de lokale Agents-map [`../GovChat-NL-Agents/n8n/workflows`](../GovChat-NL-Agents/n8n/workflows).

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

Bij opstart importeert [`n8n-bootstrap`](docker-compose.yml:394) automatisch workflows uit de aparte agents-repo via GitHub Raw URLs (geen lokale clone nodig).

Configuratie in [`.env.example`](.env.example):

- `AGENTS_WORKFLOW_SOURCE` (`github` of `local`)
- `AGENTS_RAW_BASE_URL` (default: `https://raw.githubusercontent.com/GovChat-NL/GovChat-NL-Agents/main/n8n/workflows`)
- `AGENTS_WORKFLOW_FILES` (default: `versimpelaar-litellm.json,orchestrator-litellm.json,image-generator-litellm.json,transcriptie-litellm.json,transcriptie-title-litellm.json,govcrawler-run.json`)
- `AGENTS_LOCAL_WORKFLOWS_DIR` (default: `/workspace/GovChat-NL-Agents/n8n/workflows`)
- `AGENTS_BOOTSTRAP_FORCE` (`false` standaard; zet op `true` om import/publish geforceerd opnieuw uit te voeren)
- `N8N_OWNER_EMAIL` (optioneel; als gezet wordt owner automatisch geprovisioned)
- `N8N_OWNER_PASSWORD` (optioneel; samen met `N8N_OWNER_EMAIL`)
- `N8N_OWNER_FIRST_NAME` (default: `GovChat`)
- `N8N_OWNER_LAST_NAME` (default: `Admin`)

### n8n admin-user deterministisch provisionen (aanbevolen)

De service `n8n-bootstrap` kan de n8n owner automatisch aanmaken op basis van [`.env`](.env):

- `N8N_OWNER_EMAIL`
- `N8N_OWNER_PASSWORD`
- optioneel `N8N_OWNER_FIRST_NAME` en `N8N_OWNER_LAST_NAME`

Gedrag:

- Als er nog geen owner is, maakt bootstrap de owner aan via de n8n setup-API.
- Als er al een owner bestaat, wordt de setup overgeslagen (idempotent).

Forceer een nieuwe bootstrap-run met:

```bash
docker compose -f docker-compose.yml --env-file .env up -d --force-recreate n8n-bootstrap
```

Bronkeuze:

- `AGENTS_WORKFLOW_SOURCE=github`: bootstrap downloadt workflows vanaf `AGENTS_RAW_BASE_URL`.
- `AGENTS_WORKFLOW_SOURCE=local`: bootstrap leest workflows direct uit de gemounte lokale agents-repo (`AGENTS_LOCAL_WORKFLOWS_DIR`).

Voor lokaal testen van on-gepushte workflow-wijzigingen zet je dus `AGENTS_WORKFLOW_SOURCE=local` in [`.env`](.env).

Stabiliteit in productie/lokaal:

- Standaard (`AGENTS_BOOTSTRAP_FORCE=false`) slaat bootstrap import/publish over na de eerste succesvolle seed.
- Hiermee voorkom je dat workflows bij elke herstart onnodig gedeactiveerd/geherpubliceerd worden terwijl verkeer al loopt.
- Alleen bij echte workflow-wijzigingen tijdelijk `AGENTS_BOOTSTRAP_FORCE=true` zetten, daarna terug naar `false`.

Standaard workflow-bronnen:

- [`orchestrator-litellm.json`](../GovChat-NL-Agents/n8n/workflows/orchestrator-litellm.json)
- [`versimpelaar-litellm.json`](../GovChat-NL-Agents/n8n/workflows/versimpelaar-litellm.json)
- [`image-generator-litellm.json`](../GovChat-NL-Agents/n8n/workflows/image-generator-litellm.json)

Bootstrap-flow:

1. Downloadt elk bestand uit `AGENTS_WORKFLOW_FILES` vanaf `AGENTS_RAW_BASE_URL`.
2. Importeert workflows in n8n met `n8n import:workflow`.
3. Publiceert workflows met vaste IDs (`govchat-orchestrator-litellm`, `govchat-versimpelaar-b1-litellm`).

Architectuurafspraak:

- Alle eindgebruikersverkeer loopt via de orchestrator-agent.
- Sub-agents (zoals Versimpelaar B1) worden door de orchestrator als tool aangeroepen.

Daarnaast bootstrap't [`n8n-bootstrap`](docker-compose.yml:394) automatisch een n8n credential:

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
1. Valideert `x-govchat-token` en payload (`text/prompt/input` of OpenAI `messages`)
2. Gebruikt een n8n [`AI Agent`](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/)
3. Agent is gekoppeld aan [`OpenAI Chat Model`](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatopenai/) met Base URL `${LITELLM_URL}/v1`
4. Agent heeft een sub-tool (`Call n8n Workflow Tool`) voor B1-versimpeling via `/webhook/versimpelaar`
5. Agent beslist autonoom wanneer deze B1-tool wordt gebruikt
6. `Prepare Input` gebruikt de volledige chatgeschiedenis uit `messages` (rollen + content) als context, in plaats van alleen de laatste user-vraag
7. Streaming loopt direct via de webhook (`responseMode: streaming` + agent `enableStreaming: true`); een expliciete terugkoppeling van `AI Agent` naar `Webhook` is niet nodig

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
