"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processEventStream = processEventStream;
async function processEventStream(ctx, eventStream, itemIndex) {
    const agentResult = {
        output: '',
    };
    const toolCalls = [];
    const emittedToolCallIds = new Set();
    const activeToolCalls = new Map();
    ctx.sendChunk('begin', itemIndex);
    for await (const event of eventStream) {
        switch (event.event) {
            case 'on_chat_model_stream':
                const chunk = event.data?.chunk;
                if (chunk?.content) {
                    const chunkContent = chunk.content;
                    let chunkText = '';
                    if (Array.isArray(chunkContent)) {
                        for (const message of chunkContent) {
                            if (message?.type === 'text') {
                                chunkText += message?.text;
                            }
                        }
                    }
                    else if (typeof chunkContent === 'string') {
                        chunkText = chunkContent;
                    }
                    ctx.sendChunk('item', itemIndex, chunkText);
                    agentResult.output += chunkText;
                }
                break;
            case 'on_chat_model_end':
                if (event.data) {
                    const chatModelData = event.data;
                    const output = chatModelData.output;
                    if (output?.tool_calls && output.tool_calls.length > 0) {
                        for (const toolCall of output.tool_calls) {
                            const normalizedToolCall = {
                                tool: toolCall.name,
                                toolInput: toolCall.args,
                                toolCallId: toolCall.id || 'unknown',
                                type: toolCall.type || 'tool_call',
                                log: output.content ||
                                    `Calling ${toolCall.name} with input: ${JSON.stringify(toolCall.args)}`,
                                messageLog: [output],
                                additionalKwargs: output.additional_kwargs,
                            };
                            toolCalls.push(normalizedToolCall);
                            activeToolCalls.set(normalizedToolCall.toolCallId, normalizedToolCall);
                            if (!emittedToolCallIds.has(normalizedToolCall.toolCallId)) {
                                emittedToolCallIds.add(normalizedToolCall.toolCallId);
                                ctx.sendChunk('tool_call', itemIndex, JSON.stringify({
                                    type: 'tool_call',
                                    id: normalizedToolCall.toolCallId,
                                    name: normalizedToolCall.tool,
                                    arguments: normalizedToolCall.toolInput,
                                }));
                            }
                        }
                    }
                }
                break;
            default:
                break;
        }
    }
    for (const activeToolCall of activeToolCalls.values()) {
        ctx.sendChunk('tool_result', itemIndex, JSON.stringify({
            type: 'tool_result',
            id: activeToolCall.toolCallId,
            name: activeToolCall.tool,
            output: activeToolCall.log || agentResult.output || '',
        }));
    }
    ctx.sendChunk('end', itemIndex);
    if (toolCalls.length > 0) {
        agentResult.toolCalls = toolCalls;
    }
    return agentResult;
}
//# sourceMappingURL=processEventStream.js.map
