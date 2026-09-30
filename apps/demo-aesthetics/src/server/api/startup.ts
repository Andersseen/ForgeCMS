import { isSchemaDriftError } from '@forge-cms/db';

/**
 * Safe startup diagnostics (spec 075). A deployment whose runtime cannot start stays broken — every
 * API route still fails, `AUTH_SECRET` stays mandatory (spec 069) — but `/api/status` names *which*
 * stage failed and why in words that carry no secret, database id, SQL or stack trace. The full error
 * goes only to the server log (`wrangler pages deployment tail`).
 */
export type StartupStage = 'auth' | 'configuration' | 'database' | 'seed';

export const STARTUP_RUNBOOK =
  'https://github.com/Andersseen/ForgeCMS/blob/main/docs/DEPLOYMENT-HEALTH.md';

export class RuntimeStartupError extends Error {
  constructor(
    readonly stage: StartupStage,
    readonly reason: string,
    options: { cause: unknown }
  ) {
    super(`ForgeCMS runtime startup failed (${stage}): ${reason}`, options);
    this.name = 'RuntimeStartupError';
  }
}

function classify(stage: StartupStage, error: unknown): { stage: StartupStage; reason: string } {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('AUTH_SECRET is too short')) {
    return { stage: 'auth', reason: 'AUTH_SECRET is shorter than 32 bytes' };
  }
  if (message.includes('requires AUTH_SECRET')) {
    return { stage: 'auth', reason: 'AUTH_SECRET is not set' };
  }
  if (isSchemaDriftError(error)) {
    return {
      stage: 'database',
      reason: 'blocking schema drift: back up, run planSchema() and a reviewed migration'
    };
  }
  const generic: Record<StartupStage, string> = {
    auth: 'the auth adapter could not initialize',
    configuration: 'the CMS configuration is invalid',
    database: 'the database could not be prepared',
    seed: 'the initial content could not be written'
  };
  return { stage, reason: generic[stage] };
}

/** Runs one startup stage, rethrowing any failure as a classified {@link RuntimeStartupError}. */
export async function startupStage<T>(stage: StartupStage, run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof RuntimeStartupError) throw error;
    const classified = classify(stage, error);
    throw new RuntimeStartupError(classified.stage, classified.reason, { cause: error });
  }
}

/** Operator log line: the classified stage plus the original message (never a secret value). */
export function logStartupFailure(error: unknown): void {
  const cause = error instanceof RuntimeStartupError ? error.cause : error;
  const detail = cause instanceof Error ? cause.message : String(cause);
  const summary = error instanceof Error ? error.message : 'ForgeCMS runtime startup failed';
  console.error(`${summary}\n${detail}`);
}

/** The `/api/status` body for a runtime that could not start. */
export function startupFailureBody(error: unknown) {
  const failure =
    error instanceof RuntimeStartupError
      ? { stage: error.stage, reason: error.reason }
      : { stage: 'configuration' as const, reason: 'the runtime could not start' };
  return {
    error: {
      code: 'RUNTIME_STARTUP_FAILED',
      message: 'The CMS runtime could not start.',
      details: { ...failure, runbook: STARTUP_RUNBOOK }
    }
  };
}
