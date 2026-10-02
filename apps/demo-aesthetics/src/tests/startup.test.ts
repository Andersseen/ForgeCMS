import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerRuntime } from '../server/api/runtime';
import {
  RuntimeStartupError,
  startupFailureBody,
  startupStage,
  STARTUP_RUNBOOK
} from '../server/api/startup';

/**
 * Spec 075: a runtime that cannot start stays a hard failure (spec 069), but `/api/status` can say
 * which stage failed without exposing the secret, and a fixed deployment recovers on the next request.
 */
describe('runtime startup diagnostics', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('classifies a short AUTH_SECRET as the auth stage and never echoes it', async () => {
    const shortSecret = 'short-secret-value';
    const error = await getServerRuntime({ AUTH_SECRET: shortSecret }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RuntimeStartupError);
    expect(error).toMatchObject({ stage: 'auth', reason: 'AUTH_SECRET is shorter than 32 bytes' });

    const body = startupFailureBody(error);
    expect(body.error.code).toBe('RUNTIME_STARTUP_FAILED');
    expect(body.error.details).toEqual({
      stage: 'auth',
      reason: 'AUTH_SECRET is shorter than 32 bytes',
      runbook: STARTUP_RUNBOOK
    });
    expect(JSON.stringify(body)).not.toContain(shortSecret);
  });

  it('does not cache a failed startup: the next request starts cleanly', async () => {
    await expect(getServerRuntime({})).rejects.toMatchObject({
      stage: 'auth',
      reason: 'AUTH_SECRET is not set'
    });
    const runtime = await getServerRuntime({ AUTH_SECRET: 'x'.repeat(48) });
    expect(runtime.getCollections().length).toBeGreaterThan(0);
  });

  it('gives a generic, message-free reason for other failures', async () => {
    const error = await startupStage('seed', () => {
      throw new Error('D1_ERROR: no such table: secret_internal_name');
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      stage: 'seed',
      reason: 'the initial content could not be written'
    });
    expect(JSON.stringify(startupFailureBody(error))).not.toContain('secret_internal_name');
  });
});
