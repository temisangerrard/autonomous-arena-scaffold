import { createRequire } from 'node:module';

type LogFn = (obj: Record<string, unknown> | string, msg?: string) => void;

export type Logger = {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  debug: LogFn;
  fatal: LogFn;
  child: (bindings: Record<string, unknown>) => Logger;
};

function createLogger(name: string): Logger {
  try {
    const require = createRequire(import.meta.url);
    const pinoModule = require('pino') as Record<string, unknown>;
    const pino = (typeof pinoModule === 'function' ? pinoModule : pinoModule.default) as (opts: Record<string, unknown>) => Logger;

    const isDev = (process.env.NODE_ENV ?? 'development') !== 'production';

    const transport = isDev
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
      : undefined;

    const instance = pino({
      name,
      level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
      ...(transport ? { transport } : {})
    });

    return instance as unknown as Logger;
  } catch {
    return createConsoleLogger(name);
  }
}

function createConsoleLogger(name: string, bindings?: Record<string, unknown>): Logger {
  const prefix = bindings ? { name, ...bindings } : { name };

  const make =
    (level: string, consoleFn: (...args: unknown[]) => void): LogFn =>
    (objOrMsg, msg?) => {
      const ts = new Date().toISOString();
      if (typeof objOrMsg === 'string') {
        consoleFn(JSON.stringify({ ...prefix, level, ts, msg: objOrMsg }));
      } else {
        consoleFn(JSON.stringify({ ...prefix, level, ts, msg: msg ?? '', ...objOrMsg }));
      }
    };

  return {
    info: make('info', console.log),
    warn: make('warn', console.warn),
    error: make('error', console.error),
    debug: make('debug', console.debug),
    fatal: make('fatal', console.error),
    child: (childBindings) => createConsoleLogger(name, { ...bindings, ...childBindings })
  };
}

export const log = createLogger('arena-web');
