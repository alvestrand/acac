import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDeployAllowlist } from './tools/check_deploy_allowlist.js';

const repoDir = path.dirname(fileURLToPath(import.meta.url));
const manifest = path.join(repoDir, 'deploy-manifest.txt');

test('deployment allowlist matches the files referenced by the app', () => {
  const result = checkDeployAllowlist(repoDir, manifest);

  expect(result.errors).toStrictEqual([]);
});

test('deployment checker fails when a referenced file is omitted', () => {
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), 'acac-deploy-allowlist-'),
  );
  const incompleteManifest = path.join(temporaryDirectory, 'manifest.txt');
  const contents = readFileSync(manifest, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== 'index.css')
    .join('\n');
  writeFileSync(incompleteManifest, contents);

  try {
    const result = checkDeployAllowlist(repoDir, incompleteManifest);

    expect(result.errors).toContain(
      'Referenced file is missing from deploy-manifest.txt: index.css (from index.html)',
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
