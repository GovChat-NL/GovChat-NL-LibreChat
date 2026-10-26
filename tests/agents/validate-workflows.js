#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { discoverWorkflows } = require('../../n8n/bootstrap');

const workflowsDir = path.resolve(__dirname, '../../agents/n8n/workflows');
const workflows = discoverWorkflows(workflowsDir);
const workflowIds = workflows.flatMap((entry) => entry.ids);
if (new Set(workflowIds).size !== workflowIds.length) {
  throw new Error('Discovered workflow IDs are not unique');
}

for (const workflow of workflows) console.log(`[PASS] ${workflow.file}`);
console.log(`Validated ${workflows.length} discovered workflow export(s); ${workflowIds.length} unique workflow ID(s).`);

const imageWorkflowExport = JSON.parse(
  fs.readFileSync(path.resolve(workflowsDir, 'image-generator-litellm.json'), 'utf8'),
);
const imageWorkflow = Array.isArray(imageWorkflowExport) ? imageWorkflowExport[0] : imageWorkflowExport;
const imageNodes = new Map(imageWorkflow.nodes.map((node) => [node.id, node]));
const imagePrep = imageNodes.get('PrepareImageRequest')?.parameters?.jsCode || '';
const imageBuild = imageNodes.get('BuildImageResponse')?.parameters?.jsCode || '';
const imageEditCall = imageNodes.get('CallImageEditApi');
const editBranch = imageWorkflow.connections?.['Route Image Request']?.main;
if (!imageEditCall || imageEditCall.parameters?.contentType !== 'multipart-form-data') {
  throw new Error('Image edit must call the edit endpoint with multipart/form-data');
}
if (!imageEditCall.parameters?.bodyParameters?.parameters?.some(
  (parameter) => parameter.parameterType === 'formBinaryData' && parameter.name === 'image',
)) {
  throw new Error('Image edit request is missing its binary image field');
}
if (!imagePrep.includes('/v1/images/edits') || !imagePrep.includes('prepareBinaryData') ||
  !imagePrep.includes('sourceValue') || !imagePrep.includes('parseObject(body.query ?? raw.query)')) {
  throw new Error('Image workflow does not prepare source images for edit requests');
}
if (!imageBuild.includes("'/shared-images'") || !imageBuild.includes('await fetch(httpUrl)')) {
  throw new Error('Generated image URLs are not persisted for follow-up editing');
}
if (!Array.isArray(editBranch) || editBranch.length !== 2 ||
  editBranch[0]?.[0]?.node !== 'Call Image Edit API' || editBranch[1]?.[0]?.node !== 'Call Images API') {
  throw new Error('Image edit/generation routing is not configured');
}

const orchestratorExport = JSON.parse(
  fs.readFileSync(path.resolve(workflowsDir, 'orchestrator-litellm.json'), 'utf8'),
);
const orchestrator = Array.isArray(orchestratorExport) ? orchestratorExport[0] : orchestratorExport;
const detectCode = orchestrator.nodes.find((node) => node.id === 'DetectImageMessages')?.parameters?.jsCode || '';
if (!detectCode.includes('classifyImageEditIntent') || !detectCode.includes('image_edit_context') ||
  !detectCode.includes('do not use keyword lists') ||
  !detectCode.includes('sourceImage') || detectCode.includes('requestRaw(imageWebhook')) {
  throw new Error('Orchestrator does not dynamically classify image edits for the agent tool');
}
const imageToolDescription = orchestrator.nodes.find((node) => node.id === 'ToolImageGeneration')?.parameters?.description || '';
const agentPrompt = orchestrator.nodes.find((node) => node.id === 'AIAgentOrchestrator')?.parameters?.text || '';
const agentSystemMessage = orchestrator.nodes.find((node) => node.id === 'AIAgentOrchestrator')?.parameters?.options?.systemMessage || '';
if (!imageToolDescription.includes('[IMAGE_EDIT_TOOL_REQUIRED]') || !agentPrompt.includes('image_edit_context') ||
  !imageToolDescription.includes('uitsluitend de waarde van response') || !agentSystemMessage.includes('only its response field')) {
  throw new Error('Image edits are not routed visibly or tool metadata may be echoed to the user');
}

const runnerConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../n8n/task-runners.json'), 'utf8'));
const allowedRunnerEnv = runnerConfig['task-runners'].find((runner) => runner['runner-type'] === 'javascript')?.['allowed-env'] || [];
for (const variable of ['N8N_WEBHOOK_TOKEN', 'N8N_ORCHESTRATOR_VISION_MODEL', 'N8N_ENABLE_IMAGE_TOOL']) {
  if (!allowedRunnerEnv.includes(variable)) throw new Error(`Task runner is missing allowed env ${variable}`);
}
console.log('[PASS] Image-to-image editing supports source images, multipart edits, orchestrator routing, and runner config.');
