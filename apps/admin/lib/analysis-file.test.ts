import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStoredAnalysisFile } from './analysis-file.ts';

test('buildStoredAnalysisFile sends PDF bytes as base64 data for LLM parsing', () => {
  const bytes = Buffer.from('%PDF-test');

  const file = buildStoredAnalysisFile({
    bytes,
    name: '教材.pdf',
    path: '/tmp/book.pdf',
    mimeType: 'application/pdf',
  });

  assert.equal(file.type, 'pdf');
  assert.equal(file.name, '教材.pdf');
  assert.equal(file.mimeType, 'application/pdf');
  assert.equal(file.path, '/tmp/book.pdf');
  assert.equal(file.data, bytes.toString('base64'));
});

test('buildStoredAnalysisFile keeps Word documents path-based', () => {
  const file = buildStoredAnalysisFile({
    bytes: Buffer.from('docx'),
    name: '试卷.docx',
    path: '/tmp/paper.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  assert.equal(file.type, 'word');
  assert.equal(file.path, '/tmp/paper.docx');
  assert.equal(file.data, undefined);
});
