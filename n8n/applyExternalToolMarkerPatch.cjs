const fs = require('fs');
const path = require('path');

const pnpmDir = '/usr/local/lib/node_modules/n8n/node_modules/.pnpm';
const packageDirectories = fs.readdirSync(pnpmDir, { withFileTypes: true });
const packageDirectory = packageDirectories.find(
  (entry) => entry.isDirectory() && entry.name.startsWith('@n8n+n8n-nodes-langchain@'),
);

if (!packageDirectory) {
  throw new Error('Pinned n8n LangChain package was not found');
}

const target = path.join(
  pnpmDir,
  packageDirectory.name,
  'node_modules/@n8n/n8n-nodes-langchain/dist/utils/agent-execution/processEventStream.js',
);
const source = fs.readFileSync(target, 'utf8');
const marker = 'GOVCHAT_EXTERNAL_TOOL';

if (source.includes(marker)) {
  console.log(`[n8n external tool events] Patch already applied: ${target}`);
  process.exit(0);
}

const needle = `                        for (const toolCall of output.tool_calls) {
                            toolCalls.push({
                                tool: toolCall.name,`;
const replacement = `                        for (const toolCall of output.tool_calls) {
                            const id = toolCall.id || \`call_\${Date.now()}_\${toolCalls.length}\`;
                            const toolPayload = JSON.stringify({
                                version: 1,
                                id,
                                name: toolCall.name,
                                arguments: toolCall.args || {},
                            });
                            // The bridge removes this trusted, n8n-generated marker from
                            // assistant content and translates it into a native LibreChat
                            // external-tool lifecycle event for the active response stream.
                            ctx.sendChunk('item', itemIndex, \`<!--GOVCHAT_EXTERNAL_TOOL:\${toolPayload}-->\`);
                            toolCalls.push({
                                tool: toolCall.name,`;

if (!source.includes(needle)) {
  throw new Error(`n8n ${target} does not match the expected 2.25.7 source; refusing to patch`);
}

fs.writeFileSync(target, source.replace(needle, replacement), 'utf8');
console.log(`[n8n external tool events] Patch applied: ${target}`);
