import type { MiddlewareObj, Request } from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { trace, type Span } from '@opentelemetry/api';

type TracingRequest = Request<
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Error,
  Context,
  Record<string, unknown>
>;

const SPAN_KEY = '__traceSpan';

export function getRequestSpan(request: Pick<TracingRequest, 'internal'>): Span | undefined {
  return request.internal[SPAN_KEY] as Span | undefined;
}

/**
 * Middy middleware that stashes the active OTel span on `request.internal`
 * so downstream middleware (e.g. auth) can add custom attributes.
 *
 * HTTP method/path, response status code, and span error status are already
 * set by the AWS Lambda auto-instrumentation layer — we don't duplicate that.
 * Exception recording is handled by `errorHandlerMiddleware`.
 */
export function tracingMiddleware() {
  const before = (request: TracingRequest): void => {
    const span = trace.getActiveSpan();
    if (!span) return;

    request.internal[SPAN_KEY] = span;
  };

  return { before } satisfies MiddlewareObj<APIGatewayProxyEventV2, APIGatewayProxyResultV2>;
}
