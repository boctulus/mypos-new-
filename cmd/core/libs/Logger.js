import winston from 'winston';
import 'winston-daily-rotate-file';

const { createLogger, format, transports } = winston;
import path from 'path';

const logDir = path.join(process.cwd(), 'logs');

const dailyRotateTransport = new transports.DailyRotateFile({
  dirname: logDir,
  filename: 'application-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d'
});

const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(
      info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`
    )
  ),
  transports: [
    dailyRotateTransport,
    new transports.Console({ format: format.simple() })
  ]
});

export default logger;
