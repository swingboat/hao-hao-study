/**
 * PDF → 每页 PNG 渲染（pdftoppm 封装）
 *
 * 用 poppler 的 pdftoppm 在 child_process 跑，把 PDF 渲染成每页一张 PNG。返回
 * 内存里的 Buffer 数组；caller 决定是落 storage 还是直接喂 LLM。
 *
 * 依赖：系统 PATH 上有 pdftoppm（macOS: brew install poppler）。缺失会抛
 * PdftoppmMissingError 提示装命令；这与 packages/llm/src/pdf/qpdf.ts 同套路。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export class PdftoppmMissingError extends Error {
  readonly code = 'PDFTOPPM_MISSING';
  constructor() {
    super('pdftoppm not found on PATH. Install poppler (macOS: brew install poppler).');
    this.name = 'PdftoppmMissingError';
  }
}

export class PdftoppmFailedError extends Error {
  readonly code = 'PDFTOPPM_FAILED';
  constructor(
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(`pdftoppm failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
    this.name = 'PdftoppmFailedError';
  }
}

export interface RasterizePdfOptions {
  /** 渲染 DPI；默认 150（PPT 课件够清晰，文件大小可控） */
  dpi?: number;
  /** 只渲指定页范围（含端点）；省略=全本 */
  firstPage?: number;
  lastPage?: number;
}

export interface RasterizedPage {
  /** 1-based 页码 */
  page: number;
  /** PNG 字节 */
  png: Buffer;
  /** 用 pdftoppm 的 -r 参数 */
  dpi: number;
}

/**
 * 把 PDF 全部（或指定页范围）渲染成 PNG。
 *
 * 实现细节：pdftoppm 必须写文件，没法走 stdout（其 `-` 输出只支持单页）。
 * 临时目录里产出后读回 Buffer 再清空。caller 拿到的是纯内存数据。
 */
export async function rasterizePdf(
  pdfPath: string,
  opts: RasterizePdfOptions = {},
): Promise<RasterizedPage[]> {
  const dpi = opts.dpi ?? 150;
  const tmp = await mkdtemp(path.join(tmpdir(), 'hao-llm-rasterize-'));
  try {
    const args: string[] = ['-r', String(dpi), '-png'];
    if (opts.firstPage) args.push('-f', String(opts.firstPage));
    if (opts.lastPage) args.push('-l', String(opts.lastPage));
    args.push(pdfPath, path.join(tmp, 'page'));

    await runPdftoppm(args);

    // pdftoppm 文件名形如 page-1.png / page-01.png / page-001.png（位数取决于总页数）
    const files = (await readdir(tmp))
      .filter((f) => f.startsWith('page-') && f.endsWith('.png'))
      .sort();
    const pages: RasterizedPage[] = [];
    for (const f of files) {
      const num = Number.parseInt(f.slice('page-'.length, -'.png'.length), 10);
      if (Number.isNaN(num)) continue;
      pages.push({ page: num, png: await readFile(path.join(tmp, f)), dpi });
    }
    pages.sort((a, b) => a.page - b.page);
    return pages;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

function runPdftoppm(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const child = spawn('pdftoppm', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    child.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new PdftoppmMissingError());
      } else {
        reject(e);
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new PdftoppmFailedError(stderr, code));
    });
  });
}
