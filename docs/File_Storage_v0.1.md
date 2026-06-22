# 文件存储方案 — v0.1

> v0.1 阶段所有"持久化字节流"（上传 PDF/图片、PDF 派生 PNG、LLM 中间产物、最终 figure 切片）的统一管理方案。本文件是 `packages/storage` 与所有上传/产出代码的契约。
>
> | 版本 | 日期 | 说明 |
> |---|---|---|
> | v0.1 | 2026-06-08 | 首次发布；v0.1 走本地 fs，预留 S3 切换 |

---

## §1 决策摘要

| 编号 | 议题 | 决议 | 理由 |
|---|---|---|---|
| **S1** | 抽象层 | `packages/storage` 暴露 `ObjectStore` 接口，business 不直接见底层 | 切换 fs ↔ S3 ↔ R2 ↔ MinIO 零业务代码改动 |
| **S2** | v0.1 后端 | **本地文件系统**（`FileSystemStore`） | 单机开发零成本；上线再切对象存储 |
| **S3** | 存储根目录 | `STORAGE_FS_ROOT=/Users/huyin/www/hao-hao-study`（**仓库外**） | 派生物不污染 git；与未来 S3 bucket 结构 1:1 对应 |
| **S4** | 内容寻址 | 原始文件按 sha256 寻址（CAS） | 物理去重 + 内容指纹防篡改 |
| **S5** | 去重粒度 | **仅物理去重**；`content_upload.sha256` 不 UNIQUE，多次上传产生多 row | 保留 uploader / 时机 / 用途审计；物理上同 sha256 只存一份 |
| **S6** | 派生资产索引 | 新表 `derived_asset`（PK source_sha256+processor+version+asset_key） | GC / 重算 / 版本对比有索引可走 |
| **S7** | 中间产物生命周期 | `llm-jobs/raw/*` 30 天 cron GC；最终 figure 切片永久 | 控成本；审计窗口足够 |

---

## §2 目录结构

`{root}` = `STORAGE_FS_ROOT`（dev）或 S3 bucket（prod），两边结构完全一致。

```
{root}/
├── uploads/                                    原始上传（永久，被 derived_asset 引用不可删）
│   └── sha256/
│       └── {ab}/                               sha256 前 2 位分桶，避免单目录爆炸
│           └── {abcdef...64hex}.{ext}          原 PDF / image / pptx
│
├── derived/                                    派生资产（永久；老 version 可 GC）
│   └── {source-sha256}/
│       └── {processor}-{version}/              如 rasterize-v1 / figure-crop-v1
│           └── {asset-key}.{ext}               如 page-001.png / question-3-fig-1.png
│
└── llm-jobs/                                   LLM 中间产物（raw 30 天 GC）
    └── {job-uuid}/
        ├── raw/page-{NN}.json                  Gemini/Claude 原始响应
        ├── parsed/page-{NN}.json               解析后 questions + resources
        ├── all.json                            合并去重后总输出
        └── stats.json                          token / 耗时 / 重试统计
```

**命名约束**：
- `{ab}` = sha256 前 2 位小写 hex（`a2`、`4f`...）
- `{ext}` 严格小写（`.pdf` / `.png` / `.jpg`）
- `{processor}-{version}` 仅 ASCII 字母数字 + 短横线，便于 GC 通配
- `{asset-key}` 同上，允许 `-` 分隔

---

## §3 抽象接口（`packages/storage`）

### §3.1 `ObjectStore` 接口

```ts
export interface ObjectStore {
  /** 写对象；幂等（同 key 覆盖） */
  put(key: string, body: Buffer, opts?: PutOptions): Promise<PutResult>;

  /** 读对象；不存在抛 NotFoundError */
  get(key: string): Promise<Buffer>;

  /** 探在不在；不抛 */
  exists(key: string): Promise<boolean>;

  /** 删；不存在不抛 */
  delete(key: string): Promise<void>;

  /** 按前缀列；分页 */
  list(prefix: string, opts?: { cursor?: string; limit?: number }): Promise<ListResult>;

  /**
   * 生成可由前端 / web端直接 GET 的 URL，TTL 内有效。
   * - fs 模式：返回 `${PUBLIC_BASE_URL}/storage/${key}` 形式的本地路由
   * - s3 模式：返回真正的 presigned GET URL
   */
  presignedGetUrl(key: string, ttlSec?: number): Promise<string>;
}

export interface PutOptions {
  contentType?: string;
  /** 可选；写入前检查 sha256 是否匹配，不匹配抛 ChecksumMismatchError */
  expectedSha256?: string;
}
export interface PutResult {
  key: string;
  size: number;
  sha256: string;
}
export interface ListResult {
  keys: string[];
  nextCursor?: string;
}
```

### §3.2 工厂

```ts
// packages/storage/src/index.ts
export function createStore(): ObjectStore {
  const driver = process.env.STORAGE_DRIVER ?? 'fs';
  if (driver === 'fs') return new FileSystemStore(process.env.STORAGE_FS_ROOT!);
  if (driver === 's3') return new S3Store({ /* ... */ });
  throw new Error(`unknown STORAGE_DRIVER: ${driver}`);
}
```

### §3.3 路径辅助（避免业务硬编码）

```ts
export const StoragePaths = {
  upload: (sha256: string, ext: string) =>
    `uploads/sha256/${sha256.slice(0, 2)}/${sha256}.${ext}`,
  derived: (sourceSha256: string, processor: string, version: string, key: string) =>
    `derived/${sourceSha256}/${processor}-${version}/${key}`,
  llmJob: (jobId: string, sub: string) => `llm-jobs/${jobId}/${sub}`,
};
```

