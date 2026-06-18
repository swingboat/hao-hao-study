import assert from 'node:assert/strict';
import test from 'node:test';
import { contentTypeForStorageKey, isAllowedStorageReadKey } from './storage-route';

test('only allows derived storage keys for student web reads', () => {
  assert.equal(isAllowedStorageReadKey('derived/source/figure-crop-v1/question-1.png'), true);
  assert.equal(isAllowedStorageReadKey('uploads/source.pdf'), false);
  assert.equal(isAllowedStorageReadKey('/derived/source/figure.png'), false);
  assert.equal(isAllowedStorageReadKey('derived/../uploads/source.pdf'), false);
});

test('detects image content types by storage key extension', () => {
  assert.equal(contentTypeForStorageKey('derived/a/figure.png'), 'image/png');
  assert.equal(contentTypeForStorageKey('derived/a/figure.JPG'), 'image/jpeg');
  assert.equal(contentTypeForStorageKey('derived/a/figure.webp'), 'image/webp');
  assert.equal(contentTypeForStorageKey('derived/a/figure.bin'), 'application/octet-stream');
});
