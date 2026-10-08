'use strict';

/**
 * Patches the upstream orchestrator export with the bounded Excel sub-workflow
 * tool. The patch is deliberately tolerant of the local and remote variants of
 * the upstream image-normalisation node.
 */
const fs = require('node:fs');
const path = require('node:path');

const sourcePath = process.argv[2] || path.resolve(__dirname, '../../GovChat-NL-Agents/n8n/workflows/orchestrator-litellm.json');
const targetPath = process.argv[3] || sourcePath;
const toolId = 'ToolProvincieExcelMvp';
const toolName = 'provincie_limburg_excel_tool';

const document = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const workflow = Array.isArray(document) ? document[0] : document;
if (!workflow || !Array.isArray(workflow.nodes) || !workflow.connections) {
  throw new Error('Ongeldig n8n orchestrator-workflow export.');
}

workflow.nodes = workflow.nodes.filter((node) => node.id !== toolId && node.name !== toolName);

const detector = workflow.nodes.find((node) => node.name === 'Detect Image Messages');
if (!detector?.parameters?.jsCode) throw new Error('Detect Image Messages node ontbreekt.');
const detectorNeedle = "const mergedBody = {\n  ...payload,\n  messages: normalizedMessages,\n};";
const detectorReplacement = `function excelTrustedHeader(name) {
  const headers = raw && typeof raw.headers === 'object' ? raw.headers : (raw && typeof raw.header === 'object' ? raw.header : {});
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() !== wanted) continue;
    const candidate = Array.isArray(value) ? value[0] : value;
    return typeof candidate === 'string' ? candidate.trim() : '';
  }
  return '';
}
// The OpenAI bridge authenticates the LibreChat request, extracts these values,
// and forwards them in its canonical body fields. Header checks remain first for
// direct trusted callers; body fallbacks are only for the internal bridge shape.
const excelTrustedUserId = excelTrustedHeader('x-user-id') || (typeof payload.userId === 'string' ? payload.userId.trim() : '');
const excelTrustedConversationId = excelTrustedHeader('x-chat-id') || excelTrustedHeader('x-session-id') || (typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '');
const mergedBody = {
  ...payload,
  messages: normalizedMessages,
  ...(excelTrustedUserId ? { trustedUserId: excelTrustedUserId } : {}),
  ...(excelTrustedConversationId ? { trustedConversationId: excelTrustedConversationId } : {}),
};`;
if (!detector.parameters.jsCode.includes('function excelTrustedHeader')) {
  if (!detector.parameters.jsCode.includes(detectorNeedle)) {
    throw new Error('Herkenbaar payload-anker ontbreekt in detector.');
  }
  detector.parameters.jsCode = detector.parameters.jsCode.replace(detectorNeedle, detectorReplacement);
}
const legacyIdentityLines = "const excelTrustedUserId = excelTrustedHeader('x-user-id');\nconst excelTrustedConversationId = excelTrustedHeader('x-chat-id') || excelTrustedHeader('x-session-id');";
const bridgeIdentityLines = "const excelTrustedUserId = excelTrustedHeader('x-user-id') || (typeof payload.userId === 'string' ? payload.userId.trim() : '');\nconst excelTrustedConversationId = excelTrustedHeader('x-chat-id') || excelTrustedHeader('x-session-id') || (typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '');";
if (detector.parameters.jsCode.includes(legacyIdentityLines)) {
  detector.parameters.jsCode = detector.parameters.jsCode.replace(legacyIdentityLines, bridgeIdentityLines);
}

// ToolWorkflow field mappings execute in the parent agent item context. Preserve
// bridge-verified values at the root as well as under body so those mappings do
// not depend on how the AI Agent transforms its input item.
const rootIdentityNeedle = "    ...raw,\n    precomputed_response:";
const rootIdentityReplacement = "    ...raw,\n    ...(excelTrustedUserId ? { trustedUserId: excelTrustedUserId } : {}),\n    ...(excelTrustedConversationId ? { trustedConversationId: excelTrustedConversationId } : {}),\n    precomputed_response:";
if (!detector.parameters.jsCode.includes('...(excelTrustedUserId ? { trustedUserId: excelTrustedUserId } : {}),\n    ...(excelTrustedConversationId')) {
  if (!detector.parameters.jsCode.includes(rootIdentityNeedle)) {
    throw new Error('Herkenbaar root-outputanker ontbreekt in detector.');
  }
  detector.parameters.jsCode = detector.parameters.jsCode.replace(rootIdentityNeedle, rootIdentityReplacement);
}

