// 确保 D1 migration 与 Worker 内置的建表语句一致
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCHEMA_SQL } from '../src/schema.js';

const normalize = (sql) =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

test('migrations/0001_init.sql 与 src/schema.js 一致', () => {
  const migration = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
  assert.equal(normalize(migration), normalize(SCHEMA_SQL));
});
