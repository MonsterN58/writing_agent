---
name: setup-pipeline
description: 立项全链编排，从 SOUL 到世界观、人物、总纲、卷纲、细纲，再进入开写。
phase: setup:orchestrate
chains_from: [work-setup, bulk-import]
chains_to: [worldbuilding-systems, character-bible, locations-bible, items-bible, outline-collaborator, volume-outline, arc-outline, chapter-planner]
must_call_tools: [setup_status, read_file, ask_user, update_progress]
forbid_tools: [write_chapter]
exit_when: [setupStage.stage >= 6]
prerequisite_files: [SOUL.md]
---

# Setup-Pipeline：立项到开写的完整七阶段编排

## 调用时机

- SOUL.md 刚写完，用户说"继续"/"下一步"/"搭设定"
- 用户首次要求写第 1 章但设定包不全
- 用户说"把设定都补齐"/"先把世界观搭好"

> 这是**顶层编排 skill**，由 lead_agent 自动串起 work-setup / worldbuilding-systems / character-bible / outline-collaborator / volume-outline / arc-outline / chapter-planner。每阶段完成后都要**汇报用户并等确认**。

---

## 核心原则

**默认不一口气跑完七阶段**。每阶段：
1. 基于已有资产生成本阶段内容
2. 落盘（走对应工具）
3. 给用户 200-400 字的摘要 + "继续下一步？还是先调整本步？"
4. 等用户确认后才继续

用户可以随时说"改 XX"，墨枢就地修正当前阶段；改完再继续。

---

## 一键模式（**仅在用户明确要求时启用**）

触发关键词：「一口气搭完 / 全自动 / 不用问我 / 自己看着办 / 全部跑完再给我看 / `/setup-all`」

**进入一键模式后**：

1. 先**用一段话明确告诉用户**当前模式 + 必经的 6 个阶段（②③④⑤⑥⑦）+ 预计总耗时（10-20 轮工具调用）+ 退出机制：
   > "好，进入一键模式：我会连续跑世界观 → 人物 → 地点物品 → 总纲 → 卷纲 → 第一组细纲。每阶段落盘后会简短报告，但**不会**在中间停下问你。如果中途想叫停就发任意消息，我会停在当前阶段。"

2. 每阶段完成后：
   - 调对应工具落盘
   - 用 1-2 行的极简摘要 emit 进度（不要 200-400 字详述，那是默认模式的事）
   - **不**调 `ask_user`，直接进下一阶段
   - 但**必须**在 `progress/setup-state.md` 增量记账，方便用户事后审计

3. 跑完阶段 ⑥ 后**强制停下**汇报：
   > "六阶段全跑完。资产清单：SOUL / world×6 / entities×N / locations×N / items×N / overall / volume-1 / arc-1-章001-005。我建议你先抽空读一遍 `outline/overall.md` + `outline/arcs/arc-1-章001-005.md`，没问题再开写第 1 章。"
   - 即使在一键模式下，**第 1 章正文** 也不自动写——开写必须用户主动触发。

4. 中途**硬熔断**：
   - 任一阶段工具失败或写出的资产被 setup_status 判定不通过 → 立即停在该阶段，详细汇报失败点
   - 工具调用次数累计 ≥ 25 仍未完成 → 主动停下"已耗 25 次调用还没完工，先看看哪里卡了"
   - 用户在中途插话 → 立即停在当前阶段（哪怕没收尾）

5. **禁用**一键模式的场景：
   - `setupStage.stage < 1`（SOUL 还没立 → 跑 `work-setup`，不要在没有宪章时一键搭世界观）
   - 用户在 SOUL 里把"红线"留为空白（说明用户自己都没想清楚红线，不该一口气跑完）
   - 已写 ≥ 1 章（一键模式只对冷启动作品有意义）

---

## 作品目录蓝图（第一步就向用户亮出这张图）

```
novels/<作品>/
├── SOUL.md                         # ① 作品宪章（work-setup 写）
├── knowledge/
│   ├── world/                      # ② 世界观包（worldbuilding 写）
│   │   ├── overview.md             #    世界一段话 + 核心规则
│   │   ├── power-system.md         #    修炼/魔法/超能力体系
│   │   ├── factions.md             #    主要势力
│   │   ├── geography.md            #    地理与重要地点
│   │   ├── history.md              #    历史大事记 / 时间线
│   │   └── rules.md                #    社会规则 / 自然法则
│   ├── entities/                   # ③ 主要人物（character-bible 写初版，wiki-ingest 维护）
│   │   ├── <主角>.md
│   │   ├── <核心配角>.md
│   │   ├── <主要反派>.md
│   │   └── ...
│   ├── relationships.md            #    人物关系图（character-bible 初始化）
│   ├── concepts/ locations/        #    wiki-ingest 运行时增补
│   ├── lookup.json lookup.md        #    必读设定索引（lookup_rebuild / lookup_upsert 维护）
│   ├── log.md timeline.md          #    章节摘要 / 故事时间线（wiki-ingest 维护）
│   └── foreshadow.md               #    伏笔总账（自动维护）
├── outline/
│   ├── overall.md                  # ④ 总纲（outline-collaborator 写）
│   ├── volumes/
│   │   └── volume-1.md             # ⑤ 卷纲（volume-outline 写）
│   ├── arcs/
│   │   └── arc-1-章001-005.md      # ⑥ 细纲 5 章一组（arc-outline 写）
│   └── chapters/
│       └── chapter-1.md            # ⑦ 单章纲（chapter-planner 写）
├── chapters/                       #    正文（write_chapter 写）
├── reviews/ exports/ progress/ memory/
```

