#!/usr/bin/env tsx
/**
 * 探针 v2：layout 检测 + slide 切片
 *
 * 思路（多策略，不能写死）：
 *   1. 用 probe v1 已验证的 bbox 聚类，判断"页内大块图形/文本框的横纵分布"
 *   2. 启发式判定 layout：
 *      - single：1 个占满页的大块 → 一页一 slide（原生 PowerPoint→PDF）
 *      - 2-up-h：2 个左右等宽大块 → 横向 2 slide（当前用户的 handout）
 *      - 2-up-v：2 个上下等高大块 → 纵向 2 slide
 *      - 3-up / 6-up：按聚类数量进一步判
 *      - unknown：兜底走 single（整页 = 一张图）
 *   3. 按检出的 layout 切 slide PNG：pdftoppm 出整页 → sharp 切矩形
 *
 * 用法：pnpm exec tsx scripts/probe-slide-split.ts <pdf-path> [page1,page2,...]
 *       默认探测全 PDF。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PDF_PATH = process.argv[2];
const PAGES_ARG = process.argv[3];
if (!PDF_PATH) {
  console.error('Usage: pnpm exec tsx scripts/probe-slide-split.ts <pdf-path> [page1,page2,...]');
  process.exit(1);
}

const RUN_ID = new Date().toISOString().replace(/[.:]/g, '-').replace('Z', '');
const OUTPUT_DIR = path.join(REPO_ROOT, `results/probe-slide-split/${RUN_ID}`);
const SLIDES_DIR = path.join(OUTPUT_DIR, 'slides');
const PAGES_DIR = path.join(OUTPUT_DIR, 'pages');
const DPI = 150;

// ─────────────────────────────────────────────────────────────────
// Layout 检测：基于 bbox cluster

type Bbox = [number, number, number, number]; // 归一化 [x1,y1,x2,y2]，左上原点
interface Cluster {
  normBbox: Bbox;
}
type LayoutKind =
  | 'single'
  | '2-up-h' // 左右两栏（横向 2-up）
  | '2-up-v' // 上下两栏
  | 'n-up'
  | 'unknown';

interface Layout {
  kind: LayoutKind;
  slides: Array<{
    slot: string; // "single" | "left" | "right" | "top" | "bottom" | "r1c1"...
    /** 在整页 PNG 上的裁切区域（归一化 [0..1]，左上原点） */
    crop: Bbox;
  }>;
  /** 触发该判定的特征值，便于人工 review */
  signals: Record<string, unknown>;
}

function detectLayout(clusters: Cluster[], pageAspect: number): Layout {
  if (clusters.length === 0) {
    return {
      kind: 'unknown',
      slides: [{ slot: 'single', crop: [0, 0, 1, 1] }],
      signals: { reason: 'no clusters' },
    };
  }

  // 1) 看是否有一个 cluster ≥ 80% 页面 → single
  const big = clusters.find((c) => area(c.normBbox) >= 0.8);
  if (big) {
    return {
      kind: 'single',
      slides: [{ slot: 'single', crop: [0, 0, 1, 1] }],
      signals: { reason: 'one cluster covers >=80%', area: area(big.normBbox) },
    };
  }

  // 2) 2-up 横向：恰好 2 个 cluster，y 范围都覆盖大部分页面（高 > 0.7），x 一左一右
  if (clusters.length === 2) {
    const [a, b] = [...clusters].sort((p, q) => p.normBbox[0] - q.normBbox[0]);
    const aH = a.normBbox[3] - a.normBbox[1];
    const bH = b.normBbox[3] - b.normBbox[1];
    const aW = a.normBbox[2] - a.normBbox[0];
    const bW = b.normBbox[2] - b.normBbox[0];
    const xGap = b.normBbox[0] - a.normBbox[2];
    if (aH > 0.7 && bH > 0.7 && aW < 0.55 && bW < 0.55 && a.normBbox[2] < 0.55 && b.normBbox[0] > 0.45) {
      return {
        kind: '2-up-h',
        slides: [
          { slot: 'left', crop: [0, 0, 0.5, 1] },
          { slot: 'right', crop: [0.5, 0, 1, 1] },
        ],
        signals: { reason: '2 tall side-by-side clusters', xGap, aH, bH, pageAspect },
      };
    }
    // 上下 2-up
    const [t, b2] = [...clusters].sort((p, q) => p.normBbox[1] - q.normBbox[1]);
    const tW = t.normBbox[2] - t.normBbox[0];
    const bW2 = b2.normBbox[2] - b2.normBbox[0];
    const tH = t.normBbox[3] - t.normBbox[1];
    const bH2 = b2.normBbox[3] - b2.normBbox[1];
    if (tW > 0.7 && bW2 > 0.7 && tH < 0.55 && bH2 < 0.55) {
      return {
        kind: '2-up-v',
        slides: [
          { slot: 'top', crop: [0, 0, 1, 0.5] },
          { slot: 'bottom', crop: [0, 0.5, 1, 1] },
        ],
        signals: { reason: '2 wide stacked clusters' },
      };
    }
  }

  // 3) n-up grid：按 cluster 中心点聚类 row × col
  if (clusters.length >= 3 && clusters.length <= 9) {
    const grid = guessGrid(clusters);
    if (grid) {
      const slides = grid.cells.map((c, i) => ({
        slot: `r${c.row + 1}c${c.col + 1}`,
        crop: c.crop,
      }));
      return {
        kind: 'n-up',
        slides,
        signals: { reason: `grid ${grid.rows}×${grid.cols}`, clusterCount: clusters.length },
      };
    }
  }

  // 4) 兜底
  return {
    kind: 'unknown',
    slides: [{ slot: 'single', crop: [0, 0, 1, 1] }],
    signals: { reason: 'fallback', clusterCount: clusters.length },
  };
}

