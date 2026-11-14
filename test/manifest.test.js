'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../plugin.json');
const pkg = require('../package.json');

test('needs an OpenMarket with invoice payloads, plugin secrets and receipt slots (1.22.0)', () => {
  assert.equal(manifest.openmarket, '>=1.22.0 <2');
});

test('the certificate password is a secret setting, so core encrypts it and keeps it out of config', () => {
  const password = manifest.settings.find((/** @type {any} */ s) => s.key === 'certificatePassword');
  assert.equal(password?.secret, true);
  const others = manifest.settings.filter((/** @type {any} */ s) => s.key !== 'certificatePassword');
  assert.ok(others.every((/** @type {any} */ s) => s.secret !== true));
});

test('plugin.json and package.json versions match', () => {
  assert.equal(manifest.version, pkg.version);
});
