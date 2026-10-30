# Agent-workflows

> [!WARNING]
> **Status: niet productierijp / niet gegarandeerd werkend.** Dit zijn referentieworkflows die aanvullende validatie, security review en beheerafspraken vereisen.

Deze directory is de monorepo-bron van waarheid voor GovChat-NL n8n-workflows. De historie van de voormalige `GovChat-NL-Agents` repository is opgenomen via Git subtree; wijzigingen worden voortaan hier beheerd en mee gereviewd met de deployment/runtime waarvoor ze bedoeld zijn.

## Integratie

- Workflows: [`n8n/workflows/`](n8n/workflows/).
- Compose mount de directory read-only op `/workspace/agents`; `n8n-bootstrap` importeert uit `/workspace/agents/n8n/workflows`.
- Bootstrap scant alle top-level `.json`-bestanden in deze map, valideert JSON en stabiele IDs, en importeert/publiceert ze; er is geen handmatige lijst of sibling-checkout nodig.
- De bootstrap maakt de `LiteLLM API` credential aan. Workflows gebruiken `${LITELLM_URL}/v1` en `${LITELLM_API_KEY}`.

De OpenBesluitvorming-exports staan direct in `n8n/workflows/` zodat ze door dezelfde bootstrap worden ontdekt. De snapshot-ingest en delta-sync gebruiken de interne Compose-service `qdrant`; configureer de workflow-nodes voor de gewenste bron en collectie voordat ingest of sync wordt geactiveerd. Raadpleeg [`../docs/openbesluitvorming-release-artifacts.md`](../docs/openbesluitvorming-release-artifacts.md) voor release- en herstelprocedures.

## Gekoppelde systemen

GovChat kan bronnen en diensten via eigen workflows of tools ontsluiten. De koppeling maakt GovChat niet tot het bronsysteem: actuele gegevens, formele registraties en officiële indieningen blijven bij de betreffende dienst.

| Systeem | Doel en gebruik in GovChat | Documentatie |
| --- | --- | --- |
| **OpenBesluitvorming** | Openbare informatie over besluiten wordt doorzoekbaar gemaakt via de OpenBesluitvorming-workflows en Qdrant. De huidige starterdataset richt zich op `provincie_limburg`; verversen en publiceren zijn expliciete beheerprocessen. | [`../docs/openbesluitvorming-release-artifacts.md`](../docs/openbesluitvorming-release-artifacts.md) |
| **JEMS (NWE Joint Electronic Monitoring System)** | JEMS is de online monitoringomgeving van het Interreg North-West Europe-programma voor de projectcyclus. Aanvragers gebruiken het voor projectaanvragen; na goedkeuring wordt het gebruikt voor inhoudelijke en financiële voortgangsrapportage. Controllers beoordelen de subsidiabiliteit van uitgaven en het NWE Joint Secretariat volgt projecten in JEMS. De aanvragen voor stap 1 en stap 2 van NWE-calls moeten in het Engels en uitsluitend via JEMS worden ingediend. GovChat ontsluit geautoriseerde JEMS-functies via de MCP Hub; dit vervangt de officiële JEMS-indieningsroute niet. | [Officiële JEMS-informatie](https://www.nweurope.eu/jems) · [`mcp-hub/README.md`](mcp-hub/README.md) |

Toegang tot gekoppelde diensten kan beperkt zijn op basis van account- of Entra-groepen. De workflowdocumentatie beschrijft de ingestelde rechten, gegevensstromen en operationele randvoorwaarden; raadpleeg die documentatie voordat een koppeling wordt geactiveerd of gebruikt.

## Verzoekroute en modelroute

1. LibreChat stuurt een OpenAI-compatible verzoek naar de afzonderlijke bridge.
2. De bridge routeert `govchat-orchestrator` naar de n8n `orchestrator` webhook.
3. De orchestrator gebruikt de volledige berichtenhistorie en roept specialisten zoals de B1-versimpelaar als interne tools aan.
4. n8n roept LiteLLM rechtstreeks aan; dit modelverkeer loopt niet door de bridge.
5. De streamed webhookrespons gaat terug via de bridge. Native live tool-cards zijn het beoogde lifecyclegedrag, maar de bijbehorende runtimepatches zijn niet opgenomen in deze migratiebranch; zie [`../docs/live-tool-calling.md`](../docs/live-tool-calling.md).

## Wijzigingen en workflow-ID's

- Houd workflow-`id` stabiel om bestaande workflow-imports bij te werken; verander IDs alleen bewust.
- Wijzigingen aan workflow-JSON worden in deze checkout gedaan en vervolgens via de normale monorepo review uitgerold.
- Controleer structuur/JSON met `node tests/agents/validate-workflows.js`.
- Zie [`CONTRIBUTING.md`](CONTRIBUTING.md) voor bijdragen.

