const { test } = require('node:test');
const assert = require('node:assert/strict');

const { processEventStream } = require('../scripts/n8n-processEventStream.patched');

test('keeps a tool call open when the model event stream ends before the tool runs', async () => {
  const chunks = [];
  const ctx = {
    sendChunk: (...args) => chunks.push(args),
  };
  const eventStream = (async function* () {
    yield {
      event: 'on_chat_model_end',
      data: {
        output: {
          tool_calls: [
            {
              id: 'call_calc',
              name: 'Calculator',
              args: { input: '1 + 1' },
            },
          ],
        },
      },
    };
  })();

  await processEventStream(ctx, eventStream, 0);

  assert.deepEqual(
    chunks.map(([type]) => type),
    ['begin', 'tool_call', 'end'],
  );
});
