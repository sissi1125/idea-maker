# feat-200.8 — 平台规则 / e2e smoke / Fly.io 部署

## Q1：平台规则的"prompt 注入"和"后置 validator"——为什么要双保险？只做一个不够吗？

**考察点**：LLM 输出的不确定性 + 验证设计哲学。

**答**：

LLM 是**概率系统**，prompt 里写"必须遵守 X / 不许出现 Y"也只是降低违规概率，**不是硬约束**。三种情形：

| 只做 prompt 注入 | 只做后置 validator | 双保险（实际方案） |
|---|---|---|
| 用户看不到违规——LLM 偶尔越界用户不知 | 永远走最坏路径，每次让 LLM 写完再 check | LLM 大概率合规 + 偶尔越界用户能看到 |
| 隐性失败 | 多花 token / 改稿成本 | 用户决策权 + 反馈数据 |

更深一层：**双保险产生了反馈循环的训练数据**。每次违规都记录哪条规则触发、什么内容触发——后续可以：

1. 调整 prompt 注入文案，看违规率有没有下降
2. 给 LLM 做 few-shot：把高频违规的反例放进 prompt
3. 训练自己的偏置 model（Phase 3.5 真 Agent 阶段）

如果只做单边，要么变"盲飞"，要么变"穷举改稿"，都不构成持续优化的闭环。

实际工程取舍：

- prompt 注入：成本 ~50 tokens，每次 generate 都做
- validator：纯函数本地跑，成本 ~1ms，几乎免费

这种"低成本双保险"在所有 LLM 应用里都该是默认动作。

---

## Q2：`maxLength` 校验为什么用 `[...text].length` 而不是 `text.length`？

**考察点**：JavaScript 字符串底层 UTF-16 编码 + emoji / 中文边界 case。

**答**：

JS 的 `string.length` 返回 **UTF-16 code units 数**，不是 **Unicode code points 数**：

```js
"a".length;           // 1   ASCII 字符 = 1 unit
"中".length;          // 1   常用中文 BMP = 1 unit
"🎉".length;          // 2   emoji 超 BMP，用 surrogate pair 表示 = 2 units
"𠀀".length;          // 2   罕用汉字（扩展 B 区） = 2 units
"👨‍👩‍👧".length;        // 8   家庭 emoji 是多个 code point + ZWJ 连接，更复杂
```

`[...text].length` 用 spread 走 iterator——遵循 `String.prototype[@@iterator]`，按 **Unicode code point** 切分：

```js
[..."🎉"].length;     // 1   正确：emoji 是一个 code point
[..."𠀀"].length;     // 1   正确
[..."👨‍👩‍👧"].length;    // 5   仍不完美（ZWJ 序列被拆），但比 length 准很多
```

对小红书 1000 字限制场景：

- 用户在标题里放 5 个 emoji + 500 个中文
- `string.length` 算成 510，实际肉眼是 505 字符——超不超限都判断错
- `[...text].length` 算成 505，与用户感知一致

更准确的方案是 `Intl.Segmenter`（"grapheme cluster" 切分，正确处理 ZWJ emoji），但是浏览器 / Node 兼容不一定齐，MVP 用 spread 已经覆盖 95% case。

---

## Q3：Dockerfile 用 **multi-stage build**——为什么必须分四阶段？合并能省事吗？

**考察点**：Docker 镜像分层 + 缓存命中 + 镜像大小。

**答**：

合并能跑通但代价大：

- **base**（pnpm + 系统包）→ 几乎不变，缓存到下次发布
- **deps**（`pnpm install --frozen-lockfile`）→ 只在 pnpm-lock.yaml 变了才重跑（~30s）
- **build**（`pnpm -r build` + `next build`）→ 每次源码变都跑（~60s）
- **runner**（只复制构建产物）→ 不装 dev 依赖，镜像从 ~1.5GB 降到 ~300MB

如果合并成单阶段：

1. **每次源码改动都重装依赖**——CI 时间 ×3
2. **镜像里带 devDependencies**（typescript / nest CLI / tsx 等）—— ~1GB 多余体积
3. **build 中间产物（.next/cache、tsc 残留）跟到运行时**——更大、更慢冷启动
4. **安全 surface 变大**——devDeps 里偶尔有漏洞，生产环境完全不需要

