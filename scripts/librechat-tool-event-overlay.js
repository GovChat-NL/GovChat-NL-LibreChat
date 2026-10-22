const fs = require('fs');
const Module = require('module');

const REQUIRE_ANCHOR = "const { saveBase64Image } = require('~/server/services/Files/process');";
const CALLBACKS_PATH = '/app/api/server/controllers/agents/callbacks.js';
const INITIALIZE_PATH = '/app/api/server/services/Endpoints/agents/initialize.js';
const MODERN_HANDLER_ANCHOR = `    [GraphEvents.ON_MESSAGE_DELTA]: {
      /**
       * Handle ON_MESSAGE_DELTA event.
       * @param {string} event - The event name.
       * @param {StreamEventData} data - The event data.
       * @param {GraphRunnableConfig['configurable']} [metadata] The runnable metadata.
       */
      handle: async (event, data, metadata) => {
        aggregateContent({ event, data });
        if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
          await emitForJob({ event, data });
        } else if (!metadata?.hide_sequential_outputs) {
          await emitForJob({ event, data });
        }
      },
    },`;
const V087_HANDLER_ANCHOR = `    [GraphEvents.ON_MESSAGE_DELTA]: {
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
    },`;

const REQUIRE_PATCH = `${REQUIRE_ANCHOR}
const { createLibreChatStepEventDecoder } = require('/app/govchat-overlay/librechat-tool-event-protocol');`;
const HANDLER_PATCH = `    [GraphEvents.ON_MESSAGE_DELTA]: {
      /**
       * Decode lifecycle envelopes tunneled through OpenAI-compatible text
       * content. The ordinary text is still aggregated/emitted unchanged.
       */
      handle: async (event, data, metadata) => {
        const delta = data?.delta;
        const content = delta?.content;
        const contentIsArray = Array.isArray(content);
        const incomingParts = contentIsArray
          ? content
          : typeof content === 'string'
            ? [{ type: 'text', text: content }]
            : null;
        if (!incomingParts) {
          aggregateContent({ event, data });
          await emitDecodedMessageDelta(data, metadata);
          return;
        }

        const emitOrdinaryText = async (part, text) => {
          if (!text) return;
          const nextData = {
            ...data,
            delta: {
              ...delta,
              content: contentIsArray ? [{ ...part, text }] : text,
            },
          };
          aggregateContent({ event, data: nextData });
          await emitDecodedMessageDelta(nextData, metadata);
        };

        for (const part of incomingParts) {
          if (part?.type !== 'text' || typeof part.text !== 'string') {
            for (const pending of libreChatStepDecoder.flush()) {
              await emitOrdinaryText({ type: 'text' }, pending.text);
            }
            const nextData = { ...data, delta: { ...delta, content: [part] } };
            aggregateContent({ event, data: nextData });
            await emitDecodedMessageDelta(nextData, metadata);
            continue;
          }

          for (const segment of libreChatStepDecoder.push(part.text)) {
            if (segment.type === 'text') {
              await emitOrdinaryText(part, segment.text);
              continue;
            }
            const eventName = segment.event.event;
            let eventData = segment.event.data;
            if (eventName === GraphEvents.ON_RUN_STEP && streamId) {
              const job = await GenerationJobManager.getJob(streamId).catch(() => null);
              const responseMessageId = job?.metadata?.responseMessageId;
              if (typeof responseMessageId === 'string' && responseMessageId.length > 0) {
                eventData = { ...eventData, runId: responseMessageId };
              }
            }
            const eventHandler = handlers[eventName];
            if (eventHandler?.handle) {
              await eventHandler.handle(eventName, eventData, metadata);
            } else {
              aggregateContent({ event: eventName, data: eventData });
              await emitDecodedStepEvent(eventName, eventData);
            }
          }
        }
      },
    },`;

