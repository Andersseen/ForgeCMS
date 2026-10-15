import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROFILES,
  describeFailure,
  isDemoDeleteRefusal,
  isHealthyDemoStatus,
  isPublicDemoPolicy,
  isHealthyWwwStatus,
  isPopulatedDemoHome,
  isPopulatedDemoSettings,
  verifyDeployment
} from './verify-deployment.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const demoStatus = {
  data: { database: 'd1', auth: 'users-collection', storage: 'r2', mode: 'public', seeded: true }
};
const demoPolicy = {
  data: {
    mode: 'public',
    editable: ['Edit notices'],
    restricted: ['Deleting'],
    remaining: { notice: 20, booking: 50 }
  }
};
const deleteRefusal = { statusCode: 403, data: { code: 'demo_delete_disabled', demo: true } };
const wwwStatus = {
  data: {
    database: { name: 'd1', records: 12 },
    auth: { name: 'users-collection', configured: true },
    storage: { name: 'in-memory', files: 0 },
    api: { version: 'v1', status: 'online' }
  }
};
const settings = { clinicName: 'Lumea', email: 'hello@lumea.test' };
const home = { featuredServices: [{ slug: 'laser' }], settings };

const quiet = { attempts: 2, delayMs: 0, log: () => {} };

test('status validators accept complete payloads and reject partial ones', () => {
  assert.equal(isHealthyDemoStatus(demoStatus), true);
  assert.equal(isHealthyDemoStatus({ data: { database: 'd1' } }), false);
  assert.equal(isHealthyDemoStatus({ data: { ...demoStatus.data, seeded: false } }), false);
  assert.equal(isHealthyDemoStatus({ data: { ...demoStatus.data, mode: 'other' } }), false);
  assert.equal(isPublicDemoPolicy(demoPolicy), true);
  assert.equal(isPublicDemoPolicy({ data: { ...demoPolicy.data, mode: 'full' } }), false);
  // Budget table missing (migration not applied): the endpoint omits `remaining`; that must fail.
  const { remaining: _omitted, ...withoutBudget } = demoPolicy.data;
  assert.equal(isPublicDemoPolicy({ data: withoutBudget }), false);
  assert.equal(isPublicDemoPolicy({ data: { ...withoutBudget, remaining: {} } }), false);
  assert.equal(
    isPublicDemoPolicy({ data: { ...withoutBudget, remaining: { notice: -1 } } }),
    false
  );
  assert.equal(isDemoDeleteRefusal(deleteRefusal), true);
  assert.equal(isDemoDeleteRefusal({ data: { code: 'other' } }), false);
  assert.equal(isHealthyWwwStatus(wwwStatus), true);
  assert.equal(
    isHealthyWwwStatus({ data: { ...wwwStatus.data, api: { status: 'offline' } } }),
    false
  );
});

test('content validators reject an empty shell', () => {
  assert.equal(isPopulatedDemoHome({ data: home }), true);
  assert.equal(isPopulatedDemoHome({ data: { ...home, featuredServices: [] } }), false);
  assert.equal(isPopulatedDemoHome({ data: { ...home, settings: null } }), false);
  assert.equal(isPopulatedDemoSettings({ data: settings }), true);
  assert.equal(isPopulatedDemoSettings({ data: null }), false);
});

test('retries and accepts the first healthy response on every demo endpoint', async () => {
  const seen = [];
  let statusCalls = 0;
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    seen.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/api/status') {
      statusCalls += 1;
      return statusCalls === 1 ? json({ error: 'x' }, 500) : json(demoStatus);
    }
    if (path === '/api/demo-policy') return json(demoPolicy);
    if (init?.method === 'DELETE') return json(deleteRefusal, 403);
    return json({ data: path.endsWith('home') ? home : settings });
  };
  await verifyDeployment({ ...PROFILES.demo, ...quiet, fetchImpl });
  assert.deepEqual(seen, [
    'GET /api/status',
    'GET /api/status',
    'GET /api/demo-policy',
    'GET /api/site/home',
    'GET /api/site/settings',
    'DELETE /api/v1/services/policy-probe'
  ]);
});

test('fails with endpoint, stage and runbook, and stops after a failed status', async () => {
  const lines = [];
  const fetchImpl = async () =>
    json(
      {
        error: {
          code: 'RUNTIME_STARTUP_FAILED',
          message: 'The CMS runtime could not start.',
          details: { stage: 'auth', reason: 'AUTH_SECRET is not set' }
        }
      },
      503
    );
  await assert.rejects(
    verifyDeployment({ ...PROFILES.demo, ...quiet, fetchImpl, log: (l) => lines.push(l) }),
    (error) => {
      assert.match(error.message, /\/api\/status: HTTP 503 RUNTIME_STARTUP_FAILED/);
      assert.match(error.message, /stage=auth — reason=AUTH_SECRET is not set/);
      assert.match(error.message, /DEPLOYMENT-HEALTH\.md/);
      assert.doesNotMatch(error.message, /\/api\/site\/home/);
      return true;
    }
  );
  assert.equal(lines.filter((l) => l.includes('attempt')).length, 2);
});

test('a 200 with an empty shell is a failure', async () => {
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/status') return json(demoStatus);
    if (path === '/api/demo-policy') return json(demoPolicy);
    return json({ data: null });
  };
  await assert.rejects(
    verifyDeployment({ ...PROFILES.demo, ...quiet, fetchImpl }),
    /\/api\/site\/home: HTTP 200 with a payload that failed validation/
  );
});

test('never prints a non-Forge error body', async () => {
  const html = new Response('<html>cf-ray 1234 internal-host secret</html>', {
    status: 500,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
  assert.equal(await describeFailure(html), 'HTTP 500 (text/html)');
  const opaque = json({ statusCode: 500, statusMessage: 'Server Error', stack: 'at secret' }, 500);
  assert.equal(
    await describeFailure(opaque),
    'HTTP 500 Server Error (no Forge diagnostics in body)'
  );
});

test('reports a timeout or network failure by name only', async () => {
  const fetchImpl = async () => {
    throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { name: 'TypeError' });
  };
  await assert.rejects(verifyDeployment({ ...PROFILES.www, ...quiet, fetchImpl }), (error) => {
    assert.match(error.message, /request failed: TypeError/);
    assert.doesNotMatch(error.message, /10\.0\.0\.1/);
    return true;
  });
});
