import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const otelLogger = logs.getLogger('filone');

type LogData = Record<string, unknown>;

function emit(
  severityNumber: SeverityNumber,
  severityText: string,
  message: string,
  data?: LogData,
) {
  otelLogger.emit({
    severityNumber,
    severityText,
    body: message,
    attributes: data,
  });
}

export const logger = {
  info(message: string, data?: LogData) {
    emit(SeverityNumber.INFO, 'INFO', message, data);
    console.log(message, data !== undefined ? data : '');
  },

  warn(message: string, data?: LogData) {
    emit(SeverityNumber.WARN, 'WARN', message, data);
    console.warn(message, data !== undefined ? data : '');
  },

  error(message: string, data?: LogData) {
    emit(SeverityNumber.ERROR, 'ERROR', message, data);
    console.error(message, data !== undefined ? data : '');
  },
};
