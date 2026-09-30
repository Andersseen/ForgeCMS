import assert from 'node:assert/strict';
import test from 'node:test';
import { isHealthyDemoStatus, verifyDemoDeployment } from './verify-demo-deployment.mjs';

const healthy = {
  data: {
    database: 'd1',
    auth: 'users-collection',
    storage: 'r2',
    collections: { pages: 1, services: 8 }
  }
};

test('accepts the complete demo status payload', () => {
  assert.equal(isHealthyDemoStatus(healthy), true);
});

test('rejects successful-looking but incomplete payloads', () => {
  assert.equal(isHealthyDemoStatus({ data: { database: 'd1' } }), false);
  assert.equal(
    isHealthyDemoStatus({
      data: { ...healthy.data, collections: { pages: -1 } }
    }),
    false
  );
});

test('retries a failed deployment and accepts the first healthy response', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? new Response('{}', { status: 500 })
      : Response.json(healthy, { status: 200 });
  };

  await verifyDemoDeployment({ attempts: 2, delayMs: 0, fetchImpl });
  assert.equal(calls, 2);
});

test('fails after the bounded number of attempts', async () => {
  const fetchImpl = async () => new Response('{}', { status: 500 });
  await assert.rejects(
    verifyDemoDeployment({ attempts: 2, delayMs: 0, fetchImpl }),
    /did not become healthy/
  );
});