function area(b: Bbox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

/** 把 cluster 中心按 1D-聚类到行和列，返回均分网格 */
function guessGrid(clusters: Cluster[]): {
  rows: number;
  cols: number;
  cells: Array<{ row: number; col: number; crop: Bbox }>;
} | null {
  const centers = clusters.map((c) => ({
    x: (c.normBbox[0] + c.normBbox[2]) / 2,
    y: (c.normBbox[1] + c.normBbox[3]) / 2,
  }));
  const rowGroups = oneDimCluster(centers.map((c) => c.y), 0.1).sort((a, b) => a.value - b.value);
  const colGroups = oneDimCluster(centers.map((c) => c.x), 0.1).sort((a, b) => a.value - b.value);
  const rows = rowGroups.length;
  const cols = colGroups.length;
  if (rows * cols !== clusters.length || rows > 4 || cols > 4) return null;
  const cells: Array<{ row: number; col: number; crop: Bbox }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        row: r,
        col: c,
        crop: [c / cols, r / rows, (c + 1) / cols, (r + 1) / rows],
      });
    }
  }
  return { rows, cols, cells };
}

function oneDimCluster(values: number[], threshold: number): Array<{ value: number; count: number }> {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: Array<{ sum: number; count: number }> = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(v - last.sum / last.count) < threshold) {
      last.sum += v;
      last.count += 1;
    } else {
      groups.push({ sum: v, count: 1 });
    }
  }
  return groups.map((g) => ({ value: g.sum / g.count, count: g.count }));
}

// ─────────────────────────────────────────────────────────────────
// PDF 工具：pdfjs 抽 cluster + pdftoppm 渲整页 + sharp 裁 slide

async function getClusters(doc: any, pageIndex: number): Promise<{
  clusters: Cluster[];
  pageWidth: number;
  pageHeight: number;
}> {
  // biome-ignore lint/suspicious/noExplicitAny: pdfjs 在 Node 下没完整 d.ts
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const page = await doc.getPage(pageIndex);
  const vp = page.getViewport({ scale: 1 });
  const pageW = vp.width;
  const pageH = vp.height;
  const opList = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;
  const SAVE = OPS.save;
  const RESTORE = OPS.restore;
  const TRANSFORM = OPS.transform;
  const PAINT_IMAGE = OPS.paintImageXObject;
  const PAINT_INLINE = OPS.paintInlineImageXObject;
  const PAINT_FORM = OPS.paintFormXObjectBegin;

  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const opsBbox: Bbox[] = [];

  const mul = (a: number[], b: number[]): number[] => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const xform = (m: number[]): Bbox => {
    const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
    const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
    const x1 = Math.min(...xs);
    const y1 = Math.min(...ys);
    const x2 = Math.max(...xs);
    const y2 = Math.max(...ys);
    // 转归一化 + 左上原点
    return [x1 / pageW, (pageH - y2) / pageH, x2 / pageW, (pageH - y1) / pageH];
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === SAVE) stack.push([...ctm]);
    else if (fn === RESTORE) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === TRANSFORM) ctm = mul(ctm, args as number[]);
    else if (fn === PAINT_IMAGE || fn === PAINT_INLINE || fn === PAINT_FORM) {
      opsBbox.push(xform(ctm));
    }
  }
  // 聚类（同 probe v1 的 union-find）
  const threshold = 0.02; // 归一化 2%
  const parent = opsBbox.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const gap = (a: Bbox, b: Bbox) => {
    const dx = Math.max(a[0] - b[2], b[0] - a[2], 0);
    const dy = Math.max(a[1] - b[3], b[1] - a[3], 0);
    return Math.max(dx, dy);
  };
  for (let i = 0; i < opsBbox.length; i++) {
    for (let j = i + 1; j < opsBbox.length; j++) {
      if (gap(opsBbox[i], opsBbox[j]) < threshold) {
        const pi = find(i);
        const pj = find(j);
        if (pi !== pj) parent[pi] = pj;
      }
    }
  }
  const groups = new Map<number, Bbox[]>();
  for (let i = 0; i < opsBbox.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(opsBbox[i]);
  }
  const clusters: Cluster[] = [];
  for (const g of groups.values()) {
    clusters.push({
      normBbox: [
        Math.min(...g.map((b) => b[0])),
        Math.min(...g.map((b) => b[1])),
        Math.max(...g.map((b) => b[2])),
        Math.max(...g.map((b) => b[3])),
      ],
    });
  }
  return { clusters, pageWidth: pageW, pageHeight: pageH };
}

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))));
  });
}

