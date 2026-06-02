# feat-300.5 面试题：Agent 评估体系（offline eval + LLM-as-judge）

> 围绕「**为什么这么设计**」展开。每题附「**关键差异化答案**」。

---

## 1. 为什么 golden 集存文件而不入库？

**关键点**：测试集需要 PR 审查 + 跨环境一致 + 版本控制。

- 入库会让 golden 散落在 DB 里，没法 `git blame` 看「为什么改了这条 reference」
- 文件存 `apps/api/src/eval/golden/*.json`，git 跟踪 → 任何改动经过 PR review
- 跨环境（local / staging / prod）通过 commit hash 自动一致

代价：promote-feedback 时需要在 server 上 writeFileSync，CI/CD pipeline 要把这次写入纳入下个 PR。这是「半自动」语义——服务负责生成草稿，人类负责接受/拒绝。

---

## 2. LLM-as-judge 的最大风险是什么？怎么对冲？

**关键点**：评委自己的不稳定性。

风险：
- 同一对 (reference, candidate) 两次评分可能不一致（temperature 抖动）
- 评委自己有偏好（喜欢长 / 喜欢正式 / 喜欢列表结构）
- 评委对自己家 model 偏袒（OpenAI judge 偏 OpenAI 输出）

对冲：
1. **低温度** (`temperature: 0.2`)：减少 sampling 方差
2. **结构化打分锚点**：prompt 写明 1/3/5 分各对应什么，让 LLM 不靠主观感觉
3. **三维独立打分**：不要直接问「这个答案好不好」，分维度让 LLM 必须分析
4. **rationale 必填**：强制 LLM 给理由，让 review 时可发现「分数和理由不一致」的 case
5. **未来**：用不同 provider 做 judge（避免自评）

终极对冲：保留人工 review 入口（feedback 高分项才进 golden + promote API），让人类标注作为 ground truth。

---

## 3. trajectory 为什么用集合相似度而不是序列相似度？

**关键点**：ReAct 的非确定性。

ReAct agent 可能：
- 先 `search_history` 再 `search_kb`，或反过来——两条都是合理路径
- 重复调 `search_kb`（不同 query 改写）——视为 1 次
- 多调一个 `log_decision`——好习惯不该扣分

如果要求**序列严格一致**，会有大量正确路径误判失败。所以用：
- **precision** = 实际调用里有多少是期望的
- **recall** = 期望的覆盖了多少
- **jaccard** = 总体相似度
- **fullCover** = 期望集 ⊆ 实际集（更严格的通过门）

什么时候需要序列检测：测「先 search 再 generate」这种弱约束。留 `order-pattern` 函数为未来扩展。

---

## 4. passed 判定为什么是 `三维都过阈值 && jaccard >= 0.5`，不是 avg？

**关键点**：avg 掩盖单维灾难。

avg = 4 可能是 `(faithfulness=2, completeness=5, style=5)` → faithfulness 灾难性失败但 avg 通过。生产中**幻觉一票否决**比「平均分上 4」重要得多。

`AND` 语义 = 没有单项灾难。配合 jaccard 门 = 「输出对 + 过程合理」双信号。

实际项目里：
- 文案场景：faithfulness 阈值 4（事实必须对）、style 阈值 3（风格次要）
- 合规场景：所有三维都设 4（严格）
- 头脑风暴：faithfulness 阈值 2（允许发散）

阈值是 per-item 在 golden 里配的（thresholds 字段）。

---

## 5. baseline + thresholdDrop 怎么防止「分数缓慢漂移」？

**关键点**：「相对回归」≠「绝对低分」。

CI 守护两件事：
1. **绝对线**：本次 passed_items / total_items 太低 → fail（service 层可加）
2. **相对线**：本次 avg_overall 相比 baseline 下降 > thresholdDrop → fail

如果只看绝对线，6 个月前 avg=4.5，今天 avg=3.6（每周降 0.03），看起来一直「过」但实际已经退化。相对线能捕捉这种慢性病。

但如果只看相对线，会出现「持续退步但每周不超阈值」的问题（每次降 0.4 < 0.5 阈值 = 不报警）。

实践：两条线都设，并加 7 天移动平均做 baseline 替代「上次跑」（feat-300.7 优化点）。

---

## 6. promote-feedback-to-golden 闭环的价值是什么？

**关键点**：测试集随真实使用进化。

朴素流程：开发手写 golden → 跑 eval → 修 bug。但开发想得到的 query 跟用户真实问的不一样（开发者偏见）。

闭环：
1. 用户用 → 给 feedback（overall + edit_diff）
2. 高分项（overall >= 4）通过 promote API 半自动落 golden 文件
3. **edit_diff 优先做 reference**：用户改写后的版本比原 LLM 输出更接近「理想」
4. expectedTools 从该 generation 关联的 agent_steps 自动反推

闭环效果：测试集自动捕捉真实长尾场景，开发不用「猜用户会问什么」。

---

## 7. EvalRunner 为什么直接调 AgentRunner.run 而不是 mock LLM？

**关键点**：测的就是生产路径。

如果 EvalRunner 自己拼一个简化版 ReAct 跑，会出现：
- 「eval 通过但生产挂」（eval 路径和生产路径分叉）
- 「prompt 改了 eval 没反应」（eval 没读最新 prompt）

直接调 AgentRunner.run：
- 同一份代码、同一份 prompt、同一份 tools、同一份 BYOK 配置
- 跑出来的 agent_run 还能点进 trace UI（agent_run_id 写进 eval_items）
- 真正实现「集成测试 + 回归监控」二合一

代价：跑 30 条 golden ≈ 60s+（每条 ReAct 多步），慢。MVP 串行可接受，未来可加并行（带 BYOK rate-limit 控制）。

---

## 8. 退出码 0/1/2 分别代表什么？为什么不是 0/1？

**关键点**：CI 需要区分「业务回归」和「执行失败」。

- 0 = eval 跑通且没有回归 → 绿色 ✅
- **1 = eval 跑通但 avgOverall 退步超阈值** → 业务回归，需要 PR 作者解释
- **2 = eval 执行异常** → LLM 配置 / DB 连不上 / golden 解析失败 → 基础设施问题，不算业务红

如果合并为 0/1：CI 看到红，作者可能误以为「我的代码引入了回归」，但实际是 OpenAI API 临时挂掉。区分后：
- 1 → block merge，作者必须 review eval 报告
- 2 → 通知 ops，CI 重跑（不应归责作者）

类似 unix 程序对 SIGKILL (137) / SIGTERM (143) 区分的思路。
