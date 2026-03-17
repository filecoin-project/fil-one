import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { trace, context } from '@opentelemetry/api';
import {
  NodeTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-node';
import { errorHandlerMiddleware } from './error-handler.js';
import { tracingMiddleware } from './tracing.js';
import { buildEvent, buildMiddyRequest } from '../test/lambda-test-utilities.js';

// ---------------------------------------------------------------------------
// OTel test infrastructure
// ---------------------------------------------------------------------------

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();

beforeEach(() => {
  exporter.reset();
});

function withActiveSpan<T>(
  fn: (span: ReturnType<ReturnType<typeof trace.getTracer>['startSpan']>) => T,
): T {
  const tracer = trace.getTracer('test');
  const span = tracer.startSpan('test-request');
  return context.with(trace.setSpan(context.active(), span), () => fn(span));
}

type ErrorRequest = Request<APIGatewayProxyEventV2, APIGatewayProxyResultV2, Error, Context>;

function buildErrorRequest(error: Error): ErrorRequest {
  return {
    event: buildEvent(),
    context: {} as Context,
    response: undefined,
    error,
    internal: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('errorHandlerMiddleware', () => {
  it('sets a 500 response with a generic error message', async () => {
    const { onError } = errorHandlerMiddleware();
    const request = buildErrorRequest(new Error('db connection failed'));

    await onError!(request);

    expect(request.response).toMatchObject({
      statusCode: 500,
      body: JSON.stringify({
        message: 'An unexpected server error occurred. Please try again later.',
      }),
    });
  });

  it('does not expose the original error message in the response', async () => {
    const { onError } = errorHandlerMiddleware();
    const secret = 'password=hunter2&host=prod-db.internal';
    const request = buildErrorRequest(new Error(secret));

    await onError!(request);

    const body = (request.response as { body: string }).body;
    expect(body).not.toContain(secret);
    expect(body).not.toContain('hunter2');
  });

  it('logs the error message to console.error via logger', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onError } = errorHandlerMiddleware();
    const error = new Error('something broke');
    const request = buildErrorRequest(error);

    await onError!(request);

    expect(spy).toHaveBeenCalledWith('Unhandled handler error', { error: 'something broke' });
    spy.mockRestore();
  });

  it('includes security headers in the response', async () => {
    const { onError } = errorHandlerMiddleware();
    const request = buildErrorRequest(new Error('fail'));

    await onError!(request);

    const headers = (request.response as { headers: Record<string, string> }).headers;
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('overwrites any existing response', async () => {
    const { onError } = errorHandlerMiddleware();
    const request = buildErrorRequest(new Error('fail'));
    request.response = { statusCode: 200, body: '{"ok":true}' };

    await onError!(request);

    expect((request.response as { statusCode: number }).statusCode).toBe(500);
  });

  it('records the exception on the active OTel span', async () => {
    await withActiveSpan(async (span) => {
      const tracing = tracingMiddleware();
      const { onError } = errorHandlerMiddleware();
      const request = buildMiddyRequest(buildEvent());
      request.error = new Error('something broke');

      // tracingMiddleware.before stashes the span
      tracing.before!(request);
      await onError!(request);
      span.end();

      const finished = exporter.getFinishedSpans();
      expect(finished).toHaveLength(1);
      expect(finished[0].events).toHaveLength(1);
      expect(finished[0].events[0].name).toBe('exception');
    });
  });
});
