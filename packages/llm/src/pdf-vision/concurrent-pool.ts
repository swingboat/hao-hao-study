/**
 * runConcurrentPool — 通用 N 路 worker 池（不知道"chunk"是什么）
 *
 * 调度 0..count-1 这些索引化任务，最多 concurrency 个并发 worker，runOne 任意 throw
 * 都不停 pool —— 失败索引连同 error 推到 failures 数组，caller 自己决定怎么用：跳过、
 * 重试、还是让整个 job 挂掉。
 *
 * 不返回 results 数组：caller 通常需要在 runOne 里把结果按 index 写到自己的状态结构
 * （比如同时写 chunks[i] 和 latencies.push）；若强行让 pool 收集 results，反而要 caller
 * 把所有 side-effect 折叠进返回值，得不偿失。
 *
 * 为什么不内置 retry：retry 策略与业务高度相关（要不要 sleep / 串行 vs 并发 / 重试几轮 /
 * 重试时是否复用同 prompt）。把 retry 留给 caller，pool 只做"调度 + 失败收集"。
 *
 * 实现细节：
 *   - nextIdx++ 原子领号（V8 单线程 JS，++ 是 race-free 的）
 *   - 启动 min(concurrency, count) 个 worker；count=0 时直接空数组返回
 *   - 每个 worker 死循环抓 nextIdx，超界即 return；同 worker 继续抓下一个不 return
 */

export interface ConcurrentPoolOpts {
  /** 任务总数（runOne 会被以 0..count-1 调用） */
  count: number;
  /** 最大并发；实际启动 worker 数 = min(concurrency, count)；<1 视作 1 */
  concurrency: number;
  /** 处理单个任务；任意 throw 不停 pool，进 failures。 */
  runOne: (index: number) => Promise<void>;
}

export interface PoolResult {
  /** 失败列表，**未排序**（按完成时间到达），caller 想保序自己 sort */
  failures: Array<{ index: number; error: unknown }>;
}

export async function runConcurrentPool(opts: ConcurrentPoolOpts): Promise<PoolResult> {
  const { count, runOne } = opts;
  const concurrency = Math.max(1, opts.concurrency);
  const failures: PoolResult['failures'] = [];

  if (count <= 0) return { failures };

  let nextIdx = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIdx++;
      if (i >= count) return;
      try {
        await runOne(i);
      } catch (err) {
        failures.push({ index: i, error: err });
        // 同 worker 继续抓下一片
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, () => worker()));
  return { failures };
}
