# GovChat-NL-Agents

> [!WARNING]
> **Status: niet productierijp / niet gegarandeerd werkend.**
> Deze workflows worden gedeeld als **inspiratie en referentie** voor leveranciers en mede-overheden.
> Niet bedoeld als direct inzetbare productieconfiguratie zonder aanvullende validatie, security checks en beheerafspraken.

## Publicatiedoel

- Voorbeeld van orchestrator-first workflowontwerp.
- Input voor leveranciersdialoog en gezamenlijke doorontwikkeling.
- Transparantie over ontwerpkeuzes, niet over gegarandeerde productiegeschiktheid.

Centrale repository voor GovChat-NL n8n-agentworkflows.

## Scope

- **Orchestrator-first architectuur**: alle eindgebruikersverzoeken lopen via de orchestrator-agent.
- **Sub-agents als tools**: specialistische agents (zoals B1 Versimpelaar) worden door de orchestrator aangeroepen wanneer nodig.
- Workflow-JSON-bestanden voor bootstrap-import in de LibreChat-stack.

## Repositorystructuur

```text
n8n/
  workflows/
    orchestrator-litellm.json
    versimpelaar-litellm.json
```

## Runtime-integratie

`GovChat-NL-LibreChat` importeert workflows bij opstart via GitHub Raw URLs:

- Env var `AGENTS_RAW_BASE_URL`: basis-URL (default: `https://raw.githubusercontent.com/GovChat-NL/GovChat-NL-Agents/main/n8n/workflows`)
- Env var `AGENTS_WORKFLOW_FILES`: bestandenlijst (default: `versimpelaar-litellm.json,orchestrator-litellm.json`)

Hierdoor kan de LibreChat-stack starten **zonder** lokale clone van deze repository.

Deze variabelen configureer je in [`GovChat-NL-LibreChat/.env`](../GovChat-NL-LibreChat/.env.example:49) en ze worden gebruikt door [`n8n-bootstrap`](../GovChat-NL-LibreChat/docker-compose.yml:415).

## Hoe de orchestrator-keten werkt

De standaard chatroute loopt als volgt:

1. LibreChat stuurt OpenAI-compatibele requests naar de bridge (`/v1/chat/completions`).
2. De bridge routeert model `govchat-orchestrator` naar n8n webhook `POST /webhook/orchestrator`.
3. De orchestrator-workflow verwerkt de volledige `messages`-geschiedenis als context.
4. De orchestrator beslist of een sub-agent nodig is (bijv. B1-versimpelaar via tool-call).
5. Het antwoord stroomt terug naar LibreChat (streaming) via dezelfde webhookrespons.

Belangrijke details:

- **Webhook**: entrypoint is de orchestrator-webhook, niet direct een sub-agent.
- **Streaming**: de orchestrator-webhook staat op streaming; tokens gaan direct terug naar de client.
- **Sub-agents**: worden alleen intern door de orchestrator aangeroepen als tool.

## Koppeling met LiteLLM

In beide workflows (orchestrator + sub-agents) gebruikt de `OpenAI Chat Model` node:

- Base URL: `${LITELLM_URL}/v1`
- API key: `${LITELLM_API_KEY}`

LiteLLM verzorgt vervolgens modelrouting/providerkoppeling (bijv. OpenAI/Azure/Open-source backend) zonder dat de workflow zelf hoeft te veranderen.

Als je de compose-opzet van [`GovChat-NL-LibreChat/docker-compose.yml`](../GovChat-NL-LibreChat/docker-compose.yml:394) volgt, wordt de n8n credential voor LiteLLM automatisch aangemaakt door `n8n-bootstrap` (credentialnaam: `LiteLLM API`) en daarna aan de geïmporteerde workflows gekoppeld.

## Naamconventie voor workflows

- `<doel>-litellm.json`
- Houd workflow-`id` stabiel na publicatie.
- Gebruik duidelijke namen voor orchestrator versus sub-agents.

### Wat betekent workflow-`id`?

De workflow-`id` is de technische, unieke sleutel waarmee n8n een workflow herkent bij import/publicatie.

- Als je dezelfde `id` behoudt, werkt import als update van bestaande workflow.
- Als je `id` onbedoeld wijzigt, ontstaat vaak een tweede workflow (duplicaat) met mogelijk andere webhook/publicatie-status.

Kort: wijzig de `id` alleen bewust als je echt een nieuwe workflow naast de oude wilt introduceren.

## Bijdragen

Zie [`CONTRIBUTING.md`](CONTRIBUTING.md).

