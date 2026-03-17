import { describe, it, expect } from 'vitest';
import { trace, context } from '@opentelemetry/api';
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-node';
import { buildEvent, buildMiddyRequest } from '../test/lambda-test-utilities.js';
import { tracingMiddleware, getRequestSpan } from './tracing.js';

// ---------------------------------------------------------------------------
// OTel test infrastructure
// ---------------------------------------------------------------------------

const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
});
provider.register();

function withActiveSpan<T>(
  fn: (span: ReturnType<ReturnType<typeof trace.getTracer>['startSpan']>) => T,
): T {
  const tracer = trace.getTracer('test');
  const span = tracer.startSpan('test-request');
  return context.with(trace.setSpan(context.active(), span), () => fn(span));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tracingMiddleware', () => {
  it('stores span reference accessible via getRequestSpan', () => {
    withActiveSpan((span) => {
      const { before } = tracingMiddleware();
      const request = buildMiddyRequest(buildEvent());

      before!(request);

      expect(getRequestSpan(request)).toBe(span);
    });
  });

  it('handles missing active span gracefully', () => {
    const { before } = tracingMiddleware();
    const request = buildMiddyRequest(buildEvent());

    before!(request);

    expect(getRequestSpan(request)).toBeUndefined();
  });
});
