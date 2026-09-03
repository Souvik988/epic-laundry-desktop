const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktop = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'webapp', 'src', 'App.tsx'), 'utf8');

for (const route of ['/laundry/operations', '/laundry/finance']) {
  assert.ok(desktop.includes(`go('${route}')`), `desktop menu must route to ${route}`);
}

for (const legacyRoute of [
  '/ui/inventory.html', '/ui/purchases.html', '/ui/buying.html', '/ui/manufacturing.html',
  '/ui/projects.html', '/ui/hr.html', '/ui/accounting.html', '/ui/gst.html', '/ui/banking.html',
  '/ui/compliance.html', '/ui/returns.html', '/ui/assets.html', '/ui/ai.html', '/ui/ops.html',
]) {
  assert.ok(!desktop.includes(legacyRoute), `desktop menu must not expose legacy static page ${legacyRoute}`);
}

assert.match(app, /path="operations"/, 'Laundry operations hub must be a first-class route');
assert.match(app, /path="finance"/, 'Laundry finance hub must be a first-class route');
assert.ok(!app.includes('function LegacyErp'), 'generic ERP fallback must not render inside the Laundry application');

console.log('PASS desktop menu routes only to integrated Laundry Desk operations and finance screens');
