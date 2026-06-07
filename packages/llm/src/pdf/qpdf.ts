/**
 * qpdf 命令封装 —— PDF 页数读取 + 按页范围切片。
 *
 * v0.1 用系统命令 qpdf（理由：示例 / 探针实测稳定，跨平台统一行为，体积小）。
 * 部署环境必须预装 qpdf：
 *   macOS:  brew install qpdf
 *   Linux:  apt-get install qpdf  /  apk add qpdf
 *   Docker: 在镜像层装 qpdf 包
 *
 * 失败时给 actionable 错误（提示如何装），让运营调试更顺。
 */
import { spawn } from 'node:child_process';

export class QpdfMissingError extends Error {
  override readonly name = 'QpdfMissingError';
  constructor() {
    super(
      'qpdf command not found. Install it first:\n  macOS:  brew install qpdf\n  Linux:  apt-get install qpdf  (or apk add qpdf)\n  Docker: add qpdf to base image',
    );
  }
}

export class QpdfFailedError extends Error {
  override readonly name = 'QpdfFailedError';
  constructor(
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(`qpdf exited with ${exitCode}: ${stderr.slice(0, 500)}`);
  }
}

function runQpdf(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('qpdf', args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      // ENOENT 时给装机指引；其它原始 error
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') reject(new QpdfMissingError());
      else reject(err);
    });
    child.on('close', (exitCode) => {
      if (exitCode === 0) resolve(stdout);
      else reject(new QpdfFailedError(exitCode, stderr || stdout));
    });
  });
}

/** 取 PDF 页数。失败抛 Qpdf*Error。 */
export async function getPdfPageCount(pdfPath: string): Promise<number> {
  const out = await runQpdf(['--show-npages', pdfPath]);
  const n = Number(out.trim());
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`qpdf --show-npages returned non-integer: ${out}`);
  }
  return n;
}

/** 把 [startPage, endPage] 切到 chunkPath（包含两端）。 */
export async function extractPdfChunk(opts: {
  pdfPath: string;
  chunkPath: string;
  startPage: number;
  endPage: number;
}): Promise<void> {
  await runQpdf([
    '--empty',
    '--pages',
    opts.pdfPath,
    `${opts.startPage}-${opts.endPage}`,
    '--',
    opts.chunkPath,
  ]);
}

/**
 * 把 [1, pageCount] 切成 N 个 [start, end] 段，每段最多 chunkPages 页。
 *
 * 与 example `claude-opus-pdf-example.mjs::buildPageRanges` 等价（page 从 1 起，闭区间）。
 */
export function buildPageRanges(
  pageCount: number,
  chunkPages = 15,
): Array<{ start: number; end: number }> {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(`pageCount must be a positive integer, got ${pageCount}`);
  }
  if (!Number.isInteger(chunkPages) || chunkPages < 1) {
    throw new Error(`chunkPages must be a positive integer, got ${chunkPages}`);
  }
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 1; start <= pageCount; start += chunkPages) {
    ranges.push({ start, end: Math.min(start + chunkPages - 1, pageCount) });
  }
  return ranges;
}
