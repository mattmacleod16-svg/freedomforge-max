/**
 * Server-Sent Events (SSE) formatter for chat streaming.
 * Converts synthesis responses into SSE chunks for progressive rendering.
 */

export interface StreamChunk {
  type: 'token' | 'complete' | 'error';
  data: Record<string, any>;
}

/**
 * Format a chunk as an SSE message
 */
export function formatSSEChunk(chunk: StreamChunk): string {
  if (chunk.type === 'token' || chunk.type === 'complete') {
    return `data: ${JSON.stringify(chunk.data)}\n\n`;
  }
  return `event: error\ndata: ${JSON.stringify(chunk.data)}\n\n`;
}

/**
 * Create a ReadableStream that emits tokens as they're generated
 * This is a placeholder that would be filled by actual token streaming
 * from the synthesis orchestrator.
 */
export function createStreamingResponse(
  onChunks: (emit: (chunk: StreamChunk) => void) => Promise<void>
): Response {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      controller = c;

      try {
        await onChunks((chunk) => {
          if (controller) {
            const formatted = formatSSEChunk(chunk);
            const encoded = new TextEncoder().encode(formatted);
            controller.enqueue(encoded);
          }
        });

        // Final completion
        if (controller) {
          const endChunk = formatSSEChunk({ type: 'complete', data: { done: true } });
          const encoded = new TextEncoder().encode(endChunk);
          controller.enqueue(encoded);
          controller.close();
        }
      } catch (err) {
        if (controller) {
          const errorChunk = formatSSEChunk({
            type: 'error',
            data: {
              error: err instanceof Error ? err.message : 'Unknown error',
            },
          });
          const encoded = new TextEncoder().encode(errorChunk);
          controller.enqueue(encoded);
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