function patchCallbacksSource(source) {
  source = source.replace(/\r\n/g, '\n');
  if (source.includes("require('/app/govchat-overlay/librechat-tool-event-protocol')")) {
    return source;
  }
  if (!source.includes(REQUIRE_ANCHOR)) {
    throw new Error('LibreChat tool event overlay: callback import anchor not found');
  }
  const handlerAnchor = source.includes(MODERN_HANDLER_ANCHOR)
    ? MODERN_HANDLER_ANCHOR
    : source.includes(V087_HANDLER_ANCHOR)
      ? V087_HANDLER_ANCHOR
      : null;
  if (!handlerAnchor) {
    throw new Error('LibreChat tool event overlay: message delta handler anchor not found');
  }

  const hasContentPartsOption = /\bcontentParts\s*=\s*null/.test(source);
  if (!hasContentPartsOption) {
    const optionsAnchor = `  aggregateContent,
  toolEndCallback,`;
    if (!source.includes(optionsAnchor)) {
      throw new Error('LibreChat tool event overlay: callback options anchor not found');
    }
    source = source.replace(optionsAnchor, `  aggregateContent,
  contentParts = null,
  toolEndCallback,`);
  }

  let patched = source.replace(REQUIRE_ANCHOR, REQUIRE_PATCH);
  const handlersAnchor = '  const handlers = {';
  if (!patched.includes(handlersAnchor)) {
    throw new Error('LibreChat tool event overlay: default handlers anchor not found');
  }
  patched = patched.replace(
    handlersAnchor,
    `  const libreChatStepDecoder = createLibreChatStepEventDecoder();
  let nextLibreChatToolStepIndex = 0;
  const libreChatAssistantSteps = new Map();
  const emitDecodedStepEvent = (event, data) => {
    if (event === 'on_run_step_closed') {
      return Promise.resolve();
    }
    return __EMIT_STEP__;
  };
  const emitDecodedMessageDelta = (data, metadata) => {
    if (checkIfLastAgent(metadata?.last_agent_id, metadata?.langgraph_node)) {
      return __EMIT_DELTA__;
    }
    if (!metadata?.hide_sequential_outputs) {
      return __EMIT_DELTA__;
    }
    return Promise.resolve();
  };
    ${handlersAnchor}`,
  );
  const runStepHandlerAnchor = '    [GraphEvents.ON_RUN_STEP]: {';
  const handlersStart = patched.indexOf(handlersAnchor);
  const runStepHandlerStart = patched.indexOf(runStepHandlerAnchor, handlersStart);
  const runStepHandleStart =
    runStepHandlerStart >= 0 ? patched.indexOf('handle: async', runStepHandlerStart) : -1;
  const runStepBodyStart = runStepHandleStart >= 0 ? patched.indexOf('=> {', runStepHandleStart) + 4 : -1;
  if (runStepHandleStart >= 0 && runStepBodyStart > 3) {
    patched =
      patched.slice(0, runStepBodyStart) +
      `
        if (data?.stepDetails?.type === 'tool_calls') {
          data = { ...data, index: nextLibreChatToolStepIndex++ };
          for (const [stepId, assistantStep] of libreChatAssistantSteps) {
            const shiftedStep = { ...assistantStep, index: nextLibreChatToolStepIndex };
            const previousIndex = assistantStep.index;
            const previousContent = contentParts?.[previousIndex];
            const shiftedContent = contentParts?.[shiftedStep.index];
            if (previousContent && previousIndex !== shiftedStep.index) {
              if (!shiftedContent) {
                contentParts[shiftedStep.index] = previousContent;
                delete contentParts[previousIndex];
              } else if (previousContent.type === 'text' && shiftedContent.type === 'text') {
                contentParts[shiftedStep.index] = {
                  ...shiftedContent,
                  text: (previousContent.text || '') + (shiftedContent.text || ''),
                };
                delete contentParts[previousIndex];
              }
            }
            libreChatAssistantSteps.set(stepId, shiftedStep);
            aggregateContent({ event: GraphEvents.ON_RUN_STEP, data: shiftedStep });
            await emitDecodedStepEvent(GraphEvents.ON_RUN_STEP, shiftedStep);
          }
        } else if (data && typeof data === 'object') {
          data = { ...data, index: Math.max(data.index ?? 0, nextLibreChatToolStepIndex) };
          if (data.id) {
            libreChatAssistantSteps.set(data.id, data);
          }
        }` +
      patched.slice(runStepBodyStart);
  }
  const emitDelta = source.includes('const emitForJob =')
    ? 'emitForJob({ event: GraphEvents.ON_MESSAGE_DELTA, data })'
    : 'emitEvent(res, streamId, { event: GraphEvents.ON_MESSAGE_DELTA, data })';
  const emitStep = source.includes('const emitForJob =')
    ? 'emitForJob({ event, data })'
    : 'emitEvent(res, streamId, { event, data })';
  patched = patched.replace(/__EMIT_DELTA__/g, emitDelta);
  patched = patched.replace('__EMIT_STEP__', emitStep);
  return patched.replace(handlerAnchor, HANDLER_PATCH);
}

function patchInitializeSource(source) {
  source = source.replace(/\r\n/g, '\n');
  const callAnchor = `  const eventHandlers = getDefaultHandlers({
    res,`;
  if (!source.includes(callAnchor)) {
    throw new Error('LibreChat tool event overlay: initialize handlers anchor not found');
  }
  const start = source.indexOf(callAnchor);
  const end = source.indexOf('\n  });', start);
  if (end < 0) {
    throw new Error('LibreChat tool event overlay: initialize handlers options terminator not found');
  }
  const call = source.slice(start, end);
  if (call.includes('contentParts,')) {
    return source;
  }
  const aggregateAnchor = '    aggregateContent,';
  if (!call.includes(aggregateAnchor)) {
    throw new Error('LibreChat tool event overlay: content aggregator option not found');
  }
  const patchedCall = call.replace(aggregateAnchor, `${aggregateAnchor}\n    contentParts,`);
  return source.slice(0, start) + patchedCall + source.slice(end);
}

function installOverlayLoader() {
  const originalLoader = Module._extensions['.js'];
  Module._extensions['.js'] = function loadWithLibreChatToolEventOverlay(mod, filename) {
    if (filename === CALLBACKS_PATH) {
      const source = fs.readFileSync(filename, 'utf8');
      try {
        const patched = patchCallbacksSource(source);
        console.log('[librechat-tool-event-overlay] Loaded callbacks with content sideband decoder');
        return mod._compile(patched, filename);
      } catch (error) {
        console.error(
          '[librechat-tool-event-overlay] Could not patch callbacks; refusing to start with sideband disabled',
          error,
        );
        throw error;
      }
    }
    if (filename === INITIALIZE_PATH) {
      const source = fs.readFileSync(filename, 'utf8');
      try {
        const patched = patchInitializeSource(source);
        console.log('[librechat-tool-event-overlay] Exposed message content parts for tool step indexing');
        return mod._compile(patched, filename);
      } catch (error) {
        console.error(
          '[librechat-tool-event-overlay] Could not patch initialize; refusing to start with sideband disabled',
          error,
        );
        throw error;
      }
    }
    return originalLoader(mod, filename);
  };
}

module.exports = { patchCallbacksSource, patchInitializeSource, installOverlayLoader };
