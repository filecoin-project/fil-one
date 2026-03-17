import type { MiddlewareObj, Request } from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import type { ErrorResponse } from '@filone/shared';
import { logger } from '../lib/logger.js';
import { ResponseBuilder } from '../lib/response-builder.js';
import { getRequestSpan } from './tracing.js';

export function errorHandlerMiddleware(): MiddlewareObj<
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2
> {
  const onError = async (
    request: Request<APIGatewayProxyEventV2, APIGatewayProxyResultV2, Error, Context>,
  ): Promise<void> => {
    // Log the full error internally — never expose details to the caller
    logger.error('Unhandled handler error', { error: request.error?.message ?? String(request.error) });

    if (request.error) {
      getRequestSpan(request)?.recordException(request.error);
    }

    request.response = new ResponseBuilder()
      .status(500)
      .body<ErrorResponse>({
        message: 'An unexpected server error occurred. Please try again later.',
      })
      .build();
  };

  return { onError };
}
