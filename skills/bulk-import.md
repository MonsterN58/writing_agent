---
name: bulk-import
description: 用户一次性贴/上传完整设定集时使用。结构化解析 → 分类 → 多文件落盘 → 阶段确认 → 跳到立项 ③。
phase: setup:bulk_import
chains_from: [work-setup]
chains_to: [setup-pipeline, outline-collaborator]
must_call_tools: [setup_status, plan_tasks, wiki_ingest, update_progress, lookup_rebuild, conflict_check]
forbid_tools: [write_chapter]
exit_when: [knowledge/world/* exists, knowledge/entities/* exists, knowledge/lookup.json exists]
prerequisite_files: [SOUL.md]
---

# 设定集导入 skill（bulk-import）

## 何时触发
- 用户说：「我把设定贴给你」「我有现成的设定」「这是我之前写的设定集」「导入设定」
- 立项阶段 ① 时，用户消息正文超过 800 字符且含「设定/世界观/主角/势力/修炼/体系」等
- 用户走 `work-setup` 第一步选了 B 分支

## 前提
- **必须**已有 SOUL.md（立项阶段 ≥ ①）。如果 stage=0，先调 `setup_work` 写一份**精简版 SOUL**（题材+主角一句话+核心冲突），导入完成后再让用户回头精修。

## 输入形态
1. 用户在聊天里直接贴长文本（最常见）
2. 用户上传一份 `.md` / `.txt`（前端 /import modal，未来扩展）
3. 用户分多次贴（"先发世界观"→"再发人物"），需要识别拼接

## 工作流

### Step 1 · 调 plan_tasks
导入是**多步任务（≥5 步）**，第一步必须调 `plan_tasks` 列 todo：
```
- t1 解析输入并分类
- t2 写世界观（world/*.md）
- t3 写主要人物（entities/*.md）
- t4 写人物关系（relationships.md）
- t5 写关键概念（concepts/*.md）
- t6 跑一致性自检 + 报告
```
执行过程中持续更新 status。

### Step 2 · 解析（在 <thinking> 里完成）
按下表分类。**不要漏掉任何段落**。如果某段不知道归哪类，**调 `ask_user` 问用户**。

| 文本特征 | 落地路径 | 工具 |
|---|---|---|
| 题材/基调/篇幅/风格定位 | `knowledge/world/overview.md` | update_progress |
| 修炼/魔法/科技/异能等等级体系 | `knowledge/world/power-system.md` | update_progress |
| 势力/组织/家族/帮派 | `knowledge/world/factions.md`（宏观） + 每个组织一个 `knowledge/entities/<slug>.md`（type=faction） | update_progress + wiki_ingest |
| 大陆/城邦/秘境/地图 | `knowledge/world/geography.md` | update_progress |
| 时间线/历史/重大事件 | `knowledge/world/history.md` | update_progress |
| 世界规则/铁律（"灵气只能…"） | `knowledge/world/rules.md` | update_progress |
| 风俗/节日/称谓 | `knowledge/world/customs.md` | update_progress |
| **角色（每人一段）** | `knowledge/entities/<slug>.md`（type=character） | wiki_ingest |
| 角色之间的关系 | `knowledge/relationships.md` | update_progress |
| 关键术语/概念定义 | `knowledge/concepts/<slug>.md` | wiki_ingest |
| 已知伏笔/悬念 | wiki frontmatter 的 foreshadow_open | wiki_ingest |

### Step 3 · 分批落盘（建议顺序）
**世界观 → 人物 → 关系 → 概念**。每完成一类就 `plan_tasks` 更新 status 并 emit 进度。

人物文件 frontmatter 模板（参考 character-bible skill）：
```yaml
---
id: lin-chen
name: 林尘
type: character
aliases: [林公子]
status: 凡人
faction: 林家
power_level: 0
goal: 打破命运
foreshadow_open: []
first_appear_chapter: 1
---
```

世界观文件每类只留**结构化要点**（不要复制大段散文）：
- overview：3-5 行核心定位
- power-system：等级表 + 升级条件 + 上限
- factions：表格（名/属性/规模/驻地/与主角关系）
- rules：编号铁律列表

### Step 4 · 不确定项调 ask_user
- 用户没明说哪个是主角 → ask_user 「这几个角色里谁是主角？」
- 修炼体系描述不清晰 → ask_user 「等级是 9 阶还是 7 阶？」
- 出现"似乎是势力又像物品"的歧义实体 → ask_user

### Step 5 · 写完后自检
1. 调 `wiki_query` 关键词遍历（主角名、力量体系名）确认能命中
2. 调 `consistency_check` 把内部矛盾（修炼体系前后不一致、人物年龄冲突）列报告
3. 给用户摘要：

```
✅ 已导入
- 7 个人物 (knowledge/entities/)
- 5 份世界观文档 (knowledge/world/)
- 1 份关系图 (knowledge/relationships.md)
- 3 个关键概念

📊 立项阶段：① → ③（已跳过逐步引导）
📍 下一步推荐：写总纲（outline/overall.md）

⚠️ 自检发现 2 处需澄清：
1. 主角林尘的年龄文中"15 岁"和"17 岁"两次出现
2. 修炼"凝气期"在主角介绍是 9 层，体系页只有 7 层
请告诉我以哪个为准。
```

### Step 6 · 跳阶段
导入完成后，**setup-pipeline 立项阶段直接从 ① 跳到 ③（主要人物已立）**，跳过逐步引导的 ②③ 步。下一次 setup-pipeline 触发时直接引导用户写总纲。

## 红线
- 不要"创造"用户没写的设定（用户没说主角眼睛颜色就**留空**，不要补"漆黑如夜"）
- 不要把整段散文原样塞进 `body` —— 提取**结构化要点**才是 wiki 价值
- 落盘量大时**严格遵循 plan_tasks**，避免一次塞 20 个 tool_calls 撑爆 context
- 解析过程必须在 `<thinking>` 标签里输出推理，让用户能审核分类逻辑
