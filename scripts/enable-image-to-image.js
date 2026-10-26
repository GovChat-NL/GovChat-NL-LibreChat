const fs = require('fs');
const path = require('path');

const workflowRoot = path.resolve(__dirname, '../agents/n8n/workflows');
const imagePath = path.join(workflowRoot, 'image-generator-litellm.json');
const orchestratorPath = path.join(workflowRoot, 'orchestrator-litellm.json');

function readWorkflow(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { parsed, workflow: Array.isArray(parsed) ? parsed[0] : parsed };
}

function saveWorkflow(filePath, parsed) {
  fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

const imageBundle = readWorkflow(imagePath);
const imageWorkflow = imageBundle.workflow;
const prepareNode = imageWorkflow.nodes.find((node) => node.id === 'PrepareImageRequest');
const generateNode = imageWorkflow.nodes.find((node) => node.id === 'CallImageApi');
const buildNode = imageWorkflow.nodes.find((node) => node.id === 'BuildImageResponse');
if (!prepareNode || !generateNode || !buildNode) throw new Error('Image workflow nodes are missing');

prepareNode.parameters.jsCode = `const raw = $json || {};
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const asString = (v) => (typeof v === 'string' ? v.trim() : '');
const body = isObj(raw.body) ? raw.body : raw;
const headers = isObj(raw.headers) ? raw.headers : {};

const expectedToken = String($env.N8N_WEBHOOK_TOKEN || '').trim();
const hasWebhookShape = !!raw.body || Object.keys(headers).length > 0;
if (hasWebhookShape) {
  const headerToken = String(headers['x-govchat-token'] || headers['X-Govchat-Token'] || '').trim();
  const authHeader = String(headers.authorization || headers.Authorization || '').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const suppliedToken = headerToken || bearerToken;
  if (!expectedToken) throw new Error('Server misconfiguratie: N8N_WEBHOOK_TOKEN ontbreekt');
  if (!suppliedToken || suppliedToken !== expectedToken) throw new Error('Unauthorized webhook token');
}

function fromMessages(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] || {};
    const content = message.content;
    if (typeof content === 'string' && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content.map((part) => typeof part === 'string' ? part : asString(part?.text))
        .filter(Boolean).join(' ').trim();
      if (text) return text;
    }
  }
  return '';
}

function parseObject(value) {
  if (isObj(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return isObj(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

const queryArgs = parseObject(body.query ?? raw.query);
const nested = [body.data, body.arguments, body.args, raw.toolInput, raw.input, raw.parameters, queryArgs].filter(isObj);
const queryPrompt = Object.keys(queryArgs).length ? queryArgs.prompt : body.query;
const candidates = [body.prompt, body.text, body.input, queryPrompt, body.message, body.user_input,
  body.request, body.instruction, ...nested.flatMap((item) => [item.prompt, item.text, item.input]),
  fromMessages(body.messages), fromMessages(raw.messages)].map(asString).filter(Boolean);
const prompt = candidates[0] || '';
if (!prompt) throw new Error('Afbeelding-tool vereist een prompt');

const source = body.image ?? body.source_image ?? body.input_image ?? body.image_url ??
  body.data?.image ?? body.arguments?.image ?? body.args?.image ?? queryArgs.image ?? queryArgs.source_image ??
  queryArgs.input_image ?? queryArgs.image_url;
const sourceValue = typeof source === 'string' ? source :
  (isObj(source) ? asString(source.url) || asString(source.data) : '');
const isEdit = !!sourceValue;

const requestedSize = (asString(body.size) || asString(raw.size) || '').toLowerCase();
const requestedQuality = (asString(body.quality) || asString(raw.quality) || '').toLowerCase();
const enabled = String($env.N8N_ENABLE_IMAGE_TOOL || 'false').toLowerCase() === 'true';
const baseRaw = String($env.N8N_LITELLM_IMAGE_BASE_URL || $env.LITELLM_URL || 'http://litellm:4000').trim();
const apiBase = baseRaw.replace(/\\/$/, '');
const apiKey = String($env.N8N_LITELLM_IMAGE_API_KEY || $env.LITELLM_API_KEY || '').trim();
const model = String($env.N8N_LITELLM_IMAGE_MODEL || 'gpt-image-1').trim();
const apiVersion = String($env.N8N_LITELLM_IMAGE_API_VERSION || '2025-04-01-preview').trim();
const modelLc = model.toLowerCase();
const isGptImage = modelLc.includes('gpt-image');
const isDalle3 = modelLc.includes('dall-e-3');
const isDalle2 = modelLc.includes('dall-e-2');

function normalizeQuality(input) {
  if (isGptImage) return ({ standard: 'auto', hd: 'high' })[input] || (['auto', 'low', 'medium', 'high'].includes(input) ? input : 'auto');
  if (isDalle3) return ({ auto: 'standard', low: 'standard', medium: 'standard', high: 'hd' })[input] || (['standard', 'hd'].includes(input) ? input : 'standard');
  return isDalle2 ? 'standard' : (input || 'auto');
}
function normalizeSize(input) {
  if (isGptImage) return ['auto', '1024x1024', '1536x1024', '1024x1536'].includes(input) ? input : 'auto';
  if (isDalle3) return ['1024x1024', '1792x1024', '1024x1792'].includes(input) ? input : '1024x1024';
  if (isDalle2) return ['256x256', '512x512', '1024x1024'].includes(input) ? input : '1024x1024';
  return input || '1024x1024';
}
const size = normalizeSize(requestedSize);
const quality = normalizeQuality(requestedQuality);
const isAzureDeploymentPath = apiBase.toLowerCase().includes('/openai/deployments/');
const generateUrl = isAzureDeploymentPath
  ? apiBase + '/images/generations?api-version=' + encodeURIComponent(apiVersion)
  : apiBase + '/v1/images/generations';
const editUrl = isAzureDeploymentPath
  ? apiBase + '/images/edits?api-version=' + encodeURIComponent(apiVersion)
  : apiBase + '/v1/images/edits';

if (!enabled) {
  return [{ json: { image_disabled: true, disabled_reason: 'Afbeelding-generatie staat uit (N8N_ENABLE_IMAGE_TOOL=false).',
    generateUrl: 'http://127.0.0.1:9/disabled', editUrl: 'http://127.0.0.1:9/disabled', requestBody: {},
    apiKey: '', isAzureDeploymentPath, prompt, size, quality, model, isEdit } }];
}
if (!apiKey) throw new Error('LITELLM_API_KEY ontbreekt');

const item = { prompt, size, quality, model, apiBase, apiKey, isAzureDeploymentPath, generateUrl, editUrl, isEdit };
if (!isEdit) {
  item.requestBody = isAzureDeploymentPath ? { prompt, size, quality } : { model, prompt, size, quality };
  return [{ json: item }];
}

if (!isGptImage && !isDalle2) {
  throw new Error('Het ingestelde imagemodel ondersteunt geen image-to-image edits. Gebruik gpt-image-1 of dall-e-2.');
}

let imageBuffer;
let mimeType = 'image/png';
let fileName = 'source.png';
if (sourceValue.startsWith('data:')) {
  const match = sourceValue.match(/^data:(image\\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Bronafbeelding moet een base64 data-URL zijn van een PNG, JPEG of WebP');
  mimeType = match[1].toLowerCase();
  fileName = mimeType === 'image/jpeg' ? 'source.jpg' : (mimeType === 'image/webp' ? 'source.webp' : 'source.png');
  imageBuffer = Buffer.from(match[2], 'base64');
} else if (sourceValue.startsWith('https://')) {
  const remoteUrl = new URL(sourceValue);
  if (!remoteUrl.hostname || remoteUrl.hostname.includes(':') || /^(localhost|.*\\.local$|127\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.)/i.test(remoteUrl.hostname)) {
    throw new Error('De URL van de bronafbeelding is niet toegestaan');
  }
  const response = await fetch(remoteUrl.href);
  if (!response.ok) throw new Error('De bronafbeelding kon niet worden opgehaald (HTTP ' + response.status + ')');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].some((type) => contentType.includes(type))) {
    throw new Error('De opgehaalde URL bevat geen ondersteund afbeeldingsformaat');
  }
  mimeType = contentType.includes('image/jpeg') ? 'image/jpeg' : (contentType.includes('image/webp') ? 'image/webp' : 'image/png');
  fileName = mimeType === 'image/jpeg' ? 'source.jpg' : (mimeType === 'image/webp' ? 'source.webp' : 'source.png');
  imageBuffer = Buffer.from(await response.arrayBuffer());
} else {
  const fs = require('fs');
  const path = require('path');
  const candidateName = path.basename(sourceValue.split(/[?#]/)[0]);
  if (!/^generated-[a-zA-Z0-9-]+\\.(?:png|jpe?g|webp)$/i.test(candidateName)) {
    throw new Error('Alleen gegenereerde afbeeldingen uit deze chat kunnen via een afbeeldings-URL worden bewerkt');
  }
  const localPath = path.join('/shared-images', candidateName);
  if (!fs.existsSync(localPath)) throw new Error('De bronafbeelding is niet meer beschikbaar voor bewerking');
  imageBuffer = fs.readFileSync(localPath);
  const ext = path.extname(candidateName).toLowerCase();
  mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : (ext === '.webp' ? 'image/webp' : 'image/png');
  fileName = candidateName;
}
if (!imageBuffer?.length || imageBuffer.length > 50 * 1024 * 1024) throw new Error('Bronafbeelding is leeg of groter dan 50 MB');
const imageBinary = await this.helpers.prepareBinaryData(imageBuffer, fileName, mimeType);
return [{ json: item, binary: { image: imageBinary } }];`;

buildNode.parameters.jsCode = `const arr = Array.isArray($json.data) ? $json.data : [];
const first = arr[0] || {};

if ($json.image_disabled || $json.disabled_reason) {
  return [{ json: { response: 'Afbeelding-generatie is momenteel uitgeschakeld door de beheerder.', image_url: null, has_base64: false, image_disabled: true } }];
}
if ($json.error) {
  const message = String($json.error?.message || $json.error || '').trim();
  return [{ json: { response: message ? 'Afbeelding-generatie mislukt: ' + message : 'Afbeelding-generatie mislukt.', image_url: null, has_base64: false, image_error: true } }];
}

const httpUrl = String(first.url || '').trim();
const b64 = String(first.b64_json || '').trim();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const publicBase = String($env.PUBLIC_BASE_URL || '').replace(/\\/$/, '');
const outDir = '/shared-images';
fs.mkdirSync(outDir, { recursive: true });
let outputBuffer;
let extension = 'png';

if (b64) {
  outputBuffer = Buffer.from(b64, 'base64');
} else if (httpUrl) {
  const response = await fetch(httpUrl);
  if (!response.ok) throw new Error('Image API gaf een onbereikbare afbeeldings-URL terug (HTTP ' + response.status + ')');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  extension = contentType.includes('jpeg') ? 'jpg' : (contentType.includes('webp') ? 'webp' : 'png');
  outputBuffer = Buffer.from(await response.arrayBuffer());
} else {
  throw new Error('Geen afbeelding URL/b64 ontvangen van image API');
}

if (!outputBuffer.length || outputBuffer.length > 50 * 1024 * 1024) throw new Error('Afbeelding is leeg of groter dan 50 MB');
const fileName = 'generated-' + Date.now() + '-' + crypto.randomUUID() + '.' + extension;
fs.writeFileSync(path.join(outDir, fileName), outputBuffer);
const imageUrl = (publicBase || '') + '/images/' + fileName;
const markdown = '![gegenereerde afbeelding](' + imageUrl + ')';
return [{ json: { response: markdown, image_url: imageUrl, markdown, has_base64: !!b64, stored_file: fileName } }];`;

// Keep the existing JSON generation request and add a separate multipart edit request.
const editNodeId = 'CallImageEditApi';
let editNode = imageWorkflow.nodes.find((node) => node.id === editNodeId);
if (!editNode) {
  editNode = {
    parameters: {
      method: 'POST',
      url: '={{ $json.editUrl }}',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'Authorization', value: "={{ $json.isAzureDeploymentPath ? '' : ('Bearer ' + $json.apiKey) }}" },
        { name: 'api-key', value: '={{ $json.isAzureDeploymentPath ? $json.apiKey : "" }}' },
      ] },
      sendBody: true,
      contentType: 'multipart-form-data',
      bodyParameters: { parameters: [
        { name: 'model', value: '={{ $json.isAzureDeploymentPath ? "" : $json.model }}' },
        { name: 'prompt', value: '={{ $json.prompt }}' },
        { name: 'size', value: '={{ $json.size }}' },
        { name: 'quality', value: '={{ $json.model.toLowerCase().includes("gpt-image") ? $json.quality : "" }}' },
        { parameterType: 'formBinaryData', name: 'image', inputDataFieldName: 'image' },
      ] },
      options: { timeout: 180000 },
    },
    id: editNodeId,
    name: 'Call Image Edit API',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [-480, 420],
    continueOnFail: true,
  };
  imageWorkflow.nodes.push(editNode);
}

