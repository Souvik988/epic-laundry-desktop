const assert = require('node:assert/strict')
const { createPreRestoreSnapshot } = require('./recovery-policy');

(async () => {
  let attempted = false
  await createPreRestoreSnapshot(async (target) => { attempted = target === 'rollback.json' }, 'rollback.json')
  assert.equal(attempted, true, 'pre-restore snapshot writer is invoked before replacement')
  await assert.rejects(
    () => createPreRestoreSnapshot(async () => { throw new Error('disk full') }, 'rollback.json'),
    /restore aborted: safety snapshot could not be saved \(disk full\)/,
    'restore fails closed when rollback snapshot creation fails',
  )
  console.log('PASS restore safety policy self-test complete')
})().catch((error) => { console.error(error); process.exitCode = 1 })
