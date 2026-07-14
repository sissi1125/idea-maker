/**
 * 异步任务轮询 helper（验收反馈：LLM 长请求异步化）
 * POST 拿 jobId → 反复 GET status → 成功返回 result / 失败抛错。
 * 每次都是短请求，不会撞生产网关的 30~60s 超时。
 */

import { apiFetch } from "./client";

export interface JobState<T> {
  status: "queued" | "running" | "succeeded" | "failed";
  result: T | null;
  error: string | null;
}

export async function pollUntilDone<T>(
  getJob: () => Promise<JobState<T>>,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 240_000;
  const start = Date.now();
  for (;;) {
    const job = await getJob();
    if (job.status === "succeeded") return job.result as T;
    if (job.status === "failed") throw new Error(job.error ?? "任务失败");
    if (Date.now() - start > timeout) throw new Error("任务超时，请重试");
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** 便捷封装：start（POST）→ 轮询 job 端点 */
export async function startAndWait<T>(
  startPath: string,
  jobPath: (jobId: string) => string,
): Promise<T> {
  const { jobId } = await apiFetch<{ jobId: string }>(startPath, { method: "POST" });
  return pollUntilDone<T>(async () => {
    const { job } = await apiFetch<{ job: JobState<T> }>(jobPath(jobId));
    return job;
  });
}
