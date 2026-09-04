/**
 * Structured, correlation-aware logger.
 *
 * Every scan gets a request id, and every log line is tagged
 * [STAGE][requestId][providerId] so a developer can reconstruct exactly what
 * happened during a single scan from the console alone.
 *
 * Never log credentials, tokens or personal data.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogStage =
  | 'APP'
  | 'SCAN'
  | 'LOOKUP'
  | 'PROVIDER'
  | 'AGGREGATE'
  | 'PRODUCT'
  | 'CONFIRM'
  | 'PACKAGE_SCAN'
  | 'QUALITY'
  | 'OCR'
  | 'ALLERGEN'
  | 'ASSESSMENT'
  | 'CACHE'
  | 'HTTP';

export interface LogContext {
  readonly requestId?: string;
  readonly providerId?: string;
  readonly [key: string]: unknown;
}

export interface LogEntry {
  readonly level: LogLevel;
  readonly stage: LogStage;
  readonly message: string;
  readonly context?: LogContext;
  readonly timestamp: string;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  readonly minLevel: LogLevel;
  readonly enabled: boolean;
  /** Ring buffer size — powers the development debug panel. */
  readonly bufferSize: number;
}

const CONSOLE_METHOD: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

export class Logger {
  private readonly options: LoggerOptions;
  private readonly buffer: LogEntry[] = [];

  constructor(options: Partial<LoggerOptions> = {}) {
    this.options = {
      minLevel: options.minLevel ?? 'debug',
      enabled: options.enabled ?? true,
      bufferSize: options.bufferSize ?? 300,
    };
  }

  debug(stage: LogStage, message: string, context?: LogContext): void {
    this.log('debug', stage, message, context);
  }
  info(stage: LogStage, message: string, context?: LogContext): void {
    this.log('info', stage, message, context);
  }
  warn(stage: LogStage, message: string, context?: LogContext): void {
    this.log('warn', stage, message, context);
  }
  error(stage: LogStage, message: string, context?: LogContext): void {
    this.log('error', stage, message, context);
  }

  /** Returns the recent log entries (newest last) for the debug panel. */
  getEntries(requestId?: string): readonly LogEntry[] {
    return requestId ? this.buffer.filter((entry) => entry.context?.requestId === requestId) : [...this.buffer];
  }

  clear(): void {
    this.buffer.length = 0;
  }

  private log(level: LogLevel, stage: LogStage, message: string, context?: LogContext): void {
    const entry: LogEntry = { level, stage, message, context, timestamp: new Date().toISOString() };

    this.buffer.push(entry);
    if (this.buffer.length > this.options.bufferSize) this.buffer.shift();

    if (!this.options.enabled || LEVEL_RANK[level] < LEVEL_RANK[this.options.minLevel]) return;

    const tags = [stage, context?.requestId, context?.providerId]
      .filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
      .map((tag) => `[${tag}]`)
      .join('');

    const { requestId: _requestId, providerId: _providerId, ...rest } = context ?? {};
    const hasDetails = Object.keys(rest).length > 0;

    // eslint-disable-next-line no-console
    console[CONSOLE_METHOD[level]](`${tags} ${message}`, ...(hasDetails ? [rest] : []));
  }
}

/** Short, human-readable correlation id for one scan. */
export function createRequestId(): string {
  return Math.random().toString(36).slice(2, 8);
}