let router = imageWorkflow.nodes.find((node) => node.id === 'RouteImageRequest');
if (!router) {
  router = {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: 'is-image-edit', leftValue: '={{ $json.isEdit }}', rightValue: true,
        operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
    id: 'RouteImageRequest', name: 'Route Image Request', type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: [-600, 220],
  };
  imageWorkflow.nodes.push(router);
}
imageWorkflow.connections['Prepare Image Request'] = { main: [[{ node: 'Route Image Request', type: 'main', index: 0 }]] };
imageWorkflow.connections['Route Image Request'] = { main: [
  [{ node: 'Call Image Edit API', type: 'main', index: 0 }],
  [{ node: 'Call Images API', type: 'main', index: 0 }],
] };
imageWorkflow.connections['Call Image Edit API'] = { main: [[{ node: 'Build Image Response', type: 'main', index: 0 }]] };
imageWorkflow.connections['Call Images API'] = { main: [[{ node: 'Build Image Response', type: 'main', index: 0 }]] };
saveWorkflow(imagePath, imageBundle.parsed);

const orchestratorBundle = readWorkflow(orchestratorPath);
const orchestrator = orchestratorBundle.workflow;
const detectNode = orchestrator.nodes.find((node) => node.id === 'DetectImageMessages');
const agent = orchestrator.nodes.find((node) => node.id === 'AIAgentOrchestrator');
const imageTool = orchestrator.nodes.find((node) => node.id === 'ToolImageGeneration');
if (!detectNode) throw new Error('DetectImageMessages node not found');
if (!agent) throw new Error('AIAgentOrchestrator node not found');
if (!imageTool) throw new Error('ToolImageGeneration node not found');

