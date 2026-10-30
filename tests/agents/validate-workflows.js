#!/usr/bin/env node
'use strict';

const path = require('path');
const { buildJemsCredential, discoverWorkflows } = require('../../n8n/bootstrap');

const workflowsDir = path.resolve(__dirname, '../../agents/n8n/workflows');
const mcpHubWorkflowsDir = path.resolve(__dirname, '../../agents/mcp-hub/workflows');
const workflows = discoverWorkflows(workflowsDir, [mcpHubWorkflowsDir]);
const workflowIds = workflows.flatMap((entry) => entry.ids);
if (new Set(workflowIds).size !== workflowIds.length) {
  throw new Error('Discovered workflow IDs are not unique');
}

for (const workflow of workflows) {
  const data = require(workflow.fullPath);
  const exports = Array.isArray(data) ? data : [data];
  for (const workflowExport of exports) {
    const jemsNodes = workflowExport.nodes.filter((node) => node.type === '@n8n/n8n-nodes-langchain.mcpClientTool');
    if (workflowExport.id === 'govchat-mcp-executor-hub' && jemsNodes.length !== 1) {
      throw new Error('MCP executor hub must expose JEMS as one native MCP Client Tool node');
    }
    if (workflowExport.id === 'govchat-mcp-executor-hub' && jemsNodes[0]?.name !== 'JEMS MCP') {
      throw new Error('JEMS MCP Client Tool node is missing its clear server-specific name');
    }
    if (workflowExport.id === 'govchat-mcp-executor-hub') {
      const dispatcherCode = workflowExport.nodes.find((node) => node.id === 'McpHubAuthorizeJemsTool')?.parameters?.jsCode || '';
      if (!dispatcherCode.includes('MCP_HUB_JEMS_REQUIRED_GROUP_IDS') || /\bfetch\s*\(/.test(dispatcherCode)) {
        throw new Error('Hub must keep authorization in Code and MCP transport in the native MCP Client Tool node');
      }
    }
  }
  console.log(`[PASS] ${workflow.file}`);
}

const getWorkflow = (id) => {
  for (const { fullPath } of workflows) {
    const parsed = require(fullPath);
    const exports = Array.isArray(parsed) ? parsed : [parsed];
    const match = exports.find((item) => item.id === id);
    if (match) return match;
  }
  throw new Error(`Missing workflow ${id}`);
};

const registryWorkflow = getWorkflow('govchat-mcp-registry-sync');
const registryHttpNodes = registryWorkflow.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest');
if (registryHttpNodes.length !== 3 || registryHttpNodes.some((node) => !node.credentials?.httpMultipleHeadersAuth)) {
  throw new Error('JEMS registry sync must use authenticated HTTP nodes for initialize, ready, and tools/list');
}
const manualRegistryTrigger = registryWorkflow.nodes.find((node) => node.id === 'McpRegistryManualTrigger');
const manualRegistryRoute = registryWorkflow.connections?.['Manual Registry Refresh']?.main?.[0]?.[0];
if (manualRegistryTrigger?.type !== 'n8n-nodes-base.manualTrigger' || manualRegistryRoute?.node !== 'Initialize JEMS MCP session') {
  throw new Error('JEMS registry sync must expose a manual trigger connected to session initialization');
}
if (!registryWorkflow.nodes.some((node) => node.type === 'n8n-nodes-base.dataTable' && node.parameters.operation === 'upsert')) {
  throw new Error('JEMS registry sync must upsert discovered functions into the MCP table');
}

const orchestrator = getWorkflow('govchat-orchestrator-litellm');
const capabilityNode = orchestrator.nodes.find((node) => node.id === 'PrepareMcpHubCapabilities');
const mcpToolNode = orchestrator.nodes.find((node) => node.id === 'ToolMcpHub');
if (!capabilityNode?.parameters?.jsCode?.includes('user_authorized_groups') || !capabilityNode.parameters.jsCode.includes('required_group_ids')) {
  throw new Error('Orchestrator must filter registry functions using verified Entra groups');
}
if (!String(mcpToolNode?.parameters?.description || '').includes('mcp_hub_tool_description')) {
  throw new Error('Orchestrator MCP Hub description must be generated dynamically per user');
}
if (!String(mcpToolNode?.parameters?.workflowInputs?.value?.user_authorized_groups || '').includes('$json.user_authorized_groups')) {
  throw new Error('Verified Entra groups must be passed to the executor outside AI-generated inputs');
}

const credential = buildJemsCredential({
  JEMS_MCP_API_KEY: 'test-api-key',
  JEMS_MCP_USERNAME: 'test-user',
  JEMS_MCP_PASSWORD: 'test-password',
});
if (credential.type !== 'httpMultipleHeadersAuth' || credential.data.headers.values.length !== 3) {
  throw new Error('JEMS credential bootstrap must create a multiple-header credential with all three values');
}
if (credential.data.headers.values.map(({ name }) => name).join(',') !== 'X-API-Key,X-Jems-Email,X-Jems-Password') {
  throw new Error('JEMS credential bootstrap must use the fixed staging gateway header names');
}
if (credential.data.headers.values.some(({ value }) => !value)) {
  throw new Error('JEMS bootstrap credential omitted an environment-supplied value');
}
if (buildJemsCredential({}) !== null) {
  throw new Error('JEMS credential bootstrap should be optional when all JEMS variables are unset');
}
let partialCredentialRejected = false;
try {
  buildJemsCredential({ JEMS_MCP_API_KEY: 'partial' });
} catch {
  partialCredentialRejected = true;
}
if (!partialCredentialRejected) throw new Error('Partial JEMS credentials must fail bootstrap validation');
if (workflows.some(({ fullPath }) => require('fs').readFileSync(fullPath, 'utf8').includes('test-api-key'))) {
  throw new Error('JEMS secret values must not appear in source workflow exports');
}
console.log(`Validated ${workflows.length} discovered workflow export(s); ${workflowIds.length} unique workflow ID(s).`);
