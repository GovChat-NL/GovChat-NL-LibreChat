const PREFIX = '\u001eLCSTEP:';
const SUFFIX = '\u001f';
const MAX_ENCODED_EVENT_LENGTH = 256 * 1024;
const ALLOWED_EVENTS = new Set([
  'on_run_step',
  'on_run_step_delta',
  'on_run_step_completed',
  'on_run_step_closed',
]);

function createLibreChatStepEventDecoder() {
  let pending = '';

  return {
    push(value) {
      pending += String(value ?? '');
      const segments = [];

      while (pending.length > 0) {
        const markerStart = pending.indexOf(PREFIX);
        if (markerStart < 0) {
          let keep = 0;
          for (let size = Math.min(PREFIX.length - 1, pending.length); size > 0; size--) {
            if (pending.endsWith(PREFIX.slice(0, size))) {
              keep = size;
              break;
            }
          }
          const text = keep ? pending.slice(0, -keep) : pending;
          if (text) segments.push({ type: 'text', text });
          pending = keep ? pending.slice(-keep) : '';
          break;
        }

        if (markerStart > 0) {
          segments.push({ type: 'text', text: pending.slice(0, markerStart) });
          pending = pending.slice(markerStart);
        }

        const payloadStart = PREFIX.length;
        const markerEnd = pending.indexOf(SUFFIX, payloadStart);
        if (markerEnd < 0) {
          if (pending.length > MAX_ENCODED_EVENT_LENGTH + PREFIX.length) {
            segments.push({ type: 'text', text: pending });
            pending = '';
          }
          break;
        }

        const marker = pending.slice(0, markerEnd + SUFFIX.length);
        const encoded = pending.slice(payloadStart, markerEnd);
        pending = pending.slice(markerEnd + SUFFIX.length);
        try {
          const event = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
          if (
            event &&
            typeof event === 'object' &&
            ALLOWED_EVENTS.has(event.event) &&
            event.data &&
            typeof event.data === 'object' &&
            !Array.isArray(event.data)
          ) {
            segments.push({ type: 'event', event });
            continue;
          }
        } catch {
          // Preserve malformed marker-like content as ordinary text.
        }
        segments.push({ type: 'text', text: marker });
      }

      return segments;
    },

    flush() {
      if (!pending) return [];
      const text = pending;
      pending = '';
      return [{ type: 'text', text }];
    },
  };
}

module.exports = { createLibreChatStepEventDecoder };
