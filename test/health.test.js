const { test } = require('node:test');
const assert = require('node:assert/strict');
const health = require('../api/health');

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.body = obj; return res; };
  return res;
}

test('POST /api/health: correct password returns 200 {ok:true}, no data leaked', () => {
  process.env.TREASURER_PASSWORD = 'letmein';
  const res = mockRes();
  health({ method: 'POST', body: { password: 'letmein' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('POST /api/health: wrong password returns 401', () => {
  process.env.TREASURER_PASSWORD = 'letmein';
  const res = mockRes();
  health({ method: 'POST', body: { password: 'nope' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('POST /api/health: missing password returns 401', () => {
  process.env.TREASURER_PASSWORD = 'letmein';
  const res = mockRes();
  health({ method: 'POST', body: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('GET /api/health: unchanged behaviour, reports env booleans not values', () => {
  process.env.TREASURER_PASSWORD = 'letmein';
  const res = mockRes();
  health({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.env.treasurer_password_set, true);
  assert.equal(JSON.stringify(res.body).includes('letmein'), false);
});
