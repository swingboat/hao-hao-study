import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInlineContentDisposition,
  resolvePdfPreviewPages,
  resolveUploadFilePreview,
} from './upload-file-preview.ts';

test('resolveUploadFilePreview embeds pdf uploads inline', () => {
  assert.deepEqual(
    resolveUploadFilePreview({
      originalName: '高一数学练习.pdf',
      fileType: 'question_pack',
    }),
    {
      kind: 'pdf',
      contentType: 'application/pdf',
      label: 'PDF 预览',
    },
  );
});

test('resolveUploadFilePreview embeds supported image uploads inline', () => {
  assert.deepEqual(
    resolveUploadFilePreview({
      originalName: '教材截图.PNG',
      fileType: 'lesson_handout',
    }),
    {
      kind: 'image',
      contentType: 'image/png',
      label: '图片预览',
    },
  );
});

test('resolveUploadFilePreview falls back to open link for word uploads', () => {
  assert.deepEqual(
    resolveUploadFilePreview({
      originalName: '答案册.docx',
      fileType: 'answer_book',
    }),
    {
      kind: 'open',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      label: '原始文件',
    },
  );
});

test('buildInlineContentDisposition preserves utf-8 filename for browser open', () => {
  assert.equal(
    buildInlineContentDisposition('高一 数学.pdf'),
    'inline; filename="file.pdf"; filename*=UTF-8\'\'%E9%AB%98%E4%B8%80%20%E6%95%B0%E5%AD%A6.pdf',
  );
});

test('resolvePdfPreviewPages uses source document page count for full preview', () => {
  assert.deepEqual(
    resolvePdfPreviewPages({
      pageCount: 4,
      sourcePages: [2, 4],
    }),
    [1, 2, 3, 4],
  );
});

test('resolvePdfPreviewPages falls back to max referenced source page', () => {
  assert.deepEqual(
    resolvePdfPreviewPages({
      pageCount: null,
      sourcePages: [7, undefined, 3, 7],
    }),
    [1, 2, 3, 4, 5, 6, 7],
  );
});
