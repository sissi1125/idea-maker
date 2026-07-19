# feat-300.3 补强：PostgreSQL 连接池面试题

## 1. `pg.Client` 与 `pg.Pool` 的核心区别是什么？

`Client` 通常代表一条专用 TCP/PostgreSQL 会话，调用方负责 `connect/end`；`Pool` 按需创建有限数量的连接，请求临时借用并 `release`，后续查询复用已有连接。连接池减少重复握手和认证，并用 `max` 对数据库并发施加背压。

## 2. 为什么 `max: 10` 不等于服务启动时创建 10 条连接？

`max` 是上限。`pg.Pool` 默认按请求量懒创建连接；归还后的连接保持 idle 供复用，超过 `idleTimeoutMillis` 才关闭。因此低流量时通常只有少量连接，同时避免每次查询重新建连。

## 3. 为什么 Agent 等待 LLM 时不应持有 PoolClient？

LLM 调用可能耗时几十秒，但期间没有 SQL。如果整次 Agent run 固定占用连接，少量并发任务就能耗尽池，使普通 CRUD 一起排队。本实现给长流程注入 `queryClient()` 代理，每条 SQL 各自借还连接；需要事务时才用 `withClient()` 固定连接。

## 4. 连接池如何保证事务使用同一连接？

事务必须在一次 `withClient()` 回调中完成 `BEGIN → SQL → COMMIT/ROLLBACK`，因为该回调固定使用同一个 PoolClient。不能分别调用按查询借还的代理执行事务，否则每条 SQL 可能落到不同连接。

## 5. 连接池改造需要监控哪些指标？

至少监控池的 total/idle/waiting、获取连接等待时间、查询 P95/P99、PostgreSQL active/idle 连接数和 `max_connections` 使用率。连接池满时应等待并在 `connectionTimeoutMillis` 后失败，不能绕过池临时创建额外连接。
