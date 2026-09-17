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
    'active-2-workout-integration-test.md',
    'privacy-policy.md',
    'store-listing.md',
    'tester-guide.md',
    'timed-sets.md',
    'workout-extension-hardware-test-plan.md',
    'workout-extension-manual-actions.md',
  ]);

  const agentInstructions = read('AGENTS.md');
  assert.match(
    agentInstructions,
    /Pull requests: exactly one commit and one subject per PR; split independent changes into separate branches and PRs\./,
  );
  assert.ok(agentInstructions.split(/\r?\n/).length <= 120, 'AGENTS.md must stay within 120 lines');
});

test('README explains the two products and links their public guides', () => {
  const readme = read('README.md');

  assert.match(readme, /two apps are complementary and can be installed together/i);
  assert.match(readme, /docs\/workout-extension-manual-actions\.md/);
  assert.match(readme, /docs\/workout-extension-hardware-test-plan\.md/);
  assert.match(readme, /silent_jacob/);
  assert.match(readme, /lead tester/i);
  assert.match(readme, /(?:main )?contributor/i);
  assert.match(readme, /https:\/\/www\.reddit\.com\/user\/silent_jacob\//);
});

test('README gives the verified Active 2 path for adding Lifto to Strength Training', () => {
  const readme = read('README.md');

  assert.match(
    readme,
    /Workout.*Strength Training.*Settings.*More.*Data Page.*Add Page.*Lifto/is,
  );
  assert.match(readme, /installing.*does not.*add.*data page/is);
});

test('GitHub Issues and Project own the work backlog', () => {
  assert.equal(fs.existsSync(path.join(root, 'TODO.md')), false);

  const agents = read('AGENTS.md');
  assert.match(agents, /github\.com\/users\/PreciselyWrong\/projects\/1/i);
  assert.match(agents, /only backlog/i);
  assert.match(agents, /set `In Progress` when work starts/i);
  assert.match(agents, /close the issue, and confirm `Done`/i);

  const forms = [
    ['bug.yml', 'bug'],
    ['improvement.yml', 'enhancement'],
    ['idea.yml', 'idea'],
  ];
  for (const [file, label] of forms) {
    const form = read(path.join('.github', 'ISSUE_TEMPLATE', file));
    assert.match(form, /^projects: \["PreciselyWrong\/1"\]$/m);
    assert.match(form, new RegExp(`^labels: \\["${label}"\\]$`, 'm'));
    assert.match(form, /^body:$/m);
  }

  const config = read(path.join('.github', 'ISSUE_TEMPLATE', 'config.yml'));
  assert.match(config, /^blank_issues_enabled: false$/m);
});
