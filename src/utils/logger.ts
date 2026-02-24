import pino from 'pino';

export function createLogger(level: string = 'info') {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.body.fileContent',
        '*.password',
        '*.ssn',
        '*.patientName',
        '*.patientDob',
        '*.dateOfBirth',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
      err: pino.stdSerializers.err,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = pino.Logger;
