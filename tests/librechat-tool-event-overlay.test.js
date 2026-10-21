const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  patchCallbacksSource,
  patchInitializeSource,
} = require('../scripts/librechat-tool-event-overlay');
const { createLibreChatStepEventDecoder } = require('../scripts/librechat-tool-event-protocol');

test('overlay source patch is valid, idempotent, and routes decoded events through handlers', () => {
  const target = path.resolve(
    __dirname,
    '../../LibreChat/api/server/controllers/agents/callbacks.js',
  );
  const original = fs.readFileSync(target, 'utf8');
  const patched = patchCallbacksSource(original);

  assert.notEqual(patched, original);
  assert.equal(patchCallbacksSource(patched), patched);
  assert.match(patched, /createLibreChatStepEventDecoder\(\)/);
  assert.match(patched, /contentParts = null/);
  assert.match(patched, /typeof content === 'string'/);
  assert.match(patched, /content: contentIsArray \? \[\{ \.\.\.part, text \}\] : text/);
  assert.match(patched, /eventHandler\.handle\(eventName, eventData, metadata\)/);
  assert.match(patched, /emitDecodedStepEvent/);
  assert.match(patched, /if \(event === 'on_run_step_closed'\)/);
  assert.doesNotThrow(() => new Function('require', 'module', 'exports', patched));
});

test('initialize overlay provides message content parts for native run-step indexing', () => {
  const target = path.resolve(
    __dirname,
    '../../LibreChat/api/server/services/Endpoints/agents/initialize.js',
  );
  const original = fs.readFileSync(target, 'utf8');
  const patched = patchInitializeSource(original);

  assert.match(patched, /res,\s+contentParts,\s+stepMap,/);
  assert.equal(patchInitializeSource(patched), patched);
});

test('overlay supports the stock v0.8.7 callback API and its older event emitter', () => {
  const legacyCallbacks = `const { saveBase64Image } = require('~/server/services/Files/process');
function getDefaultHandlers({
  res,
  aggregateContent,
  toolEndCallback,
  collectedUsage,
  streamId = null,
}) {
  const handlers = {
    [GraphEvents.ON_MESSAGE_DELTA]: {
      /**
       * Handle ON_MESSAGE_DELTA event.
       * @param {string} event - The event name.
       * @param {StreamEventData} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: async (event, data, metadata) => {
        aggregateContent({ event, data });
        if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emitEvent(res, streamId, { event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emitEvent(res, streamId, { event, data });
        }
      },
    },
  };
}`;
  const patched = patchCallbacksSource(legacyCallbacks);

  assert.match(patched, /emitEvent\(res, streamId, \{ event, data \}\)/);
  assert.match(patched, /index: Math\.max\(1, contentParts\?\.length \?\? 0, \(eventData\.index \?\? 0\) \+ 1\)/);
  assert.doesNotThrow(() => new Function('require', 'module', 'exports', patched));
});

test('initialize overlay adds contentParts to v0.8.7 handler options', () => {
  const legacyInitialize = `async function initializeClient() {
  const { contentParts, aggregateContent } = createContentAggregator();
  const eventHandlers = getDefaultHandlers({
    res,
    aggregateContent,
    toolEndCallback,
    streamId,
  });
}`;
  const patched = patchInitializeSource(legacyInitialize);

  assert.match(patched, /aggregateContent,\s+contentParts,\s+toolEndCallback/);
  assert.equal(patchInitializeSource(patched), patched);
});

test('mounted overlay protocol strips control frames but returns regular text around them', () => {
  const event = {
    event: 'on_run_step_closed',
    data: { id: 'step-1', status: 'completed' },
  };
  const encoded = `\u001eLCSTEP:${Buffer.from(JSON.stringify(event)).toString('base64url')}\u001f`;
  const decoder = createLibreChatStepEventDecoder();

  assert.deepEqual(decoder.push(`before${encoded}after`), [
    { type: 'text', text: 'before' },
    { type: 'event', event },
    { type: 'text', text: 'after' },
  ]);
});

test('mounted overlay protocol decodes markers split across model text deltas', () => {
  const event = {
    event: 'on_run_step',
    data: { id: 'step-split', status: 'in_progress' },
  };
  const encoded = `\u001eLCSTEP:${Buffer.from(JSON.stringify(event)).toString('base64url')}\u001f`;
  const decoder = createLibreChatStepEventDecoder();
  const split = Math.floor(encoded.length / 2);

  assert.deepEqual(decoder.push(`answer${encoded.slice(0, split)}`), [
    { type: 'text', text: 'answer' },
  ]);
  assert.deepEqual(decoder.push(`${encoded.slice(split)} done`), [
    { type: 'event', event },
    { type: 'text', text: ' done' },
  ]);
});

test('mounted overlay protocol preserves malformed sideband-looking text', () => {
  const decoder = createLibreChatStepEventDecoder();
  const malformed = '\u001eLCSTEP:not-base64-json\u001f';

  assert.deepEqual(decoder.push(malformed), [{ type: 'text', text: malformed }]);
});
