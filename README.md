# GovChat-NL-LibreChat

Deze variant houdt het bewust simpel:

- OpenWebUI is vervangen door LibreChat
- GovChat overlay blijft actief (help + app launcher)
- Geen n8n-container in deze compose
- RAG/pgvector/pgadmin zijn optioneel via compose-profielen

## Services in de standaard (simpele) start

Standaard actief met `docker compose up -d`:

- `librechat`
- `librechat-proxy` (injecteert overlay in HTML)
- `mongodb`
- `redis`
- `meilisearch`
- `govchat-overlay-admin`

Niet standaard actief:

- `pgvector` (profiel: `rag` of `admin`)
- `rag-api` (profiel: `rag`)
- `pgadmin` (profiel: `admin`)
- `admin-panel` (profiel: `adminpanel`)

## Waarom `pgvector`, `rag-api`, `pgadmin`?

- [`pgvector`](docker-compose.yml:217): PostgreSQL + vector-extensie voor RAG-indexen.
- [`rag-api`](docker-compose.yml:244): ingest/retrieval service voor document-RAG.
- [`pgadmin`](docker-compose.yml:332): beheertool voor pgvector DB.

Als je nu **geen RAG** nodig hebt, hoef je deze services niet te starten.

## Lokaal draaien (simpel)

1. Kopieer [`.env.example`](.env.example) naar `.env`.
2. Vul minimaal:
   - `LC_PORT`
   - `APP_TITLE`
   - `PUBLIC_BASE_URL`
   - `ADMIN_PANEL_PUBLIC_URL`
   - `LITELLM_URL`
   - `LITELLM_API_KEY`
   - `GOVCHAT_ADMIN_PASSWORD`
   - DB/secrets (`MONGO_ROOT_PASS`, `MEILI_MASTER_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`, `CREDS_KEY`, `CREDS_IV`)
3. Zorg dat hostmappen uit [compose](docker-compose.yml:9) bestaan.
4. Start:

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

Met LibreChat admin-panel:

```bash
docker compose -f docker-compose.yml --env-file .env --profile adminpanel up -d
```

## Overlay-instellingen zonder n8n-params in compose

De versimpelaar-URL wordt beheerd in [overlay defaults apps](overlay/defaults/apps.json) (of via overlay admin UI), niet via compose env variabelen.
