import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type CreateQuestionFigureCropAssetsInput,
  type FigureBbox,
  type FigureCropAssetRecord,
  type RenderedPagePng,
  buildQuestionFigureCropRecord,
} from './figure-crop-core';

export {
  FIGURE_CROP_PROCESSOR,
  FIGURE_CROP_VERSION,
  buildQuestionFigureAssetKey,
  buildQuestionFigureCropRecord,
} from './figure-crop-core';
export type {
  BuildQuestionFigureCropRecordInput,
  CreateQuestionFigureCropAssetsInput,
  FigureBbox,
  FigureCropAssetRecord,
  FigureCropMetadata,
  QuestionFigure,
  RenderedPagePng,
} from './figure-crop-core';

export async function createQuestionFigureCropAssets(
  input: CreateQuestionFigureCropAssetsInput,
): Promise<FigureCropAssetRecord[]> {
  const renderPage = input.renderPage ?? renderPdfPageToPng;
  const cropPage =
    input.cropPage ??
    (({ page, bbox }: { page: RenderedPagePng; bbox: FigureBbox }) =>
      cropPngByPercentBbox(page.png, bbox));
  const dpi = input.dpi ?? 180;
  const pageCache = new Map<number, Promise<RenderedPagePng>>();
  const records: FigureCropAssetRecord[] = [];

  for (const rawFigure of input.figures) {
    let record: FigureCropAssetRecord;
    try {
      record = buildQuestionFigureCropRecord({
        sourceSha256: input.sourceSha256,
        publishedQuestionId: input.publishedQuestionId,
        figure: rawFigure,
      });
    } catch {
      continue;
    }

    const pagePromise =
      pageCache.get(record.metadata.source_page) ??
      renderPage({
        sourcePdf: input.sourcePdf,
        pageNumber: record.metadata.source_page,
        dpi,
      });
    pageCache.set(record.metadata.source_page, pagePromise);

    const page = await pagePromise;
    const png = await cropPage({ page, bbox: record.metadata.bbox });
    await input.store.put(record.storage_path, png, { contentType: 'image/png' });
    records.push({ ...record, size_bytes: png.length });
  }

  return records;
}

export async function renderPdfPageToPng({
  sourcePdf,
  pageNumber,
  dpi = 180,
}: {
  sourcePdf: Buffer;
  pageNumber: number;
  dpi?: number;
}): Promise<RenderedPagePng> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'hao-figure-crop-'));
  const sourcePath = path.join(workDir, 'source.pdf');
  const outputPrefix = path.join(workDir, 'page');

  try {
    await writeFile(sourcePath, sourcePdf);
    const command = await firstWorkingCommand([
      'pdftoppm',
      '/opt/homebrew/bin/pdftoppm',
      '/usr/local/bin/pdftoppm',
    ]);
    await runCommand(command, [
      '-f',
      String(pageNumber),
      '-l',
      String(pageNumber),
      '-png',
      '-r',
      String(dpi),
      sourcePath,
      outputPrefix,
    ]);
    const file = (await readdir(workDir)).filter((entry) => entry.endsWith('.png')).sort()[0];
    if (!file) throw new Error(`pdftoppm did not render page ${pageNumber}`);
    return {
      pageNumber,
      png: await readFile(path.join(workDir, file)),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function cropPngByPercentBbox(png: Buffer, bbox: FigureBbox): Promise<Buffer> {
  const sharpModule = await import(/* webpackIgnore: true */ 'sharp');
  const sharp = sharpModule.default;
  const image = sharp(png);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error('image dimensions are required');

  const region = percentBboxToPixelRegion(bbox, metadata.width, metadata.height);
  return image.extract(region).png().toBuffer();
}

function percentBboxToPixelRegion(bbox: FigureBbox, imageWidth: number, imageHeight: number) {
  const left = clampNumber(Math.floor((bbox.x / 100) * imageWidth), 0, imageWidth - 1);
  const top = clampNumber(Math.floor((bbox.y / 100) * imageHeight), 0, imageHeight - 1);
  const right = clampNumber(
    Math.ceil(((bbox.x + bbox.width) / 100) * imageWidth),
    left + 1,
    imageWidth,
  );
  const bottom = clampNumber(
    Math.ceil(((bbox.y + bbox.height) / 100) * imageHeight),
    top + 1,
    imageHeight,
  );

  return {
    left: Math.trunc(left),
    top: Math.trunc(top),
    width: Math.trunc(right - left),
    height: Math.trunc(bottom - top),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function firstWorkingCommand(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await runCommand(candidate, ['-v']);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(`pdftoppm not found. Tried: ${candidates.join(', ')}`);
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? 'null'}`));
      }
    });
  });
}
