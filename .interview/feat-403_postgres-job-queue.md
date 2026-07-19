# feat-403：PostgreSQL 后台任务队列可靠性

## 1. `FOR UPDATE SKIP LOCKED` 为什么适合多个 worker 抢任务？

普通 `FOR UPDATE` 会让后来的 worker 等待第一条已锁记录，形成队头阻塞。`SKIP LOCKED` 会跳过其他事务已认领的任务并选择下一条，因此多个 API 实例能并行消费且不会拿到同一行。它不单独解决“每类最多 N 个”的计数竞态，所以本项目还按 kind 获取事务 advisory lock。

## 2. lease 和 heartbeat 分别解决什么问题？

worker_id 表示当前所有者，lease_expires_at 是所有权截止时间，heartbeat 在长任务运行时延长截止时间。进程崩溃后心跳停止，其他 worker 等 lease 过期即可回收任务；完成和失败更新都校验 worker_id，旧 worker 即使恢复也不能覆盖新 owner。

## 3. 为什么任务 payload 必须入库，不能保存 Promise 回调？

闭包只存在于当前 Node.js 内存，重启后无法重建。持久化 `{ userId, projectId, campaignId }` 这类最小业务标识后，新进程能根据 kind 找到已注册 handler，再从数据库读取最新配置执行。API key 和 prompt 不放 payload，避免复制敏感或容易过期的数据。

## 4. 这个队列提供 exactly-once 吗？

不提供，语义是 at-least-once。进程可能在业务副作用成功后、任务状态提交前崩溃，恢复后会重跑，因此 handler 必须幂等。Brief 使用 upsert；Campaign 重跑会先替换 generated variants。数据库 lease 能减少重复执行，但不能跨外部 LLM 和本地事务提供 exactly-once。

## 5. 优雅退出为什么还要主动释放 lease？

服务先停止 claim 并等待宽限期，让短任务自然完成；仍未完成的任务改回 queued。这样滚动部署不必等待完整 lease 才恢复。旧 handler 后续写完成态时会因 worker_id 已清空而更新不到任务，避免覆盖新 worker。
