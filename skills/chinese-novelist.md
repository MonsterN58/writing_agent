---
name: chinese-novelist
description: 中文小说单章正文写作主流程，必须读取上下文、lookup 与 wiki 后写入单章正文。
phase: write:chapter_draft
chains_from: [chapter-planner]
chains_to: [wiki-ingest, continuity-guard]
must_call_tools: [setup_status, get_chapter_context, lookup_query, wiki_query, read_file, write_chapter]
forbid_tools: [setup_work]
exit_when: [chapters/第N章-*.md exists]
prerequisite_files: [SOUL.md, outline/overall.md, outline/arcs/*, outline/chapters/chapter-N.md, knowledge/lookup.json]
---

# Chinese Novelist: 中文小说创作助手

## 核心流程

### 第一阶段：读 SOUL.md + 补 2 问

**先读作品宪章，再问 SOUL.md 没覆盖的字段。不重复询问 work-setup 已收集的题材/主角/性格。**

#### Step 1：检查作品宪章

判断 system prompt 已注入的 `<work_instructions>` 块（lead_agent 在每 Run 启动时自动注入 SOUL.md 内容）：

- **块不为空**：从中提取 题材/主角/性格/世界观/红线，后续创作必须遵守
- **块为空（SOUL.md 不存在）**：提示用户先跑 `work-setup` skill 生成 SOUL.md（或由你引导用户口头说明核心设定后调 `setup_work` 工具生成）。**不要跳过**——缺少 SOUL.md 等于缺少作品基调和红线约束

> **不要 `read_file /mnt/user-data/SOUL.md`** —— lead_agent 已注入。重复加载只是浪费 token，且与逐章流程"已注入别 read"指令冲突。

#### Step 2：推断 2 个隐含字段（默认推断 + 兜底问）

work-setup 不收集两个字段，但章节创作必须有：

| 字段 | 默认推断逻辑（从 SOUL.md 题材 + 主角动机） |
| ---- | ---- |
| **核心冲突** | 玄幻/修真 → 成长突破；都市 → 权力争夺/成长突破；言情 → 爱情阻碍；悬疑 → 查明真相；其他 → 看主角动机字段 |
| **篇幅等级** | 默认中篇（10-30 章 / 5-15 万字）；SOUL 主角字段含「重生 / 系统 / 穿越」等长线设定 → 长篇 |

**默认走推断路径**：

1. 看 SOUL.md 题材 + 主角字段推断这两个值
2. 推断结果**在第二阶段确认环节显式亮给用户**（例："核心冲突我会聚焦在查明真相、按中篇节奏铺"）
3. 用户认可 → 进第三阶段开写；用户说"不对，改成 X" → 改完再开写

**仅在 SOUL.md 题材字段缺失或模糊到无法推断时**才用自然对话依次问 2 问（候选见备查）：

- 核心冲突候选：① 生死存亡 ② 查明真相 ③ 爱情阻碍 ④ 复仇雪恨 ⑤ 权力争夺 ⑥ 成长突破 ⑦ 守护保护
- 篇幅等级候选：① 短篇（10 章以内 / 5 万字以下） ② 中篇（10-30 章 / 5-15 万字） ③ 长篇（30 章以上 / 15 万字以上）

> 注：网文"章节数"是预期非承诺，写作中可灵活调整。该问时也用自然对话不调 `ask_clarification`（lead_agent prompt 的 `<clarification_system>` block「When NOT to use ask_clarification」条款禁 multi-step skill 内连环调）。

***

### 第二阶段：开写前确认（亮假设让用户兜底）

用一两句话向用户复述（基于 SOUL.md + Step 2 推断的核心冲突 + 篇幅等级），把推断假设**显式亮出**：

> 例："我理解你想写的是：[一句概括]。核心冲突我会聚焦在 [推断的核心冲突]，篇幅按 [推断的篇幅等级] 节奏铺。如果哪里不对说一声，否则我直接开始第 1 章。"

得到用户认可（或修正后再认可）后**直接进入第三阶段开写第一章**。

**不生成任何规划文件**：
- 人物档案由 wiki-ingest 在章节写完后自动沉淀到 `/mnt/user-data/knowledge/entities/`
- 世界观/设定由 wiki-ingest 沉淀到 `/mnt/user-data/knowledge/concepts/`
- 章节摘要由 wiki-ingest 追加到 `/mnt/user-data/knowledge/log.md`
- **禁止**手写 `knowledge/outline.md` 或 `knowledge/characters/`——那是 wiki 的领地，抢活会双源打架
- **禁止**手写 `/mnt/user-data/knowledge/entities/` 或 `/mnt/user-data/knowledge/concepts/`——必须通过 wiki-ingest skill 产出
- **伏笔状态 tag** 由 wiki-ingest 在 entities/concepts frontmatter 写入（`foreshadow: open | closed | dropped`），本 skill 只用 `grep` 查询、不直接改 tag。详见 [foreshadowing-ledger.md](references/foreshadowing-ledger.md)

***

### 第三阶段：写章（**单章边界铁律**）

**最高优先级铁律（覆盖本 skill 其他任何措辞）：**

- 用户说"**写第 N 章**" / "**写第一章**" / "**接着写**" / "**下一章**" → **只写一章**，写完停下交付摘要，**禁止顺手继续写第 N+1 章**。
- 用户说"**写第 X-Y 章**" / "**连写 3 章**" → 才允许连写指定范围，且每章之间停下 emit 摘要事件 `chapter_saved`。
- 用户说"**继续**"且无歧义（明确指上一章话题的下一章）→ 写下一章一章。
- 看到 `outline/arcs/arc-*.md` 里有 5 章规划，那是**参考**，不是"必须一气写完 5 章"的任务单。
- 不确定边界（"接着写到结束"含糊）→ 调 `ask_user`：「我先只写第 N 章交给你审，后面几章等你确认再继续？」

**为什么**：每章 2500+ 字，连写 5 章 = 一次输出 1 万 2 千字 + 5 次 wiki_ingest + 5 次 consistency_check，token 爆炸、用户审章节奏被打断、错误一旦发生连锁 5 章。

**正确的章末交付摘要格式**：
```
✅ 第 N 章「<标题>」已落盘（约 X 字）
- 钩子：<本章末尾留的悬念一句话>
- 沉淀：本章新增了 X 个实体/Y 个概念到 wiki
- 一致性：通过 / 发现 N 处需注意

要不要先看下这章再决定下一步？还是直接说"写第 N+1 章"我接着写？
```

***

## 单章创作流程

每章 4 步：**写前准备 → 撰写（带预防性约束） → 终审（一次性） → 收尾**。

> 设计原则：所有"质量约束"在**撰写阶段（2）开写之前前置进 prompt**（事前引导），不靠**终审阶段（3）**写完再扫一遍（事后审计）。多步串行检查 = 用户等待时间膨胀的根源。

### 1. 写前准备

1. SOUL.md 已由 lead_agent 在每 Run 启动时静态注入 system prompt（基调、红线、世界观）——**直接参考已注入的 `<work_instructions>` 块，不要 `read_file`**，重复加载只是浪费 token
2. `ls /mnt/user-data/chapters/` - 看已写到哪一章（文件系统即是 TODO）
3. 读上一章文件查悬念 - `read_file /mnt/user-data/chapters/第<N-1>章-xxx.md`
4. 若存在则读 wiki 账本 - `read_file /mnt/user-data/knowledge/index.md` + `read_file /mnt/user-data/knowledge/log.md`（前面章节由 wiki-ingest 沉淀的实体/概念/摘要）
5. 一致性回顾 - 用 `grep` 搜索本章涉及的关键角色/物品/地点在前文中的描写（如 `grep "萧凌 修为" /mnt/user-data/chapters/*.md`），确认细节一致。**仅在已有 3 章以上时执行**
6. **读体裁剧本** - 按 SOUL.md 题材字段查 `genre-playbook` 类资料（如果项目 `skills/` 下有 `genre-playbook.md` 则 `read_file` 加载，没有则跳过）。缺了这一步可能飘回泛类型腔调
7. **查 open 伏笔** - 调 `wiki_query` 关键词 `foreshadow:open` 或 `read_file knowledge/foreshadow-ledger.md`（若存在）。强制产出：列表至少打印一次（即使为空也要显式确认 "no open foreshadow found"）
8. **世界观体检（仅设定密度高的题材触发）** - SOUL.md 题材属于 **玄幻 / 修真 / 西幻 / 科幻 / 末世 / 武侠** 时，按以下 4 题自检（无需 read_file，规则即题）：W1 核心约束（这章会用到的世界规则是哪一条？），W2 力量代价（主角动用力量是否付出对应代价？），W3 势力争夺（本章涉及的势力有没有竞争利益？），W4 常识落地（这个世界里普通人怎么做这件事？）。**都市 / 言情 / 悬疑 / 历史 / 军事 / 游戏** 默认跳过。本节只读不写，结论落到正文细节
9. **判定本章节奏拍位** - 按拍位四档判定（无需 read_file，规则即题）：**爽**=主角达成阶段目标 / 打脸 / 装逼，**憋**=受阻 / 被压制 / 信息揭露但无力反击，**打**=实战冲突，**升**=修为 / 资源 / 关系 / 认知层面提升。**这一步是写之前定调，不是写完再校** —— 拍位决定冷热段分布，写之前定好，写正文时主动遵守
10. 设计开头钩子 - 前 20% 即时冲突 → [chapter-guide.md](references/chapter-guide.md)（10 种开头技巧）
11. 规划场景 - 3-5 个场景

> 💡 **加速提示**：写前准备**第 3、5、7 项之间无依赖**（一次 read_file 上一章 + 两次 grep），**应在同一个 LLM turn 里并行调用**，缩短写前等待。第 6 项（体裁剧本）按需 `read_file skills/genre-playbook.md`；第 8、9 项（世界观体检 / 节奏拍位）规则极简、直接对照规则在脑内判断即可，**不消耗 tool_call**。第 1-2 项（已注入信息 / ls 看进度）零成本，第 10-11 项（钩子设计 / 场景规划）依赖前面的上下文，需在并行那批回来后再做。

### 2. 撰写（带预防性约束）

12. 创建章节文件到 `/mnt/user-data/chapters/` 目录 - 命名 `第N章-章名.md`（如 `/mnt/user-data/chapters/第1章-吞噬.md`）。**N 为正整数、禁止前导零**：`第0章-序.md` 和 `第01章-吞噬.md` 会被后端正则 `^第([1-9]\d*)章-(.+)\.md$` 拒绝（wiki-ingest 静默不触发）。章节文件只包含正文，不加任何元数据

13. 撰写正文时**主动遵守以下事前约定**——不是写完再扫一遍，是写的时候就避开：

    **A. 字数目标（用户主权）**：
    - 用户当下说了多少 → 按用户的来
    - 用户没说，SOUL.md 有"推荐字数"字段 → 按 SOUL 的来
    - 都没有 → 默认 2500 字左右（高潮/打脸章可到 3500），**软建议、不硬卡**
    - 详见下方 §字数策略

    **B. 节奏拍位（按写前第 9 项判定的拍位写）**：
    - 冷热段落保持 3:7 比例
    - 不要连续 1000+ 字纯冷段 / 1500+ 字纯热段
    - 拍位是哪一拍，开头/中段/收束的情绪曲线参 [pacing-rhythm.md](references/pacing-rhythm.md)

    **C. 反 AI 味（事前硬约束，写的时候就避开，不靠写完扫）**：

    **C1·禁用词黑名单（闭眼写也不能出现）**：
    瞳孔骤缩 / 脸色一变 / 脸色骤变 / 心头一震 / 心潮澎湃 / 热血沸腾 / 握紧拳头 / 咬紧牙关 / 深吸一口气 / 嘴角微微上扬 / 嘴角勾起一抹 / 眼神坚定 / 眼神复杂 / 眸光闪烁 / 眼眸深邃 / 寒光闪烁 / 不禁 / 忍不住 / 不由得 / 骤然 / 霎时 / 刹那间 / 千钧一发 / 心中暗道 / 不动声色 / 鲜血从嘴角溢出 / 嘴角溢出一抹血丝 / 命运的齿轮 / 前所未有 / 现在看来 / 原来如此 / 一道道目光 / 仿佛连空气都凝固了。
    出现一个就算违章，写之前反问自己「能不能用动作 / 物件 / 慎重台词替掉」。

    **C2·破折号密度上限**：每千字 "——" 总数 ≤ 2 个。章末收束句**禁用**「……」、「——」、「他选了——」这类开放式留白。留白用具体动作或环境音（灯灭了一盏 / 雨打在棚顶）替代。

    **C3·章末禁用模板**：
    - 「月光下，他……」/「夜色中，他……」 开场的抒情收束
    - 「原来如此」/「原来这一切」/「这一刻他才明白」 报幕式读者提示
    - 「鲜血从嘴角溢出」/「抹去嘴角的血迹」 万能受伤表演
    - 「全场寂静」/「所有人倒吸一口气」/「仿佛时间都静止了」 围观型爽点反应
    - 「他握紧拳头」+ 任何会意动作 的双件套

    **C4·反思检查点（写完一段问一遍）**：
    - 是否连续 3 句句首都是 「他 / 她 / 他看 / 她说」？
    - 是否连续 2 个段落都以主角心理独白收束？
    - 人物情绪是否是「靠形容词表达」而非「靠动作 / 物件 / 台词透露」？
    - 场景描写是否只有视觉，没有听觉 / 触觉 / 温度 / 气味？

    **C5·与上游 skill 的关系**：本节 C1–C4 是 humanizer skill 的**预防型轻量黑名单**，不需调用 humanizer。humanizer 完整诊断（P1–P15）仍是事后清洁工具，只在用户明示「这章 AI 味重」时才调。

    **D. 开头**：前 20% 极其吸引人（即时冲突或悬念）→ [chapter-guide.md](references/chapter-guide.md)

    **E. 对话规范** → [dialogue-writing.md](references/dialogue-writing.md)

    **F. 结尾钩子** → [hook-techniques.md](references/hook-techniques.md)（10 种钩子类型）

    **G. 笔力卡壳兜底**：写到一半发现内容不够时用 [content-expansion.md](references/content-expansion.md) 扩充技巧。**不是写完发现字数没达标再回头扩** —— 那种事后注水正是 [scene-sequencing](../../writing-structure/scene-sequencing/SKILL.md) 反对的反模式

### 3. 终审（一次性、只通知不重写）

14. 写完后**一次性检查 4 项**（不分多轮 LLM 调用）：

    * **节奏复核**：实际冷热段分布是否符合写前第 9 项判定的拍位
    * **一致性**：本章新出现的人物/物品/地点跟前文是否冲突（按需 `grep`，不强制）
    * **伏笔留痕**：本章若埋新伏笔或回收已 open 伏笔，在章末正文里明确标注（例如末尾点出"那枚古钥他握在掌心"），保证 wiki-ingest 能识别伏笔变动并更新 frontmatter tag
    * **字数告知**：实际字数由前端从 DB（`chapter.word_count` 字段，章节卡片自动展示）告知用户，**LLM 不承诺数字**——bash 关闭后估算不可靠。仅当 LLM 明显感觉本章异常短（不到一半正常长度，疑似截断）才主动提示"本章可能不完整，是否补写？"

    **用户主权**：上面任一项有问题，**先告知用户具体问题 + 询问是否需要修订**——不要 LLM 自作主张整章重写。用户说改才动，不说就交付。如果用户确认要改，**一次性输出整章修订版**（不再分多轮）。

    > 伏笔留痕是例外：那是写章末时顺手补一句话的小动作，不需要询问用户。其他三项（节奏 / 一致性 / 字数）发现问题都先问。

### 4. 收尾

15. 写完 `chapters/第N章-xxx.md` 即完成本章。**wiki-ingest 由项目内置 marker 机制在下一轮 LLM 调用时自动触发**沉淀人物/概念/伏笔，本 skill 不需主动调用 wiki-ingest。

***

## 不在本 skill 主流程内的事（独立 skill，按需 trigger）

以下末端诊断工具是独立 skill，**用户主动 trigger 才触发**，本 skill 主流程不内嵌完整调用：

| 用户场景 | 触发 | 本 skill 是否已预防 |
|---|---|---|
| 觉得某章 AI 味重（"像 ChatGPT / 每段破折号 / 每章正能量"） | `/humanizer` | ✅ 上面 13C1–C4 是轻量版黑名单，已处理 80% 常见 P5/P7/P11 |
| 觉得整体声音不对（"白开水 / 紫色散文 / 句式单调 / 风格漂"） | `/prose-style` | 部分预防，跨章一致性需 prose-style 完整诊断 |
| 觉得情节套路（"光环过头 / 反转老套"） | `/cliche-transcendence` | 未预防 |
| 觉得对白扁平（"每个人物说话一个调"） | `/dialogue` | 未预防 |

**设计调整（重要）**：humanizer / prose-style 过去只作为「事后清洁」，导致初稿生成阶段零去-AI-味约束。现在**第 13 步 C 段已内嵌 humanizer 轻量黑名单**（禁用词 / 破折号密度 / 章末模板）作为预防性约束，避免「写出 AI 文本 → 用户反馈 → P3 学习 → 下次才修」这个不闭合的循环。完整诊断（P1–P15 扫描 / 句长调准 / 跨章声音漂检测）仍走事后 trigger，不变。

***

## 三大黄金法则

1. **展示而非讲述** - 用动作和对话表现，不要直接陈述
2. **冲突驱动剧情** - 每章必须有冲突或转折
3. **悬念承上启下** - 每章结尾必须留下钩子

### 字数策略（用户主权）

字数以**用户偏好为准**，平台只告知不裁判：

```
优先级：用户当下指令 > SOUL.md 偏好字段 > 默认软建议
```

- 用户说"这章 2000 字" → 写 2000
- 用户说"5000 字大章" → 写 5000
- 用户说"短一点 1500 就行" → 写 1500
- 用户没说，SOUL.md 有"推荐字数"字段 → 按 SOUL 的来
- 都没有 → 默认 2500 字左右（高潮/打脸章约 3500），**软建议、不强制**

**终审阶段（3）字数告知改由前端展示**（前端从 DB `chapter.word_count` 字段读，章节卡片自动展示），不再"低于 X 必须扩充 / 高于 Y 必须拆章"——用户写微小说要 800 字、写长篇精品要 5000+ 字，都该被尊重。LLM 不承诺数字（bash 关闭后估算不可靠），仅当明显感觉本章异常短（不到一半正常长度，疑似截断）才主动提示是否补写。

#### 字数辅助脚本（仅本地开发环境）

`scripts/check_chapter_wordcount.py` 仍然保留，**仅作为统计展示工具**，不再作为流程硬卡。

> ⚠️ **生产环境 bash 默认禁用**（`config.yaml: allow_host_bash=false`）—— 下面 bash 命令仅在 `allow_host_bash=true` 的本地开发环境可用。**生产环境字数应直接由前端从 DB 读取**（`chapter.word_count` 字段，章节卡片自动展示），LLM 不要尝试调脚本，不要在用户问字数时编估算值。

仅当用户主动问字数 + 处于本地开发环境时才调用：

```bash
# 看单章字数
python /mnt/skills/public/writing-chinese-novel/chinese-novelist/scripts/check_chapter_wordcount.py /mnt/user-data/chapters/第1章-吞噬.md

# 看全书字数分布
python /mnt/skills/public/writing-chinese-novel/chinese-novelist/scripts/check_chapter_wordcount.py --all /mnt/user-data/chapters/
```

脚本 exit code（`pass=0 / fail_low=1 / warn_high=2`）保留供运营/排错用，**不再驱动 LLM 重写动作**。

### 文件命名规范

| 文件   | 路径                          | 示例                                       | 写入方 |
| ---- | --------------------------- | ---------------------------------------- | :----- |
| 章节文件 | `/mnt/user-data/chapters/第N章-章名.md` | `/mnt/user-data/chapters/第1章-吞噬.md`、`/mnt/user-data/chapters/第2章-浑圆桩.md`（N 正整数、无前导零） | chinese-novelist |
| 作品宪章 | `/mnt/user-data/SOUL.md` | 题材、主角、性格、世界观、红线 | work-setup（只读） |
| 人物实体 | `/mnt/user-data/knowledge/entities/<slug>.md` | `entities/lin-weiyang.md` | wiki-ingest |
| 设定概念 | `/mnt/user-data/knowledge/concepts/<slug>.md` | `concepts/cultivation-system.md` | wiki-ingest |
| 章节账本 | `/mnt/user-data/knowledge/log.md` | 章节摘要 append-only | wiki-ingest |

---

## 降级方案（FAQ）

**Q1：SOUL.md 不存在，用户要求直接开写怎么办？**
A：按第一阶段 Step 1 要求，**先引导用户跑 work-setup skill 生成 SOUL.md，或让用户口头说明核心设定后你调 `setup_work` 工具**。不要跳过 —— 缺 SOUL.md 等于缺红线约束，写出来的东西基调会飘。

**Q2：为什么不再"硬卡 2000-4000 字 / fail_low 必须扩充"了？**
A：上线产品的姿态是 — **字数由用户说了算，平台只告知不裁判**。用户写微小说要 800 字、写长篇精品要 5000+ 字都该被尊重。`fail_low/warn_high` 时代用脚本逼模型重写，是把网文行业惯例当平台铁律 — 错。而且强制 fail_low 重写会鼓励"塞设定/景物/回忆凑数"，正是 [scene-sequencing](../../writing-structure/scene-sequencing/SKILL.md) 反对的注水反模式。生产环境 `bash` 默认禁用，脚本本来就跑不动，正好顺势退到"用户主动想看时用"的辅助工具。

**Q3："一致性回顾需已有 3 章以上"这个阈值的由来？**
A：第 1-2 章时前文信息极少，`grep` 基本命中不到有效结果；第 3 章起才有足够文本支撑细节一致性核查。写第 1 章 **跳过写前第 5 项**（一致性回顾），直接做第 6 项（读 playbook）；第 2 章如果觉得有必要可执行，但非强制。

**Q4：用户说"我想每章写 X 字"，怎么生效？**
A：直接在下一章生成时按用户指定数走 — 不需要修改 SKILL，不需要重启会话。如果用户希望整本作品都按这个字数走，建议把字数偏好写进 SOUL.md（用户跑 `/work-setup` 时可以提，或事后让用户自己改 SOUL.md），后续每章自动遵循。

**Q5：为什么把"深度润色去 AI 味"从主流程里删掉了？**
A：去 AI 味的 6 条规则已经前置到撰写阶段（2）的事前约定 C 段主动遵守，**写之前说一次胜过事后扫十次**。模型生成时就不会堆"璀璨瑰丽/心潮澎湃"，根本不需要事后再改一遍。如果用户读完仍觉得 AI 味重，独立的 [`/humanizer`](../../writing-craft/humanizer/SKILL.md) 技能会做定向精修——这正是 humanizer 自己的设计意图（其 SKILL.md L14 明确反对 drafting 中途插入）。把它内嵌进主流程 = 每章多一轮 LLM 调用 + 违反 humanizer 自身定位，纯亏。

