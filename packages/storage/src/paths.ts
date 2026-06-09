/**
 * 路径辅助 + 内容寻址辅助
 *
 * 业务代码不要自己拼 key，统一用 StoragePaths。命名规则见 docs/File_Storage_v0.1.md §2。
 */
import { createHash } from 'node:crypto';

export const StoragePaths = {
  /** 原始上传：uploads/sha256/{ab}/{abcdef...}.{ext} */
  upload(sha256: string, ext: string): string {
    assertSha256(sha256);
    const safeExt = ext.replace(/^\./, '').toLowerCase();
    return `uploads/sha256/${sha256.slice(0, 2)}/${sha256}.${safeExt}`;
  },

  /** 派生资产：derived/{source-sha256}/{processor}-{version}/{asset-key} */
  derived(sourceSha256: string, processor: string, version: string, assetKey: string): string {
    assertSha256(sourceSha256);
    assertSlug(processor, 'processor');
    assertSlug(version, 'version');
    return `derived/${sourceSha256}/${processor}-${version}/${assetKey}`;
  },

  /** LLM job 中间产物：llm-jobs/{job-id}/{sub} */
  llmJob(jobId: string, sub: string): string {
    if (!/^[0-9a-f-]{8,}$/.test(jobId)) throw new Error(`bad jobId: ${jobId}`);
    return `llm-jobs/${jobId}/${sub.replace(/^\/+/, '')}`;
  },
};

/** 计算 buffer 的 sha256（小写 hex 64 字符） */
export function sha256OfBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 从文件名/路径取扩展名（不带点、小写）；无扩展返回 'bin' */
export function extOf(filename: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename);
  return m?.[1] ? m[1].toLowerCase() : 'bin';
}

function assertSha256(s: string) {
  if (!/^[0-9a-f]{64}$/.test(s)) throw new Error(`bad sha256: ${s}`);
}
function assertSlug(s: string, field: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(s)) throw new Error(`bad ${field} (alphanumeric + dash only): ${s}`);
}
