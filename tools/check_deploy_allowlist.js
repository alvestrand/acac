#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function checkDeployAllowlist(repoDir, manifestPath) {
  const deployedFiles = new Set();
  const manualFiles = new Set();
  const errors = [];

  function addManifestEntry(entry, lineNumber) {
    const isManual = entry.startsWith('manual:');
    const file = path.posix.normalize(
      isManual ? entry.slice('manual:'.length) : entry,
    );
    if (
      !file ||
      path.posix.isAbsolute(file) ||
      file === '..' ||
      file.startsWith('../')
    ) {
      errors.push(`Invalid manifest path on line ${lineNumber}: ${entry}`);
      return;
    }
    const entries = isManual ? manualFiles : deployedFiles;
    if (
      entries.has(file) ||
      (isManual ? deployedFiles : manualFiles).has(file)
    ) {
      errors.push(`Duplicate manifest path on line ${lineNumber}: ${file}`);
      return;
    }
    entries.add(file);
  }

  readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const entry = line.replace(/\s+#.*$/, '').trim();
      if (entry && !entry.startsWith('#')) {
        addManifestEntry(entry, index + 1);
      }
    });

  if (!deployedFiles.has('index.html')) {
    errors.push('The manifest must deploy index.html as the site entry point.');
  }
  if (!manualFiles.has('.geni_app_id')) {
    errors.push('The manifest must list .geni_app_id as a manual file.');
  }
  for (const file of manualFiles) {
    if (file !== '.geni_app_id') {
      errors.push(`Unsupported manual deployment file: ${file}`);
    }
  }

  for (const file of deployedFiles) {
    if (!existsSync(path.join(repoDir, file))) {
      errors.push(`Allowlisted file does not exist: ${file}`);
    }
  }

  const allowedFiles = new Set([...deployedFiles, ...manualFiles]);
  const visitedFiles = new Set();
  const referencedFiles = new Set();

  function localPath(fromFile, reference) {
    const ref = reference.split(/[?#]/, 1)[0].trim();
    if (!ref || ref.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(ref)) {
      return undefined;
    }
    const base = ref.startsWith('/') ? '' : path.posix.dirname(fromFile);
    const target = path.posix.normalize(
      path.posix.join(base, ref.replace(/^\/+/, '')),
    );
    if (target === '..' || target.startsWith('../')) {
      errors.push(
        `Reference escapes the repository: ${fromFile} -> ${reference}`,
      );
      return undefined;
    }
    return target;
  }

  function findReferences(file, contents) {
    const refs = [];
    const extension = path.posix.extname(file).toLowerCase();
    if (extension === '.html' || extension === '.htm') {
      for (const match of contents.matchAll(
        /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi,
      )) {
        refs.push(match[1]);
      }
    }
    if (extension === '.js' || extension === '.mjs') {
      for (const match of contents.matchAll(
        /\bimport\s*(?:\(\s*)?["']([^"']+)["']|\bfrom\s*["']([^"']+)["']/g,
      )) {
        const specifier = match[1] ?? match[2];
        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          refs.push(specifier);
        }
      }
      for (const match of contents.matchAll(
        /\bfetch\s*\(\s*["']([^"']+)["']/g,
      )) {
        refs.push(match[1]);
      }
    }
    if (extension === '.css') {
      for (const match of contents.matchAll(
        /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
      )) {
        refs.push(match[1]);
      }
      for (const match of contents.matchAll(/@import\s+["']([^"']+)["']/gi)) {
        refs.push(match[1]);
      }
    }
    return refs;
  }

  function visit(file) {
    if (visitedFiles.has(file)) return;
    visitedFiles.add(file);
    if (!existsSync(path.join(repoDir, file))) {
      errors.push(`Referenced file does not exist: ${file}`);
      return;
    }
    const contents = readFileSync(path.join(repoDir, file), 'utf8');
    for (const reference of findReferences(file, contents)) {
      const target = localPath(file, reference);
      if (!target) continue;
      referencedFiles.add(target);
      if (!allowedFiles.has(target)) {
        errors.push(
          `Referenced file is missing from deploy-manifest.txt: ${target} (from ${file})`,
        );
        continue;
      }
      const extension = path.posix.extname(target).toLowerCase();
      if (['.html', '.htm', '.js', '.mjs', '.css'].includes(extension)) {
        visit(target);
      }
    }
  }

  visit('index.html');
  for (const file of allowedFiles) {
    if (!referencedFiles.has(file) && file !== 'index.html') {
      errors.push(
        `Allowlisted file is not referenced from index.html: ${file}`,
      );
    }
  }

  return {
    errors,
    deployedFiles: deployedFiles.size,
    manualFiles: manualFiles.size,
  };
}

const scriptPath = path.resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const scriptDir = path.dirname(scriptPath);
  const repoDir = path.resolve(process.argv[2] ?? path.join(scriptDir, '..'));
  const manifestPath = path.resolve(
    process.argv[3] ?? path.join(repoDir, 'deploy-manifest.txt'),
  );
  const result = checkDeployAllowlist(repoDir, manifestPath);
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(`Deployment allowlist: ${error}`);
    }
    process.exit(1);
  }
  console.log(
    `Deployment allowlist OK (${result.deployedFiles} deployed files, ${result.manualFiles} manual files).`,
  );
}

export { checkDeployAllowlist };
