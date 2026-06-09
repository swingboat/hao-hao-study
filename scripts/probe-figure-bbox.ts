#!/usr/bin/env tsx
/**
 * 探针：从 PDF 元数据抽出每页所有 image / form XObject 的 bbox。
 *
 * 目的：验证"题图自动定位"思路 —— 不让 LLM 给坐标，而是程序从 PDF 元数据读取
 *       图形对象的真实绘制 bbox。
 *
 * 关注点：
 *   1. PPT 转 PDF 是否会把一张几何图打散成多个 image XObject / 矢量绘制？
 *   2. 抽出的 bbox 数量、聚类后是否与人眼数到的"图"数一致？
 *   3. 同一页含多张图时能否区分？
 *   4. 全矢量绘制（无 image XObject）的几何图怎么办？
 *
 * 用法：pnpm exec tsx scripts/probe-figure-bbox.ts <pdf-path> [page1,page2,...]
 *       不传页码则跑全 PDF。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pdfjs-dist Node 入口（v6 用 ESM legacy build）
// biome-ignore lint/suspicious/noExplicitAny: pdfjs 在 Node 下没完整 d.ts
let pdfjsLib: any;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PDF_PATH = process.argv[2];
const PAGES_ARG = process.argv[3]; // e.g. "1,5,9,10,15"
if (!PDF_PATH) {
  console.error('Usage: pnpm exec tsx scripts/probe-figure-bbox.ts <pdf-path> [page1,page2,...]');
  process.exit(1);
}

const RUN_ID = new Date().toISOString().replace(/[.:]/g, '-').replace('Z', '');
const OUTPUT_DIR = path.join(REPO_ROOT, `results/probe-figure-bbox/${RUN_ID}`);

interface DrawOp {
  kind: 'image' | 'form' | 'inlineImage';
  /** transform matrix [a,b,c,d,e,f]：把单位方框 [0,0,1,1] 映射到页面用户坐标 */
  transform: number[];
  /** 绘制后在页面用户坐标系里的 bbox：[x1, y1, x2, y2]（PDF 原点在页面左下） */
  bbox: [number, number, number, number];
  /** 归一化 bbox（相对页面 [0..1]，原点改为左上，符合 web 习惯） */
  normBbox: [number, number, number, number];
  resourceName?: string;
  width?: number;
  height?: number;
}

interface PageReport {
  pageIndex: number; // 1-based
  pageWidth: number;
  pageHeight: number;
  ops: DrawOp[];
  /** 聚类后的图（相邻 / 重叠的 op 合并） */
  clusters: Array<{
    bbox: [number, number, number, number];
    normBbox: [number, number, number, number];
    opCount: number;
    kinds: Record<string, number>;
  }>;
}

/** 把 transform matrix 应用到单位方框 [0,0,1,1] 得 bbox */
function applyTransform(m: number[]): [number, number, number, number] {
  const [a, b, c, d, e, f] = m;
  // 单位方框四角
  const corners: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of corners) {
    xs.push(a * x + c * y + e);
    ys.push(b * x + d * y + f);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function normalize(
  bbox: [number, number, number, number],
  pageW: number,
  pageH: number,
): [number, number, number, number] {
  // PDF 原点在左下；转成左上原点的归一化坐标（web 习惯）
  const [x1, y1, x2, y2] = bbox;
  return [x1 / pageW, (pageH - y2) / pageH, x2 / pageW, (pageH - y1) / pageH];
}

/** IoU-style 邻接聚类：两个 bbox 距离 < 阈值 或 重叠 → 合并到同簇 */
function clusterBboxes(
  ops: DrawOp[],
  pageW: number,
  pageH: number,
): PageReport['clusters'] {
  // 距离阈值：页面短边的 1.5%（约 1pt 容差）
  const threshold = Math.min(pageW, pageH) * 0.015;

  const parent = ops.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (x: number, y: number) => {
    const px = find(x);
    const py = find(y);
    if (px !== py) parent[px] = py;
  };

  // 距离 = 两 bbox 之间的最小间距（重叠时为负）
  const gap = (a: DrawOp['bbox'], b: DrawOp['bbox']): number => {
    const dx = Math.max(a[0] - b[2], b[0] - a[2], 0);
    const dy = Math.max(a[1] - b[3], b[1] - a[3], 0);
    return Math.max(dx, dy);
  };

  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      if (gap(ops[i].bbox, ops[j].bbox) < threshold) {
        union(i, j);
      }
    }
  }

  const groups = new Map<number, DrawOp[]>();
  for (let i = 0; i < ops.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(ops[i]);
  }

  const clusters: PageReport['clusters'] = [];
  for (const group of groups.values()) {
    const x1 = Math.min(...group.map((o) => o.bbox[0]));
    const y1 = Math.min(...group.map((o) => o.bbox[1]));
    const x2 = Math.max(...group.map((o) => o.bbox[2]));
    const y2 = Math.max(...group.map((o) => o.bbox[3]));
    const bbox: [number, number, number, number] = [x1, y1, x2, y2];
    const kinds: Record<string, number> = {};
    for (const o of group) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
    clusters.push({
      bbox,
      normBbox: normalize(bbox, pageW, pageH),
      opCount: group.length,
      kinds,
    });
  }
  // 按从上到下、从左到右排序（用归一化坐标的 y1, x1）
  clusters.sort((a, b) => a.normBbox[1] - b.normBbox[1] || a.normBbox[0] - b.normBbox[0]);
  return clusters;
}

