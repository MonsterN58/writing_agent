---
name: foreshadow-tracker
description: 伏笔总账维护。扫 frontmatter foreshadow 字段重建 knowledge/foreshadow.md，按年龄/due_chapter/open:closed 比例分级输出预警到 progress/foreshadow-alerts.md。
phase: quality:foreshadow
chains_from: [wiki-ingest]
chains_to: []
must_call_tools: [wiki_ingest, update_progress]
forbid_tools: [setup_work, write_chapter]
exit_when: ['knowledge/foreshadow.md 已重建', 'progress/foreshadow-alerts.md 已刷新']
prerequisite_files: [SOUL.md]
---

# Foreshadow-Tracker：伏笔总账维护

## 调用时机

- **`wiki-ingest` 完成后自动链**（每章必跑）
- 用户主动 `/foreshadow` 命令查看总账
- `chapter-planner` 设计单章纲时调用本 skill 拉提醒（"哪些伏笔该回收了"）
- 用户问"还有什么伏笔没收？"

> **网文写崩的最大单点 = 伏笔挖了不填**。本 skill 是长线 QA。

---

## 核心任务

1. 维护 `knowledge/foreshadow.md` 总账（自动重建，不手写）
2. 计算每条 open 伏笔的"年龄"（埋设至今多少章）
3. 按阈值预警：
   - **15-29 章** = 🟡 黄色，可考虑推进
   - **30-49 章** = 🟠 橙色，强烈建议推进
   - **50+ 章** = 🔴 红色，必须本卷收尾前回收
4. 检测"伏笔过密"：同一卷内 open 超过 8 条 → 提醒用户先收老的再埋新的
5. 检测"伏笔零回收"：连续 10 章只埋不收 → 提醒用户调整节奏

---

## 流程

### 第 1 步：扫所有 frontmatter

```
grep -rEl "state: open" knowledge/entities/ knowledge/concepts/ knowledge/locations/
```

读每个命中文件的 frontmatter，提取所有 `foreshadow:` 列表里 state 为 open / closed / dropped 的条目。

### 第 2 步：计算年龄 + 分级

当前章号从 `progress/state.json` 读：

```
age = 当前章号 - set_chapter
```

按年龄分级（见上方阈值）。

### 第 3 步：聚合到总账

重写 `knowledge/foreshadow.md`：

```markdown
# 伏笔总账（自动维护，禁止手写）

> 最后更新：第 8 章后

## 🔴 红色（≥50 章）
（无）

## 🟠 橙色（30-49 章）
| 标签 | 实体/概念 | 埋设章 | 距今 | 摘要 |
|---|---|---|---|---|
| （无） |

## 🟡 黄色（15-29 章）
| 化神之上是否还有 | cultivation-realm | 1 | 7 | 师父曾说"化神不是终点" |

## 🟢 绿色（<15 章）
| 身世之谜 | lin-chen | 3 | 5 | 母亲玉佩透出血色 |
| 母亲玉佩来历 | lin-chen | 3 | 5 | 王家家主见玉佩失态 |
| 王家与林父旧怨 | wang-jia | 6 | 2 | 王家家主话中暗示 |

---

## Closed（已回收）
| 标签 | 实体 | 埋设章 | 回收章 | 回收方式 |
|---|---|---|---|---|

## Dropped（已废弃）
（无）

---

## 统计

- 总 open：4 条
- 平均年龄：4.75 章
- 本卷开放伏笔密度：4 / 8 章 = 0.5（健康，建议 ≤1.0）
```

### 第 4 步：异常预警

如果出现以下情况，**额外写一条警告到总账末尾 + 通知 lead_agent**：

| 异常 | 警告语 |
|---|---|
| open ≥ 8 条 | "⚠ 当前 open 伏笔 9 条，建议本卷内回收 3 条以上" |
| 连续 10 章零回收 | "⚠ 已 12 章未回收任何伏笔，节奏可能松弛" |
| 单条伏笔 ≥50 章 | "🚨 伏笔「化神之上」已 53 章未推进，本卷必须收" |
| 同一实体 open ≥4 条 | "⚠ 林尘身上挂着 4 条 open 伏笔，集中爆雷会让单点过重" |
| **open:closed > 5:1**（且 open ≥ 6） | "⚖ 承诺-兑现失衡：open 12 : closed 2 = 6.0:1（健康值 ≤ 5:1）。本卷内建议回收 N 条" |
| **open ≥ 5 且 closed = 0 且 当前章 ≥ 20** | "⚖ 累计开 N 条伏笔但**从未回收过**（已写 X 章），烂尾风险高" |

> ⚖ **承诺-兑现比例**是早期预警指标——比"年龄超阈"（≥50 章）更早提醒作者。真人网文作者的健康基线：每开 3-5 个伏笔必回收 1 个。本指标在第 30 章就能拦住失衡，不用等到第 50 章红线。

### 第 5 步：写入提醒文件供其他 skill 读

**额外写**一份精简版到 `progress/foreshadow-alerts.md`，供 `chapter-planner` 写下章纲时直接读：

```markdown
## 下章应优先考虑推进的伏笔

🟠 化神之上是否还有 (cultivation-realm, 距今 7 章)
🟢 王家与林父旧怨 (wang-jia, 距今 2 章) — 与本章主线相关，建议本章末或下章推进
```

---

## Closed 标记规则

伏笔什么算"回收"？

- **完全揭露**（"原来玉佩是父亲所留"）→ closed
- **部分推进但未完全揭露**（"玉佩里有人在呼吸"）→ 仍 open，但 set_chapter 不动，记录"推进章"到 frontmatter 备注
- **作者放弃了这条线**（用户明确说"这个伏笔不写了"）→ dropped

---

## 工具调用约定

| 工具 | 用途 |
|---|---|
| `foreshadow_scan` | 后端封装，本 skill 输出聚合 JSON 后由后端落盘 |
| `grep` | 扫 open 状态 |
| `read_file` | 读 frontmatter |
| `write_file`（白名单） | 仅可写 `knowledge/foreshadow.md` 和 `progress/foreshadow-alerts.md` |

**绝对禁止**：
- 不修改任何实体/概念文件的 frontmatter（那是 wiki-ingest 的事）
- 不"擅自" close 伏笔（必须用户在 wiki-ingest 抽取时由正文证据触发）
- 不删 dropped 条目（保留历史，方便用户回溯）

---

## FAQ

**Q1：用户写网文不喜欢挖伏笔，所有 open 都是 0 条，怎么办？**
A：本 skill 仅在 open ≥1 时输出预警。0 条 = 静默。

**Q2：伏笔标错了（实际不是伏笔被 wiki-ingest 误标）怎么办？**
A：用户在 `progress/todo.md` 写"误标列表"，本 skill 读 todo 时跳过。下次 wiki-ingest 重抽时不会再误标（前提是用户调整了正文措辞）。

**Q3：阈值（15/30/50）能不能用户自定义？**
A：能。在 SOUL.md 加 `foreshadow_thresholds: [10, 25, 40]` 字段，本 skill 优先读用户设置。短篇可以收紧到 [5, 10, 15]。

**Q4：同一伏笔被多个实体共享（玉佩同时关联林尘和王家）怎么办？**
A：标在主关联实体（林尘）的 frontmatter，其他实体在 frontmatter 写 `referenced_foreshadow: [身世之谜]`。本 skill 只对"主关联"计算年龄，避免重复计数。

**Q5：本 skill 输出会不会和 chapter-planner 重复？**
A：互补。本 skill 维护**总账**（写文件 + 长线统计）；chapter-planner 只**读** `progress/foreshadow-alerts.md` 作为下章规划参考。