async function rasterizePage(pdfPath: string, page: number, outPrefix: string): Promise<string> {
  // pdftoppm -f P -l P -r DPI -png input.pdf prefix → 生成 prefix-P.png（或 prefix-PP.png）
  await runCmd('pdftoppm', ['-f', String(page), '-l', String(page), '-r', String(DPI), '-png', pdfPath, outPrefix]);
  // pdftoppm 文件名后缀根据总页数位数定，简单办法：列目录找匹配
  const dir = path.dirname(outPrefix);
  const base = path.basename(outPrefix);
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(dir)).filter((f) => f.startsWith(`${base}-`) && f.endsWith('.png'));
  if (files.length === 0) throw new Error(`pdftoppm produced no file for page ${page}`);
  // 找跟当前 page 匹配的（去掉前导 0）
  const match = files.find((f) => {
    const n = Number.parseInt(f.slice(base.length + 1, -4), 10);
    return n === page;
  });
  return path.join(dir, match ?? files[0]);
}

async function cropSlide(
  pagePngPath: string,
  crop: Bbox,
  outPath: string,
): Promise<{ width: number; height: number }> {
  // biome-ignore lint/suspicious/noExplicitAny: sharp 通过 pnpm path 加载，没类型
  const sharpMod: any = await import(
    path.join(REPO_ROOT, 'node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js')
  );
  const sharp = sharpMod.default ?? sharpMod;
  const img = sharp(pagePngPath);
  const meta = await img.metadata();
  const W = meta.width as number;
  const H = meta.height as number;
  const left = Math.max(0, Math.round(crop[0] * W));
  const top = Math.max(0, Math.round(crop[1] * H));
  const width = Math.min(W - left, Math.round((crop[2] - crop[0]) * W));
  const height = Math.min(H - top, Math.round((crop[3] - crop[1]) * H));
  await img.extract({ left, top, width, height }).png().toFile(outPath);
  return { width, height };
}

// ─────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(SLIDES_DIR, { recursive: true });
  await mkdir(PAGES_DIR, { recursive: true });
  const pdfData = new Uint8Array(await readFile(PDF_PATH));

  // 先打开 pdf 拿页数
  // biome-ignore lint/suspicious/noExplicitAny: pdfjs 没类型
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjsLib.getDocument({ data: pdfData, isEvalSupported: false }).promise;
  const totalPages: number = doc.numPages;
  const targetPages = PAGES_ARG
    ? PAGES_ARG.split(',').map((s) => Number.parseInt(s.trim(), 10))
    : Array.from({ length: totalPages }, (_, i) => i + 1);

  console.log(`📄 PDF: ${PDF_PATH}`);
  console.log(`📂 Output: ${OUTPUT_DIR}`);
  console.log(`📐 总页数 ${totalPages}, 探测 ${targetPages.length} 页`);
  console.log('');

  const report: Array<{
    page: number;
    layout: Layout;
    slides: Array<{ slot: string; png: string; width: number; height: number }>;
  }> = [];

  for (const p of targetPages) {
    const { clusters, pageWidth, pageHeight } = await getClusters(doc, p);
    const layout = detectLayout(clusters, pageWidth / pageHeight);
    console.log(`Page ${String(p).padStart(2, ' ')} | layout=${layout.kind} | ${layout.slides.length} slide(s) | signals=${JSON.stringify(layout.signals)}`);

    const pagePngPath = await rasterizePage(PDF_PATH, p, path.join(PAGES_DIR, 'p'));
    const slideRecords: Array<{ slot: string; png: string; width: number; height: number }> = [];
    for (const s of layout.slides) {
      const outName = `page-${String(p).padStart(2, '0')}-${s.slot}.png`;
      const outPath = path.join(SLIDES_DIR, outName);
      const dim = await cropSlide(pagePngPath, s.crop, outPath);
      slideRecords.push({ slot: s.slot, png: path.relative(OUTPUT_DIR, outPath), width: dim.width, height: dim.height });
      console.log(`   → ${outName}  ${dim.width}×${dim.height}px`);
    }
    report.push({ page: p, layout, slides: slideRecords });
  }

  await writeFile(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n💾 ${OUTPUT_DIR}/`);
  console.log(`   slides/ — 切好的 slide PNG（人工 review 看图够不够清晰、切线对不对）`);
  console.log(`   pages/  — 原页整图 PNG（对比用）`);
  console.log(`   report.json — 每页的 layout 检测 + signals`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
