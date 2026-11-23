import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactConfig } from '../src/ocpp.js';

test('la contraseña OCPP no queda en claro en el log ni en GetConfiguration', () => {
  assert.deepEqual(redactConfig({ key: 'AuthorizationKey', value: 'abc123' }), { key: 'AuthorizationKey', value: '***' });
  assert.deepEqual(redactConfig({ key: 'authorizationkey', value: '' }), { key: 'authorizationkey', value: '' });
  assert.deepEqual(redactConfig({ key: 'HeartbeatInterval', value: '300' }), { key: 'HeartbeatInterval', value: '300' });
  const r = redactConfig({ configurationKey: [{ key: 'AuthorizationKey', value: 's3cr3t', readonly: false }, { key: 'HeartbeatInterval', value: '300' }] });
  assert.equal(r.configurationKey[0].value, '***');
  assert.equal(r.configurationKey[1].value, '300');
  assert.equal(redactConfig({ status: 'Accepted' }).status, 'Accepted');
  assert.equal(redactConfig(null), null);
});
