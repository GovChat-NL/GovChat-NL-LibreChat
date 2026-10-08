# XLSX-uploadafhankelijkheid: GovChat n8n OpenAI Bridge-fork

## Status

Bewerken en inspecteren van een geüpload Excel-bestand vereist een aangepaste n8n OpenAI Bridge. Deze repository bevat daarvoor een vastgepinde Git-submodule in [`vendor/n8n-openai-bridge`](../vendor/n8n-openai-bridge).

- GovChat-fork: <https://github.com/GovChat-NL/n8n-openai-bridge>
- Interne review-PR: <https://github.com/GovChat-NL/n8n-openai-bridge/pull/1>
- Upstream bijdrage voor XLSX-doorsturing: <https://github.com/sveneisenschmidt/n8n-openai-bridge/pull/76>
- Upstream Files API-afhankelijkheid: <https://github.com/sveneisenschmidt/n8n-openai-bridge/pull/72>

## Waarom deze fork nodig is

Het standaard upstream bridge-image stuurt wel chatberichten en afbeeldingen door, maar geen XLSX-bijlagen als workflowdata. Zonder de fork kan de Excel-tool alleen nieuwe workbooks genereren. Een verzoek om een geüpload workbook te inspecteren of te bewerken faalt bewust gesloten.

De GovChat-fork combineert de benodigde Files API-voorloper met een begrensde XLSX-aanpassing. De aanpassing:

1. behoudt bestaand gedrag voor afbeeldingen;
2. accepteert uitsluitend `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` als `file`-contentdeel;
3. wijst andere generieke documenttypen af;
4. ondersteunt `extract-xlsx-json`, waarbij alleen XLSX-bytes als base64 workflowdata worden toegevoegd.

Hierdoor wordt de bridge geen algemeen kanaal voor het doorsturen van willekeurige documenten.

## Deploymentcontract

Gebruik voor Phase 2A geen zwevende upstream-tag. De Compose-service bouwt standaard uit de Git-submodule en gebruikt het vastgepinde submodulecommit.

```env
N8N_OPENAI_BRIDGE_IMAGE='govchat-n8n-openai-bridge:excel-xlsx-d16a431'
N8N_OPENAI_BRIDGE_FILE_UPLOAD_MODE='extract-xlsx-json'
```

Gebruik een immutable registry-digest zodra een interne registry-image is gepubliceerd. Pas de submodule alleen bij via een beoordeelde, geteste commit van de GovChat-fork.

## Verwachte workflowdata

De Excel-workflow gebruikt uitsluitend de eerste XLSX-bijlage uit de geverifieerde bridge-body:

```json
{
  "body": {
    "userId": "geverifieerde LibreChat-gebruiker",
    "sessionId": "geverifieerde gesprekssessie",
    "files": [
      {
        "name": "bronbestand.xlsx",
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "data": "base64-workbookbytes"
      }
    ]
  }
}
```

De n8n-workflow gebruikt geen door de gebruiker opgegeven hostpad, URL, eigenaar of sessie. De Excel-worker schrijft altijd een nieuw resultaatbestand; het bronbestand blijft ongewijzigd.

## Beheerproces

1. Beoordeel wijzigingen in de GovChat-fork via de interne PR.
2. Voer bridge-linting, formattering, unit tests en een containerbuild uit.
3. Werk de Git-submodule alleen bij naar de goedgekeurde commit.
4. Valideer daarna de volledige LibreChat → bridge → n8n → Excel-worker keten.
5. Lever alleen daarna een nieuwe commit op `feature/excel` op.

Als upstream PR #72 of #76 wordt gemerged, beoordeel die merge afzonderlijk; een upstream merge is geen automatische reden om de GovChat deployment-pin te wijzigen.