业务代码：
```ts
const store = createStore();
await store.put(StoragePaths.upload(sha, 'pdf'), buf, { contentType: 'application/pdf' });
```

---

## §4 数据库支撑

### §4.1 `content_upload`（在原表上加列，**不破坏现有数据**）

```sql
ALTER TABLE content_upload
  ADD COLUMN sha256          char(64),
  ADD COLUMN file_size_bytes bigint;

CREATE INDEX ix_content_upload_sha256 ON content_upload(sha256);
-- 注意：不加 UNIQUE，允许多次上传产生多行；物理去重靠 storage 层
```

### §4.2 `derived_asset`（新表）

```sql
CREATE TABLE derived_asset (
  source_sha256 char(64)    NOT NULL,
  processor     text        NOT NULL,
  version       text        NOT NULL,
  asset_key     text        NOT NULL,
  storage_path  text        NOT NULL,
  size_bytes    int,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_sha256, processor, version, asset_key)
);
CREATE INDEX ix_derived_lookup ON derived_asset(source_sha256, processor);
```

**`metadata` jsonb 字段约定（第一版）**：

```ts
type DerivedMetadata =
  | { processor: 'rasterize';      page: number; dpi: number }
  | { processor: 'figure-crop';    src_page: number; bbox: [number,number,number,number]; alt: string }
  | { processor: 'vision-extract'; provider_id: string; prompt_version: string };
```

后续处理器加进来时扩 union。

---

## §5 已知 processor 清单（v0.1）

| processor | version | 输入 | 输出 asset_key 模式 | metadata 关键字段 |
|---|---|---|---|---|
| `rasterize` | `v1` | PDF | `page-001.png` ~ `page-NNN.png` | `page`, `dpi` |
| `figure-crop` | `v1` | rasterize 的 page PNG + Gemini bbox | `question-{N}-fig-{M}.png` / `resource-{N}-fig-{M}.png` | `src_page`, `bbox`, `alt` |
| `vision-extract` | `v1` | rasterize 的 page PNG | （写在 llm-jobs/，不入 derived_asset） | `provider_id`, `prompt_version` |

> 升级算法（如 prompt 改了 → `vision-extract` v2）时，**version 字段递增**；老版本不删，便于 A/B 对比。

---

## §6 生命周期 & GC

| 资产 | 保留策略 | GC 触发 |
|---|---|---|
| `uploads/**` | 永久 | 仅当所有引用它的 `content_upload` row + `derived_asset` row 都删除后，cron 异步回收 |
| `derived/**` 当前 version | 永久 | 同上 |
| `derived/**` 老 version | 升级稳定后人工 `DELETE FROM derived_asset WHERE version='v1'` + storage cleanup |
| `llm-jobs/{id}/raw/**` | **30 天** | cron daily：`created_at < now() - 30d` 删 storage，row 保留 |
| `llm-jobs/{id}/parsed/**` | 与 `llm_parse_job` row 同生 | row 删除时一起删 |
| `llm-jobs/{id}/all.json` + `stats.json` | 与 row 同生 | 同上 |

GC 由独立 worker 跑（v0.1 是手工 npm script，v0.2+ 加 cron）。

---

## §7 dev 环境配置

`.env`（v0.1 默认值）：

```bash
STORAGE_DRIVER=fs
STORAGE_FS_ROOT=/Users/huyin/www/hao-hao-study

# 上线切 S3 / R2 时改为：
# STORAGE_DRIVER=s3
# STORAGE_S3_BUCKET=hao-hao-study
# STORAGE_S3_REGION=auto
# STORAGE_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
# STORAGE_S3_ACCESS_KEY_ID=...
# STORAGE_S3_SECRET_ACCESS_KEY=...
```

`.env.example` 同步加上面这一节。

**前端访问 fs 模式资产**：Next.js admin/web 各自加 `/storage/[...key]` 路由，把 `STORAGE_FS_ROOT/{key}` 作为静态文件返回（限内网/已鉴权）。生产 S3 模式时 `presignedGetUrl` 返回真签名 URL，前端代码不变。

---

## §8 与 PRD 既有决策的关系

| 既有决策 | 本文件影响 |
|---|---|
| Tech_Stack_MVP_v0.1.md §2.2 "对象存储 = Cloudflare R2" | **沿用**：v0.1 dev fs，上线即 R2，S3-compat 接口零代码迁移 |
| Operator_Console_MVP_PRD `content_upload`（UPLOAD_RECORD） | 加 sha256 + file_size_bytes 字段；migration 不破坏现有 schema |
| LLM 抽象层 D5（自写 fetch） | `packages/llm` 落产物时统一走 `ObjectStore`，不直接 fs.writeFile |

---

## §9 启动顺序（落地任务）

1. ✅ 本文档（Step 1）
2. ⏳ `packages/storage` 接口 + FileSystemStore + 工厂 + 测试（Step 2）
3. ⏳ migration：`content_upload.sha256/file_size_bytes` + `derived_asset` 新表（Step 3）
4. ⏳ `packages/llm` 重构：image attachment + `vision/analyze-images.ts` + 产物落 storage（Step 4）
5. ⏳ admin worktree：upload handler 算 sha256 + CAS 路径
6. ⏳ admin/web worktree：`/storage/[...key]` 路由（dev 用）

后两步由对应 worktree 负责，主目录交接 packages/storage + packages/llm + db migration。