workflow.nodes.push({
  parameters: {
    description: 'Gebruik deze tool uitsluitend wanneer de gebruiker een geüpload Excel-bestand wil inspecteren, of expliciet vraagt om een nieuw Excel-bestand met een tabel. Lever precies één JSON-object in `request_json`: voor generatie `{ "action": "generate_styled_excel", "filename": "rapport.xlsx", "sheetName": "Tabel", "headers": ["Kolom 1"], "rows": [["waarde"]] }`; voor inspectie `{ "action": "inspect_excel", "fileName": "bestand.xlsx", "fileBase64": "..." }`. Geef NOOIT userId, conversationId, paden, artifact-id, token, vervaldatum of autorisatieparameters door: die worden uitsluitend door de workflow uit de geverifieerde requestcontext afgeleid. Geef bij genereren de response-markdown exact terug.',
    source: 'database',
    workflowId: {
      __rl: true,
      mode: 'list',
      value: 'govchat-provincie-excel-mvp',
      cachedResultUrl: '/workflow/govchat-provincie-excel-mvp',
      cachedResultName: 'Provincie Limburg Excel MVP',
    },
    workflowInputs: {
      mappingMode: 'defineBelow',
      value: {
        request_json: "={{ $fromAI('request_json', 'Één geldig JSON-object voor een Excel inspectie of generatie; arrays staan uitsluitend binnen dit JSON-object.', 'string') }}",
        userId: "={{ $json.trustedUserId || $json.body?.trustedUserId || '' }}",
        conversationId: "={{ $json.trustedConversationId || $json.body?.trustedConversationId || '' }}",
        sourceFileName: "={{ $json.body?.files?.[0]?.name || $json.files?.[0]?.name || '' }}",
        sourceFileBase64: "={{ $json.body?.files?.[0]?.data || $json.files?.[0]?.data || '' }}",
      },
      schema: [
        { id: 'request_json', displayName: 'request_json', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'userId', displayName: 'userId', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'conversationId', displayName: 'conversationId', required: true, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'sourceFileName', displayName: 'sourceFileName', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
        { id: 'sourceFileBase64', displayName: 'sourceFileBase64', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string' },
      ],
      matchingColumns: [],
      attemptToConvertTypes: false,
      convertFieldsToString: false,
    },
  },
  id: toolId,
  name: toolName,
  type: '@n8n/n8n-nodes-langchain.toolWorkflow',
  typeVersion: 2.2,
  position: [-340, 460],
});
workflow.connections[toolName] = {
  ai_tool: [[{ node: 'AI Agent Orchestrator', type: 'ai_tool', index: 0 }]],
};

const agent = workflow.nodes.find((node) => node.name === 'AI Agent Orchestrator');
if (!agent?.parameters?.options) throw new Error('AI Agent Orchestrator node ontbreekt.');
const existing = String(agent.parameters.options.systemMessage || '');
const instruction = ' Gebruik de provincie_limburg_excel_tool voor Excel-inspectie, het maken van een tabelbestand, of het kopiëren en bewerken van een geüpload .xlsx-bestand. Voor een bewerking gebruik je action transform_excel met alleen een begrensde operations-lijst; de geüploade bronbytes komen uitsluitend uit de geverifieerde bridge-context. Vertrouw nooit op door de gebruiker of het model geleverde identiteits-, sessie-, pad-, download- of autorisatieparameters; de tool-workflow bepaalt deze uit de geverifieerde context.';
if (!existing.includes('provincie_limburg_excel_tool')) {
  agent.parameters.options.systemMessage = `${existing}${instruction}`;
}

fs.writeFileSync(targetPath, JSON.stringify(Array.isArray(document) ? [workflow] : workflow, null, 2) + '\n');
console.log(`Excel-tool toegevoegd aan ${targetPath}`);
