export interface ForgeLogger {
  debug?(message: string, ...args: unknown[]): void;
  info?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const consoleLogger: ForgeLogger = {
  debug: (message, ...args) => console.debug(`[forge] ${message}`, ...args),
  info: (message, ...args) => console.info(`[forge] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[forge] ${message}`, ...args),
  error: (message, ...args) => console.error(`[forge] ${message}`, ...args)
};

let activeLogger: ForgeLogger = consoleLogger;

export function getLogger(): ForgeLogger {
  return activeLogger;
}

export function setLogger(logger: ForgeLogger): void {
  activeLogger = logger;
}

export function createSilentLogger(): ForgeLogger {
  return {
    error() {}
  };
}

export { consoleLogger };