let detectCode = String(detectNode.parameters.jsCode || '');
const marker = "let precomputedResponse = '';";
const insertion = `let precomputedResponse = '';
let imageEditStatus = 'not_requested';
let imageEditContext;
const lastUserMessage = [...messages].reverse().find((message) => String(message?.role || '').toLowerCase() === 'user');
const lastUserText = (() => {
  const current = [payload.currentMessage, payload.chatInput, payload.text].find((value) => typeof value === 'string' && value.trim());
  if (current) return current.trim();
  const content = lastUserMessage?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map((part) => typeof part === 'string' ? part : String(part?.text || '')).join(' ') : '';
})();
let sourceImage = '';
const normalizedLastUserMessage = [...normalizedMessages].reverse()
  .find((message) => String(message?.role || '').toLowerCase() === 'user');
for (const message of (normalizedLastUserMessage ? [normalizedLastUserMessage] : [])) {
  for (const part of (Array.isArray(message?.content) ? message.content : [])) {
    const type = String(part?.type || '').toLowerCase();
    const value = typeof part?.image_url === 'string' ? part.image_url : String(part?.image_url?.url || part?.url || '');
    if (['image_url', 'input_image', 'image'].includes(type) && value.startsWith('data:image/')) sourceImage = value;
  }
}
if (!sourceImage) {
  for (let index = messages.length - 1; index >= 0 && !sourceImage; index--) {
    const message = messages[index] || {};
    if (String(message.role || '').toLowerCase() !== 'assistant') continue;
    const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
      ? message.content.map((part) => typeof part === 'string' ? part : String(part?.text || '')).join(' ') : '';
    const matches = [...text.matchAll(/!\\[[^\\]]*\\]\\(([^)]+)\\)/g)];
    for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex--) {
      try {
        const url = new URL(matches[matchIndex][1], 'http://local.invalid');
        const fileName = url.pathname.split('/').pop();
        if (/^generated-[a-zA-Z0-9-]+\\.(?:png|jpe?g|webp)$/i.test(fileName)) { sourceImage = '/images/' + fileName; break; }
        if (url.protocol === 'https:' && url.hostname && !url.hostname.includes(':') && !/^(localhost|.*\\.local$|127\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.)/i.test(url.hostname)) {
          sourceImage = url.href;
          break;
        }
      } catch (_) {}
    }
  }
}
if (!sourceImage) {
  for (let index = messages.length - 1; index >= 0 && !sourceImage; index--) {
    const message = messages[index] || {};
    if (String(message.role || '').toLowerCase() !== 'user') continue;
    const normalizedMessage = normalizedMessages[index] || message;
    for (const part of (Array.isArray(normalizedMessage.content) ? normalizedMessage.content : [])) {
      const type = String(part?.type || '').toLowerCase();
      const value = typeof part?.image_url === 'string' ? part.image_url : String(part?.image_url?.url || part?.url || '');
      if (['image_url', 'input_image', 'image'].includes(type) && value.startsWith('data:image/')) { sourceImage = value; break; }
    }
  }
}
async function classifyImageEditIntent() {
  if (!sourceImage || !lastUserText) return false;
  const apiKey = String($env.LITELLM_API_KEY || $env.N8N_LITELLM_IMAGE_API_KEY || '').trim();
  if (!apiKey) return false;
  const base = String($env.LITELLM_URL || 'http://litellm:4000').replace(/\\/$/, '') + '/v1/chat/completions';
  const model = String($env.N8N_ORCHESTRATOR_VISION_MODEL || 'gpt-5.4').trim() || 'gpt-5.4';
  const context = messages.slice(-12).map((message) => {
    const role = String(message?.role || 'unknown');
    const content = typeof message?.content === 'string' ? message.content : Array.isArray(message?.content)
      ? message.content.map((part) => {
        if (typeof part === 'string') return part;
        const type = String(part?.type || '').toLowerCase();
        if (['image', 'image_url', 'input_image'].includes(type)) return '[image attached]';
        return String(part?.text || part?.content || '');
      }).join(' ')
      : '';
    return '[' + role + '] ' + content.replace(/!\\[[^\\]]*\\]\\([^)]+\\)/g, '[image in conversation]');
  }).join('\\n').slice(-12000) + '\\n[latest user request] ' + lastUserText;
  const response = await requestRaw(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 100,
      messages: [
        { role: 'system', content: 'Classify whether the latest user request wants an existing image in this conversation to be modified, transformed, continued, or used as the source for a derived image. Interpret intent from context in any language; do not use keyword lists. Return only JSON: {"action":"edit"} or {"action":"not_edit"}. Choose not_edit for image description/questions or for an unrelated new image. If ambiguous, choose not_edit.' },
        { role: 'user', content: 'An existing source image is available. Conversation:\\n' + context },
      ],
    }),
  });
  if (!response.ok) throw new Error('Image intent classification returned HTTP ' + response.status);
  const result = JSON.parse(String(response.text || '{}'));
  const answer = result?.choices?.[0]?.message?.content;
  const text = typeof answer === 'string' ? answer : Array.isArray(answer)
    ? answer.map((part) => String(part?.text || '')).join(' ') : '';
  const jsonText = text.match(/\\{[\\s\\S]*\\}/)?.[0];
  if (!jsonText) return false;
  try { return JSON.parse(jsonText).action === 'edit'; } catch (_) { return false; }
}

let shouldEditImage = false;
if (sourceImage) {
  try {
    shouldEditImage = await classifyImageEditIntent();
    imageEditStatus = shouldEditImage ? 'edit_intent_detected' : 'not_an_edit_request';
  } catch (_) {
    imageEditStatus = 'intent_classification_failed';
  }
}

if (shouldEditImage && sourceImage) {
  try {
    let toolImageSource = sourceImage;
    if (sourceImage.startsWith('data:')) {
      const match = sourceImage.match(/^data:(image\\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
      if (!match) throw new Error('Upload does not use a supported image data URL');
      const fs = require('fs');
      const crypto = require('crypto');
      const mime = match[1].toLowerCase();
      const extension = mime === 'image/jpeg' ? 'jpg' : (mime === 'image/webp' ? 'webp' : 'png');
      const filename = 'generated-source-' + Date.now() + '-' + crypto.randomUUID() + '.' + extension;
      fs.mkdirSync('/shared-images', { recursive: true });
      fs.writeFileSync('/shared-images/' + filename, Buffer.from(match[2], 'base64'));
      toolImageSource = '/images/' + filename;
    }
    imageEditContext = { prompt: lastUserText, image: toolImageSource };
    imageEditStatus = 'ready_for_visible_tool_call';
  } catch (error) {
    imageEditStatus = 'failed';
    precomputedResponse = 'De afbeelding kon niet worden bewerkt: ' + String(error?.message || error || 'onbekende fout');
  }
}`;
const markerStart = detectCode.indexOf(marker);
const markerEnd = detectCode.indexOf('let visionCallStatus =', markerStart);
if (markerStart >= 0 && markerEnd > markerStart) {
  detectCode = detectCode.slice(0, markerStart) + insertion + '\n' + detectCode.slice(markerEnd);
} else if (!detectCode.includes('imageEditStatus')) {
  throw new Error('Could not find insertion point in DetectImageMessages code');
}
detectCode = detectCode.replace('if (imageParts > 0) {', 'if (imageParts > 0 && !precomputedResponse) {');
detectCode = detectCode.replace("reason: 'Normalize image payload and precompute multimodal answer when image is attached',", "reason: 'Normalize image payload, dynamically classify image-edit intent, and send edits through the visible image tool',\n      imageEditStatus,");
detectCode = detectCode.replace('precomputed_response: precomputedResponse || undefined,', 'precomputed_response: precomputedResponse || undefined,\n      image_edit_context: imageEditContext,');
detectNode.parameters.jsCode = detectCode;
imageTool.parameters.description = 'Gebruik deze tool voor het maken of bewerken van afbeeldingen. Bij [IMAGE_EDIT_TOOL_REQUIRED] moet je exact de JSON-string na die marker als input doorgeven; die bevat de gebruikersprompt en de bron-image. Verander de image-bron niet. Voor nieuwe afbeeldingen geef je een gewone prompt door. Als de tool JSON teruggeeft, geef uitsluitend de waarde van response als eindantwoord; herhaal image_url, markdown of andere metadata niet.';
agent.parameters = agent.parameters || {};
agent.parameters.text = `={{ (() => { if (typeof $json.precomputed_response === 'string' && $json.precomputed_response.trim()) { return '[FINAL_ANSWER]\\n' + $json.precomputed_response.trim(); } if ($json.image_edit_context) { return '[IMAGE_EDIT_TOOL_REQUIRED]\\n' + JSON.stringify($json.image_edit_context); } const msgs = Array.isArray($json.body?.messages) ? $json.body.messages : (Array.isArray($json.messages) ? $json.messages : []); if (msgs.length) { return msgs.map((m) => { const role = String(m?.role || 'user'); const content = Array.isArray(m?.content) ? m.content.map((part) => { if (!part) return ''; if (typeof part === 'string') return part; const t = String(part.type || '').toLowerCase(); if (t === 'text' || t === 'input_text') return String(part.text || part.content || ''); return ''; }).filter(Boolean).join(' ') : (typeof m?.content === 'string' ? m.content : ''); return '[' + role + '] ' + String(content || '').trim(); }).filter(Boolean).join('\\n'); } return String($json.body?.text || $json.text || $json.body?.prompt || $json.prompt || $json.body?.input || $json.input || ''); })() }}`;
const originalSystem = String(agent.parameters?.options?.systemMessage || '');
const editToolRule = 'When the input begins with [IMAGE_EDIT_TOOL_REQUIRED], call image_generation_tool immediately with the exact JSON string after the marker as its input. Do not ask for the image again. After any image_generation_tool call, if the result is JSON, return only its response field as the final answer; never repeat image_url, markdown, or other image metadata.';
agent.parameters.options = agent.parameters.options || {};
const editRuleStart = originalSystem.indexOf('When the input begins with [IMAGE_EDIT_TOOL_REQUIRED]');
const baseSystem = editRuleStart >= 0 ? originalSystem.slice(0, editRuleStart).trimEnd() : originalSystem;
agent.parameters.options.systemMessage = baseSystem ? baseSystem + ' ' + editToolRule : editToolRule;
saveWorkflow(orchestratorPath, orchestratorBundle.parsed);

console.log('Enabled image-to-image editing for uploaded and previously generated images');
