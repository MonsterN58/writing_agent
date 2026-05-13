# Skill 调度决策树（lead_agent 内部参考）

> 这份文档**不是 skill**，是给 lead_agent / 路由层（`server/services/skills.js`）的"如何选 skill"地图。
> 当用户开口时，按下面的决策树定位 skill；多 skill 命中时按"上游优先"原则取一份再叠 chain。
> 设计目标：让"用户意图 → 落盘资产 → 下一步"三段链路尽量自动，不要让用户每轮都被问"你想干嘛"。

---

## 一、入口分诊（**判定顺序自上而下**）

按下表的 if-else 顺序判定意图，命中即跳出。

| # | 触发条件 | 路由到 |
|---|---|---|
| 1 | `setupStage.stage === 0` 且用户提了"想写小说/有灵感/新书" | `setup-bootstrap` → `work-setup` |
| 2 | `setupStage.stage === 0` 且用户**贴了 ≥ 800 字**完整设定文档 | `bulk-import` |
| 3 | `setupStage.stage === 1`（仅有 SOUL）+ "继续/下一步/搭设定" | `setup-pipeline`（接力跑 ②-⑦） |
| 4 | `setupStage.stage === 2-7` + "继续/补设定/下一步" | `setup-pipeline`（从当前阶段接力） |
| 5 | `setupStage.stage >= 7` + "写第 N 章/开写" | `chapter-planner` → `chinese-novelist` |
| 6 | "调文风/voice 锚/style" + 已写 ≥ 3 章 | `style-voice`（从已写章节反向统计） |
| 7 | "调文风/voice 锚/style" + 未写章节 | `setup-bootstrap`（冷启动 A/B/C 三选一） |
| 8 | "改稿/改章/重写第 N 章" | `revision` → 必要时 chain `humanizer` / `prose-style` |
| 9 | "聊聊剧情/讨论故事" | `story-collaborator` 或 `story-coach`（看用户要建议还是引导） |
| 10 | 短应答（"嗯/好/继续"等 ≤ 8 字） | **不装新 skill**，按上轮 in_progress 任务推进 |
| 默认 | 命中关键词的 skill 们叠加（最多 3 个），优先级 = 5 的优先 | `SKILL_CATALOG.keywords` 模糊匹配 |

---

## 二、立项链（setup phase）的标准走法

```
用户冷启动
   │
   ├─ 用户没头绪 / 想被引导 ──► setup-bootstrap (style-voice baseline)
   │      └─► work-setup (SOUL.md)
   │             └─► setup-pipeline (世界观→人物→地点→物品→总纲→卷纲→arc)
   │                    └─► chapter-planner (第 1 章单纲)
   │                           └─► chinese-novelist (第 1 章正文)
   │
   ├─ 用户有完整设定 / 贴长文档 ──► bulk-import
   │      └─► setup-pipeline（从命中的阶段继续）
   │
   └─ 用户要 fanfic / 改编 ──► adaptation-synthesis → dna-extraction → work-setup
```

> **关键**：lead_agent 在每个阶段完成后**必须问用户**"继续下一步还是先调整本步？"，不要一口气跑完全链——用户失控感 + 上下文爆炸。

---

## 三、写作链（writing phase）的标准走法

```
用户："写第 N 章" / "开始第 N 章"
   │
   ├─ get_chapter_context (gate auto-inject)
   │      └─ 读入：SOUL / outline/* / arc 段 / wiki 状态 / voice + voice-dict / 上章末
   │
   ├─ wiki_query (gate auto-inject)
   │      └─ 查本章涉及实体的设定底
   │
   ├─ chapter_planner（如 outline/chapters/chapter-N.md 不存在）
   │      └─ 写单章纲（含三级目标链：本章 → arc 节 → 卷级 → 总纲）
   │
   ├─ chinese-novelist
   │      └─ 单章节落盘到 chapters/第N章-标题.md
   │
   └─ 写后链：
         ├─ wiki_ingest（实体/伏笔/状态快照沉淀）
         ├─ foreshadow-tracker（重建 foreshadow.md + alerts）
         ├─ consistency_check（≥3 章后启用）
         └─ chapter_critic（必要时；硬 gate 不强制）
```

> ⚠️ **gate auto-inject 链**：`buildWriteChapterGateBlock` 会自动补跑 `get_chapter_context` / `wiki_query` 等前置，不需要让 LLM 手动 chain。

---

## 四、修订链（revise phase）的标准走法

```
用户："改第 N 章" / "重写 X 段"
   │
   ├─ read_file 第 N 章全文（maxChars=0，强制读完整）
   │
   ├─ 诊断分流：
   │    ├─ 风格 / AI 味 ──► humanizer / prose-style
   │    ├─ 节奏 / 拍位 ──► pacing-control / scene-sequencing
   │    ├─ 对白 / 声音 ──► dialogue
   │    ├─ POV / 时态 ──► pov-and-tense
   │    ├─ 文风稳定 ──► style-voice
   │    ├─ 套路 / 老梗 ──► cliche-transcendence
   │    ├─ 钩子 / 章末 ──► hook-and-cliffhanger
   │    └─ 一致性硬伤 ──► continuity-guard / consistency_check
   │
   ├─ 改写（chinese-novelist 二次落盘 / write_chapter 覆盖）
   │
   └─ 改完后必跑：
        ├─ wiki_ingest（如改动影响实体状态）
        ├─ consistency_check
        └─ revision_backup（保留旧版本）
```