async function analyzePage(doc: any, pageIndex: number): Promise<PageReport> {
  const page = await doc.getPage(pageIndex);
  const viewport = page.getViewport({ scale: 1 });
  const pageW = viewport.width;
  const pageH = viewport.height;

  const opList = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;
  // 我们感兴趣的：图像绘制 + form XObject（PPT 把几何分组常导出成 form xobject）
  const PAINT_IMAGE = OPS.paintImageXObject; // 85
  const PAINT_INLINE = OPS.paintInlineImageXObject; // 86
  const PAINT_FORM = OPS.paintFormXObjectBegin; // 74（开始绘 form xobject）

  // pdfjs 的 transform 不会原地暴露给 op；它通过 transform 操作 + 当前 ctm 维护。
  // 我们手动维护一个变换栈：save/restore + transform。
  const SAVE = OPS.save;
  const RESTORE = OPS.restore;
  const TRANSFORM = OPS.transform;

  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];

  const ops: DrawOp[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === SAVE) {
      stack.push([...ctm]);
    } else if (fn === RESTORE) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (fn === TRANSFORM) {
      // args = [a,b,c,d,e,f]，乘到当前 ctm
      ctm = mul(ctm, args as number[]);
    } else if (fn === PAINT_IMAGE) {
      const bbox = applyTransform(ctm);
      ops.push({
        kind: 'image',
        transform: [...ctm],
        bbox,
        normBbox: normalize(bbox, pageW, pageH),
        resourceName: typeof args[0] === 'string' ? args[0] : undefined,
        width: typeof args[1] === 'number' ? args[1] : undefined,
        height: typeof args[2] === 'number' ? args[2] : undefined,
      });
    } else if (fn === PAINT_INLINE) {
      const bbox = applyTransform(ctm);
      ops.push({
        kind: 'inlineImage',
        transform: [...ctm],
        bbox,
        normBbox: normalize(bbox, pageW, pageH),
      });
    } else if (fn === PAINT_FORM) {
      const bbox = applyTransform(ctm);
      ops.push({
        kind: 'form',
        transform: [...ctm],
        bbox,
        normBbox: normalize(bbox, pageW, pageH),
        resourceName: typeof args[0] === 'string' ? args[0] : undefined,
      });
    }
  }

  return {
    pageIndex,
    pageWidth: pageW,
    pageHeight: pageH,
    ops,
    clusters: clusterBboxes(ops, pageW, pageH),
  };
}

function mul(a: number[], b: number[]): number[] {
  // [a0,a1,a2,a3,a4,a5] = [a c e; b d f; 0 0 1] (PDF 的 row-major 习惯)
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

async function main() {
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await readFile(PDF_PATH));
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  await mkdir(OUTPUT_DIR, { recursive: true });

  const totalPages: number = doc.numPages;
  const targetPages: number[] = PAGES_ARG
    ? PAGES_ARG.split(',').map((s) => Number.parseInt(s.trim(), 10)).filter((n) => n >= 1 && n <= totalPages)
    : Array.from({ length: totalPages }, (_, i) => i + 1);

  console.log(`📄 PDF: ${PDF_PATH}`);
  console.log(`📂 Output: ${OUTPUT_DIR}`);
  console.log(`📐 总页数: ${totalPages}, 探测页: ${targetPages.join(',')}`);
  console.log('');

  const reports: PageReport[] = [];
  for (const p of targetPages) {
    const r = await analyzePage(doc, p);
    reports.push(r);
    const kindBreakdown = r.ops.reduce<Record<string, number>>((acc, o) => {
      acc[o.kind] = (acc[o.kind] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `Page ${p.toString().padStart(2, ' ')} | size ${r.pageWidth.toFixed(0)}×${r.pageHeight.toFixed(0)} | ops ${JSON.stringify(kindBreakdown)} | 聚类后 ${r.clusters.length} 块`,
    );
    for (const [i, c] of r.clusters.entries()) {
      const [nx1, ny1, nx2, ny2] = c.normBbox;
      console.log(
        `   cluster ${i + 1}: norm=[${nx1.toFixed(3)},${ny1.toFixed(3)},${nx2.toFixed(3)},${ny2.toFixed(3)}] (${(nx2 - nx1).toFixed(2)}w × ${(ny2 - ny1).toFixed(2)}h) ops=${c.opCount} kinds=${JSON.stringify(c.kinds)}`,
      );
    }
  }

  await writeFile(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(reports, null, 2));
  await writeFile(
    path.join(OUTPUT_DIR, 'summary.json'),
    JSON.stringify(
      {
        pdf: PDF_PATH,
        total_pages: totalPages,
        per_page: reports.map((r) => ({
          page: r.pageIndex,
          op_count: r.ops.length,
          cluster_count: r.clusters.length,
          kinds: r.ops.reduce<Record<string, number>>((acc, o) => {
            acc[o.kind] = (acc[o.kind] ?? 0) + 1;
            return acc;
          }, {}),
        })),
      },
      null,
      2,
    ),
  );

  console.log(`\n💾 完整报告已保存到 ${OUTPUT_DIR}/report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
