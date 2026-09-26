// Shared contract cases (tests/fixtures/project-property.json): the admin tool that writes the property runs the same file against its own checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../settings.js');
const { cases } = require('./fixtures/project-property.json');
for (const c of cases)
  test('project property contract: ' + c.description, () => {
    const r = S.validateProperty(c.value);
    assert.equal(r.ok, c.extension, JSON.stringify(r.errors));
  });
