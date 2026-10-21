import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../scripts/provision-azure.sh', import.meta.url));
const repo = 'anthonyplusAI/twilio-voice-ai';

function previewSubject(settings, orgClaims = '') {
  const dir = mkdtempSync(join(tmpdir(), 'workshop-oidc-test-'));
  const gh = join(dir, 'gh');
  writeFileSync(gh, `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  repo) printf '%s\\n' "$MOCK_REPO" ;;
  api)
    case "$2" in
      repos/*) printf '%s\\n' "$MOCK_SETTINGS" ;;
      orgs/*) printf '%s\\n' "$MOCK_ORG_CLAIMS" ;;
      *) exit 2 ;;
    esac
    ;;
  *) exit 2 ;;
esac
`);
  chmodSync(gh, 0o755);
  try {
    return spawnSync(script, ['--print-oidc-subject'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        MOCK_REPO: repo,
        MOCK_SETTINGS: settings,
        MOCK_ORG_CLAIMS: orgClaims,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('uses GitHub immutable OIDC prefix for the main branch', () => {
  const result = previewSubject(
    'true|true|repo:anthonyplusAI@26190505/twilio-voice-ai@1196611799|',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    'repo:anthonyplusAI@26190505/twilio-voice-ai@1196611799:ref:refs/heads/main',
  );
});

test('uses the reported prefix even when immutable opt-in is false', () => {
  const result = previewSubject('true|false|repo:anthonyplusAI@26190505/twilio-voice-ai@1196611799|');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /anthonyplusAI@26190505\/twilio-voice-ai@1196611799:ref:refs\/heads\/main/);
});

test('falls back to the legacy default when GitHub reports no prefix', () => {
  const result = previewSubject('true|false||');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `repo:${repo}:ref:refs/heads/main`);
});

test('supports a custom repo/context template inherited from an organization', () => {
  const result = previewSubject('false|true|repo:anthonyplusAI@26190505/twilio-voice-ai@1196611799|', 'repo,context');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    'repo:anthonyplusAI@26190505/twilio-voice-ai@1196611799:ref:refs/heads/main',
  );
});

test('rejects a custom subject template it cannot derive', () => {
  const result = previewSubject('false|false|repo:anthonyplusAI/twilio-voice-ai|repo,job_workflow_ref');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Custom GitHub OIDC claims/);
});

test('rejects missing prefix when GitHub enables immutable subjects', () => {
  const result = previewSubject('true|true||');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /returned no prefix/);
});