---

## 五、风格系（style phase）的边界图

```
                    ┌──────────────────────────┐
                    │     setup-bootstrap        │  ← 冷启动，必走 ask_user
                    │  · 三选一 A/B/C             │
                    │  · 写 voice.md + voice-dict │
                    └────────────┬───────────────┘
                                 │
                                 ▼
                    ┌──────────────────────────┐
                    │      style-voice           │  ← 后验，从已写章反向统计
                    │  · 升级 voice / voice-dict  │
                    │  · ≥ 3 章后调               │
                    └────────────┬───────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
        ┌───────────┐     ┌───────────┐     ┌───────────┐
        │  humanizer │     │ prose-style│     │  dialogue  │
        │ AI 味轻量诊 │     │ 文风重型诊 │     │  对白诊断  │
        │（运行时黑名 │     │（章后专项 │     │（章内段落 │
        │ 单已内嵌防 │     │ 修复时跑） │     │ 修复时跑） │
        │ 护，按需触 │     │            │     │            │
        │ 发）       │     │            │     │            │
        └───────────┘     └───────────┘     └───────────┘
```

| Skill | 何时跑 | 产出 |
|---|---|---|
| `setup-bootstrap` | SOUL 之前，从 0 建立 | `style/voice.md` + `style/voice-dict.md` |
| `style-voice` | ≥ 3 章后 / 风格漂移 | 升级 voice + voice-dict |
| `humanizer` | 单章 critic 报告 AI 味偏高时 | 改写后的章节 + 反 AI 味记忆 |
| `prose-style` | 用户主动说"文笔差/太白开水/太紫" | 段落级改写示范 + voice 偏好更新 |
| `dialogue` | 用户说"对白生硬/同质化" | 对白段改写示范 |

---

## 六、伏笔与一致性（quality phase）

```
write_chapter 完成
       │
       ├─ wiki_ingest (sync)
       │     ├─ 写实体/概念/地点
       │     ├─ rebuildForeshadowLedger
       │     │     └─► foreshadow.md + foreshadow-alerts.md
       │     │           ├─ overdue / due_now / due_soon 分级
       │     │           ├─ 红/橙/黄/绿 年龄分级
       │     │           └─ open:closed ratio 预警
       │     └─ syncLookup（重建必读路径索引）
       │
       └─ consistency_check（每 3 章/手动触发）
             └─► 7 项检测：POV / 称呼 / 时间词 / 未知人名 / AI 味 / 对白比 / 句长节奏
```

| Skill | 何时调 |
|---|---|
| `wiki-ingest` | 每章写完后必跑（sync 实体/伏笔状态） |
| `wiki-lint` | 每 5-10 章 / 用户调 / 写完一卷 |
| `foreshadow-tracker` | wiki_ingest 内自动调，也可手动单独跑 |
| `continuity-guard` | 用户报"前后矛盾" / consistency_check 报红 |
| `consistency_check`（工具） | 每 3 章 / 用户调 |

---

## 七、特殊路由

### 7.1 用户开"教练模式"

> 触发："只问问题不要写"、"教练模式"、"我自己想/我自己写"

→ 切换到 `story-coach`（红线：**不生成内容、只引导**）。退出条件：用户明确说"开写吧"或长时间没问题。

### 7.2 用户问"我应该怎么写 X"（求建议但不要代笔）

→ `story-collaborator`（讨论性、可建议、可示范片段，但不直接落盘正文）

### 7.3 用户："起个名字 / 想个法宝名"

→ `naming` 单点 skill；不切上下文。

### 7.4 用户："总结 / 列清单 / 角色表"

→ `list-builder`；产出短报告，不落 SOUL/wiki。

---

## 八、反面 (lead_agent 必须避免的)

- ❌ **多 skill 抢话**：keywords 命中 5 个 skill 时全部加载——上下文爆炸 + 矛盾。**最多 3 个**，按 priority 取。
- ❌ **跳过 setup-bootstrap 直接 work-setup**：用户没风格基线就立 SOUL，写章 voice 还是 C 兜底，前 3 章必崩。
- ❌ **写章前没 chapter-planner**：缺单章纲 → write_chapter gate 阻断，反而要重跑。
- ❌ **每轮都重新装一遍主链 skill**：浪费 prompt cache。lead_agent 应**只在 phase 切换时**重装。
- ❌ **`humanizer`、`prose-style`、`style-voice` 同时装**：边界混乱。按"运行时已防护 + 出问题再触发重型诊断"的顺序，**默认只装 style-voice**，其他按需。