multi-stage 的核心收益不是"快"，而是**控制运行时镜像里有什么**：

> Build 用大全套（编译器、构建工具、缓存）
> Runtime 只要二进制 + 必要 runtime deps（node + standalone bundle + dumb-init）

Next.js standalone 输出在这里和 multi-stage 是绝配——Next 把 server-side 依赖打到 `.next/standalone/node_modules` 里，runner 阶段不用再 pnpm install。

---

## Q4：smoke 脚本第 5 步"等 ingestion 完成"用 30s 轮询而不是 SSE，为什么？

**考察点**：测试场景的工具选型，"对的工具 vs 时髦工具"。

**答**：

smoke 的核心目标是**给 CI / 部署后冒烟用**，能用最简单的协议跑就用：

| 维度 | 轮询 | SSE |
|---|---|---|
| 实现复杂度 | 5 行 while 循环 | 需要 EventSource shim 或 fetch + ReadableStream |
| 依赖 | 零（fetch + sleep） | 浏览器 API 或 polyfill |
| 失败诊断 | 直接看 GET 响应 | SSE 流断了不一定能立刻知道 |
| Node 18+ 原生支持 | ✅ | ⚠️ EventSource 不在 Node 标准库 |
| 适合场景 | CI / 后端集成测 | 用户 UI 实时体验 |

而且 ingestion 的预期时长是 **几秒到十几秒**，轮询 1s 间隔不构成问题。如果是"等几分钟"的场景才考虑 SSE。

更重要的是：**smoke 测的是业务正确性，不是性能**。即便后续 200.8.1 上了 SSE，smoke 脚本继续轮询 GET endpoint 也完全没问题——这就是 REST + 轮询作为"基础设施备份接口"的价值，它永远在那兜底。

如果 SSE endpoint 出问题，但轮询 GET 还能拿到正确数据 → 我能立刻定位是 SSE 实现的 bug；如果 smoke 用 SSE，SSE 挂了就直接看不到 ingestion 的真实状态。

工具选型的元规则：**测试代码的"工具栈"应该比被测代码的更朴素**，避免一起出错。

---

## Q5：`platform_rules.config` 是 JSONB——为什么不拆成几个独立列？比如 `max_length INT`, `banned_keywords TEXT[]`...

**考察点**：JSONB vs 关系列，schema 灵活性 vs 查询能力的权衡。

**答**：

拆列的好处：

- 可以建索引（找所有 maxLength > 500 的规则）
- 数据库层面有类型检查
- 字段语义清晰，新人一眼看懂

JSONB 的好处：

- 字段集合可扩展——明天加个 `mandatoryStartsWith` 不用 ALTER TABLE
- 嵌套结构方便（`bannedKeywords` 是数组，关系列要么 `TEXT[]` 要么单独搞个 banned_keywords 关联表）
- 整列读写，少几个 NULL 判断

为什么选 JSONB：

**这张表的查询模式**是"按 project_id 拉全部规则、按 rule_id 拿单条"——**永远不按 config 字段做过滤**。如果某天要"找所有 maxLength=140 的规则"，我会单独建一个 GIN 表达式索引：

```sql
CREATE INDEX idx_rules_max_length
  ON platform_rules ((config->>'maxLength'))
  WHERE (config->>'maxLength') IS NOT NULL;
```

而且 config 的字段集合现在 5 个，未来可能演化（加 `mandatoryStartsWith` / `forbiddenEmoji` / `linkWhitelist`...）—— ALTER TABLE 添加 5 次列 vs JSONB 写就完事，灵活性收益明显。

什么情况下要切回拆列：

- 开始有"按规则属性聚合分析"的报表（哪些品牌喜欢用 140 字限制？哪些违禁词最频繁？）
- 拒绝跨字段的隐式类型转换 bug（`config->>'maxLength'` 是 string 不是 int，要 `::int`）
- 团队规模超过 3-4 人，需要 schema 作为协作约定

这又回到那条元规则：**JSONB 是"事实表的灵活补丁"**，不是默认选择。它的代价是把 schema 校验从数据库挪到了应用层（用 TypeScript 类型 + zod / class-validator 守门）。

---
