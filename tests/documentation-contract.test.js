import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('publishes only documentation useful to users, testers, and maintainers', () => {
  const markdownFiles = fs
    .readdirSync(path.join(root, 'docs'))
    .filter((file) => file.endsWith('.md'))
    .sort();

  assert.deepEqual(markdownFiles, [
    'privacy-policy.md',
    'store-listing.md',
    'tester-guide.md',
    'workout-extension-hardware-test-plan.md',
    'workout-extension-manual-actions.md',
  ]);
});

test('README explains the two products and links their public guides', () => {
  const readme = read('README.md');

  assert.match(readme, /two apps are complementary and can be installed together/i);
  assert.match(readme, /docs\/workout-extension-manual-actions\.md/);
  assert.match(readme, /docs\/workout-extension-hardware-test-plan\.md/);
});

test('README gives the verified Active 2 path for adding Lifto to Strength Training', () => {
  const readme = read('README.md');

  assert.match(
    readme,
    /Workout.*Strength Training.*Settings.*More.*Data Page.*Add Page.*Lifto/is,
  );
  assert.match(readme, /installing.*does not.*add.*data page/is);
});