每一层都是**上一层的**约束展开，下一层必须符合上一层。写章时反向校验。

---

## 七阶段流程

### ① SOUL（宪章）— 由 work-setup 处理

**产出**：`SOUL.md`

**完成标志**：题材、主角基本设定、主角动机、世界观一句话、核心冲突、基调、红线、推荐字数 全部填写。

**交给用户的话**：
> "作品宪章写好了。下一步搭世界观（修炼体系/势力/地理/历史），要我继续吗？"

---

### ② 世界观包 — 由 worldbuilding-systems 处理

**触发**：用户对 SOUL 点头 + 说"继续/搭世界观"。

**产出**（`update_progress` 工具写到 `knowledge/world/`）：

- `overview.md` — 世界一段话总结 + 3-5 条核心规则
- `power-system.md` — 力量体系（境界/品阶/上限/修炼代价/天花板）
- `factions.md` — 主要势力（3-7 个，每个含立场/实力/与主角关系）
- `geography.md` — 关键地点（5-10 处，主角会去的）
- `history.md` — 历史大事记（3-5 件影响现在的旧事）
- `rules.md` — 社会规则 / 自然法则 / 禁忌
- 完成本阶段后调 `lookup_rebuild`，确保 `knowledge/lookup.json` 覆盖这些世界观文件

**写法要点**：
- **每个文件 200-500 字**，不要贪多，够用即可
- 规则性内容要**能穿透到章节**（比如"修士 100 岁为大限"会让主角的时间焦虑落地）
- 留 2-3 个**隐藏设定**（"先天道体万中无一"—— 主角后面揭示自己是道体）

**写完后交给用户**：
> "世界观包搭完：九州 / 五境修炼 / 七大宗 / ... 伏笔埋了 3 条（真正的大乘不是化神、...）。下一步立主要人物（主角/核心配角/反派），继续？"

**工具**：`update_progress`（路径 `knowledge/world/*.md`）

---

### ③ 主要人物 — 由 character-bible 处理

**触发**：用户对世界观点头。

**产出**：
- `knowledge/entities/<主角 slug>.md`（frontmatter 结构化 + 详述 body）
- `knowledge/entities/<核心配角>.md` × 2-4 个
- `knowledge/entities/<主要反派>.md` × 1-2 个
- `knowledge/entities/<关键 NPC>.md` × 0-2 个
- `knowledge/relationships.md` — 人物关系表 + 文字描述
- **如果阶段 ② 没建过**：补建主角初始地、势力总部等**核心活动地点** stub 到 `knowledge/locations/`

**关键要求**：
- 每个角色至少埋 **1 条 open 伏笔**（身世/目的/秘密）
- 主角的 `foreshadow` frontmatter 里要有 2-3 条
- 关系表既要有当下关系，也要有"剧情推进后会变成"的伏笔

**工具**：
- `wiki_ingest`（把人物作为 new_entities 批量写，会自动落 frontmatter 文件）
- `update_progress`（写 `knowledge/relationships.md`）
- `lookup_rebuild`（人物与关系写完后重建 `knowledge/lookup.json` / `lookup.md`）

**完成后**：
> "立好了 N 个人物：主角林尘（废灵根 / 身世之谜 / 真道体伏笔）、配角叶清雪（青梅竹马 / 家族恩怨伏笔）、反派王麟（嫡子 / 心魔伏笔）... 人物关系图落在 knowledge/relationships.md。下一步写总纲，继续？"

---

### ④ 总纲 — 由 outline-collaborator 处理

**触发**：人物立完。

**产出**：`outline/overall.md`

**必含章节**：
- **全书规模复述**：开篇第一段**必须**从 SOUL.md 引"总字数 / 总章数 / 卷数"，所有卷的预估章数加起来必须 = 总章数（不许偏离）
- **三幕结构**：开端 / 发展 / 高潮结尾
- **卷划分**：每卷核心冲突 + 预估章数（= 总章数 ÷ 卷数 ±20%）+ 卷末高潮事件
- **主角成长弧**：起点 → 中点 → 终点（外在 + 内在两条线）
- **主反派弧**：出场时机 + 与主角的 N 次交锋 + 结局
- **主伏笔清单**：全书级伏笔（≥10 章回收）5-8 条，标明埋设章 + 回收章
- **主题落点**：核心主题一句话 + 如何通过情节体现

**工具**：`write_outline`（路径 `outline/overall.md`）

**完成后**（示例按 SOUL 全书规模 1000 章 / 6 卷 算出）：
> "总纲搭好：6 卷、主角三阶段成长、5 条主伏笔全部埋了回收点。第一卷约 167 章，主要讲「外门受辱 → 身世线索 → 首次突破」。下一步出第一卷卷纲，继续？"

---

### ⑤ 卷纲 — 由 volume-outline 处理

**触发**：总纲点头 + 准备开写当前卷（通常第一卷）。

**产出**：`outline/volumes/volume-N.md`（N = 当前卷号）

**必含**：
- 卷主线一句话
- 核心冲突 + 反派
- 起承转合四段（每段按本卷总章数分配章数范围 + 关键事件 + 情绪点；四段合计必须 = 本卷总章数）
- 卷末高潮事件 + 章号
- 本卷要完成的弧光（主角 +1 境界 / 感情线推进 / 伏笔回收 3 条）
- 出场人物清单

**工具**：`write_outline`（路径 `outline/volumes/volume-1.md`）

**完成后**：
> "卷纲搭好。第一卷 167 章四段结构（1-40 起 / 41-90 承 / 91-135 转 / 136-167 合），高潮在第 158 章「山门血战」。下一步出第 1-5 章细纲（每 5 章一组细纲），继续？"

---

### ⑥ 细纲（5 章一组） — 由 arc-outline 处理

**触发**：卷纲点头 + 要开写了。

**产出**：`outline/arcs/arc-1-章001-005.md`

**必含**：
- arc 情绪曲线（升/降/升/峰/收 或其他）
- 每章一句话剧情摘要
- 每章主要场景节拍草图（3-5 节拍/章）
- 每章出场人物（只列名字）
- 每章章末钩子类型（悬念/反转/承接/冲突预告）
- arc 整体负责推进的主线 + 要回收或埋设的伏笔

**工具**：`write_outline`（路径 `outline/arcs/arc-<M>-章<SSS>-<EEE>.md`）

**示例文件名**：`arc-1-章001-005.md` / `arc-2-章006-010.md`

**完成后**：
> "第 1-5 章细纲搭好：第 1 章开篇受辱/第 2 章偶得秘籍/第 3 章偷练被抓/第 4 章反杀/第 5 章秘密暴露。情绪曲线压-压-放-放-收，钩子递进。**现在可以开始写第 1 章了**，继续？"

---

### ⑦ 单章纲 + 正文 — 由 chapter-planner + chinese-novelist 处理

**触发**：细纲点头 + 用户说"写第 N 章"。

**产出**：
- `outline/chapters/chapter-N.md`（chapter-planner 写）
- `chapters/第N章-标题.md`（write_chapter 写）
- wiki 沉淀（wiki_ingest）
- 一致性报告（consistency_check，≥3 章后）

---

## 什么时候重启某阶段

| 触发 | 回退到哪 |
|---|---|
| 用户改了 SOUL 里的核心字段 | 重新跑 ②③④⑤⑥（级联失效） |
| 用户改世界观某项 | 重新跑 ③（如涉及人物）或直接改 ④ |
| 用户改某卷方向 | 重新跑对应 ⑤⑥ |
| 用户改某个 arc 走向 | 重新跑 ⑥（相应 arc）+ 涉及的未写章节 |
| 已写章节内容与任何上游大纲冲突 | 运行 consistency_check 报告；由用户决定是改章还是改大纲 |

级联失效时**要备份**旧版，不是无痕覆盖。

---

## 进度跟踪

每阶段完成后 **追加**写入 `progress/setup-state.md`：

```markdown
# 立项进度

- [x] ① SOUL.md（2026-05-04）
- [x] ② 世界观包（2026-05-04）
- [x] ③ 主要人物（2026-05-04）
- [x] ④ 总纲（2026-05-05）
- [x] ⑤ 第 1 卷卷纲（2026-05-05）
- [x] ⑥ 第 1-5 章细纲（2026-05-05）
- [ ] 第 1 章正文
```

工具：`update_progress`（路径 `progress/setup-state.md`）

---

## 反面禁忌

- ❌ 用户只说"写第 1 章"时，如果 ②③④⑤⑥ 全缺，**不要直接开写**，先提示用户"设定还没搭，我建议先搭完再写，走完 7 阶段大概 XX 轮对话"
- ❌ 跳过用户确认一口气生成 6 个阶段的内容（上下文爆炸 + 用户失控感）
- ❌ 直接跳过 ⑥ 从卷纲写章（没细纲 = 每章各自为战 = 节奏崩）
- ❌ 在 ②③ 阶段写得过于详细（500 字/文件就是上限，够用即可，后面 wiki-ingest 会增补）
