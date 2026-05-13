
# Wiki-Ingest：章后知识沉淀

## 调用时机

- **章节正文写完后自动链触发**（由后端 `write_chapter` 工具完成时调度，无需用户主动）
- 用户主动调 `/wiki-ingest <章号>` 重建某章的知识抽取
- 批量重建：用户调 `/wiki-rebuild` 时本 skill 对每章顺序执行

> **本 skill 是 `knowledge/` 目录的唯一写入方**。其他 skill 一律只读 `knowledge/`，禁止手写。

---

## 核心任务

从刚写完的章节正文里抽取：

1. **新出场实体**（人物 / 物品 / 势力 / 地点）→ 落 `knowledge/entities/<slug>.md` 或 `knowledge/locations/<slug>.md`
2. **新设定概念**（修炼体系条目 / 规则 / 物种 / 历法）→ 落 `knowledge/concepts/<slug>.md`
3. **章节摘要**（80-150 字）→ append 到 `knowledge/log.md`
4. **伏笔变动**：
   - 新埋伏笔 → 在对应实体/概念 frontmatter 加 `foreshadow: open`
   - 回收伏笔 → 把 `foreshadow: open` 改 `foreshadow: closed`
   - 同步更新 `knowledge/foreshadow.md` 总账
5. **时间线事件** → append 到 `knowledge/timeline.md`

---

## 流程

### 第 1 步：读上下文

并行执行（同一 LLM turn）：

- 读刚写完的章节正文 `chapters/第N章-xxx.md`
- 读 `knowledge/log.md` 末尾 5 条（避免重复抽取已知信息）
- `ls knowledge/entities/ knowledge/concepts/ knowledge/locations/`（拿现有 slug 列表）

### 第 2 步：抽取候选清单

按下表分类，输出**结构化候选 JSON**（不直接写文件）：

```json
{
  "new_entities": [
    {"type": "character", "name": "林尘", "slug": "lin-chen", "first_appear": 3, "evidence": "…"}
  ],
  "updated_entities": [
    {"slug": "lin-chen", "patch": {"status": "炼气三层 → 炼气五层"}}
  ],
  "new_concepts": [
    {"name": "玄铁锁灵阵", "slug": "xuantie-suoling-zhen", "evidence": "…"}
  ],
  "new_locations": [...],
  "foreshadow_open": [
    {"on_slug": "lin-chen", "tag": "身世之谜", "evidence": "母亲留下的玉佩"}
  ],
  "foreshadow_closed": [
    {"on_slug": "qingyun-zong", "tag": "宗主真实身份"}
  ],
  "timeline_events": [
    {"chapter": 3, "event": "林尘踏入青云山外门"}
  ],
  "summary": "本章林尘抵达青云山，遇到内门弟子刁难……（80-150 字）"
}
```

**抽取原则**：
- 只抽**有名有姓**或**有明确指代**的实体（"那个老者"不抽，"青云宗宗主玄机子"抽）
- 设定概念必须**有规则性描述**（"修炼分五境"抽，"灵气流转"是泛泛而谈不抽）
- 伏笔判定看正文是否**留白 + 暗示重要**（章末"那枚古钥他握在掌心"=open；"原来宗主就是父亲"=closed）

---

### 第 3 步：去重与合并

对每个 `new_entities`，先 grep 现有 slug：

```
grep -l "name: <候选名>" knowledge/entities/*.md
grep -l "aliases:.*<候选名>" knowledge/entities/*.md
```

- 命中 → 走 `updated_entities` 路径，写 patch 不新建
- 未命中 → 真的新建

> **slug 命名**：用拼音连字符（`lin-chen` / `xuantie-jian` / `qingyun-zong`），不用中文路径，避免跨平台编码问题。

---

### 第 4 步：落盘

#### 实体文件模板（`knowledge/entities/<slug>.md`）

```markdown
---
id: lin-chen
type: character
name: 林尘
aliases: [小尘, 废柴]
faction: 青云宗外门
status: 炼气五层
first_appear_chapter: 3
last_update_chapter: 5
foreshadow:
  - tag: 身世之谜
    state: open
    set_chapter: 3
  - tag: 母亲玉佩来历
    state: open
    set_chapter: 3
---

# 林尘

## 外貌
（从正文抽，不编）

## 性格
（从正文抽）

## 关系
- 父亲：林正阳（已故 / 见 chapter 1）
- 师父：玄机子（chapter 4 拜师）

## 重要物品
- 母亲玉佩（chapter 1 起随身携带）

## 章节出现记录
- chapter 1：被家族放逐
- chapter 3：抵达青云山
- chapter 5：拜入外门
```

#### 概念文件模板（`knowledge/concepts/<slug>.md`）

```markdown
---
id: cultivation-realm
type: system
name: 修炼境界
related_entities: [lin-chen, xuanji-zi]
first_appear_chapter: 1
foreshadow:
  - tag: 化神之上是否还有
    state: open
    set_chapter: 1
---

# 修炼境界

炼气 → 筑基 → 金丹 → 元婴 → 化神 五境。

## 规则
- 炼气分九层，每层突破需灵气积累
- 筑基需筑基丹（青云宗外门弟子需立功换取）
- ...
```

#### 章节账本（`knowledge/log.md`，append-only）

```markdown
## 第 3 章 抵达青云山
林尘踏入青云外门，遭内门弟子刁难……（80-150 字）
关键事件：拜入外门、初识叶清雪、母亲玉佩首次发光
新实体：lin-chen, ye-qingxue, qingyun-zong
新伏笔（open）：身世之谜、母亲玉佩来历
```

#### 伏笔总账（`knowledge/foreshadow.md`，每次重写）

```markdown
# 伏笔总账（自动维护，禁止手写）

## Open（待回收）
| 标签 | 实体/概念 | 埋设章 | 距今 |
|---|---|---|---|
| 身世之谜 | lin-chen | 3 | 2 章 |
| 母亲玉佩来历 | lin-chen | 3 | 2 章 |
| 化神之上是否还有 | cultivation-realm | 1 | 4 章 |

## Closed（已回收）
| 标签 | 实体 | 埋设章 | 回收章 |
|---|---|---|---|

## Dropped（已废弃）
（无）
```

---

### 第 5 步：返回结果给 lead_agent

输出一句简短摘要供前端时间线显示：

> "章 3 沉淀完成：新增 2 实体（林尘、叶清雪）、1 概念（修炼境界）、2 伏笔 open。"

---

## 工具调用约定

| 工具 | 用途 |
|---|---|
| `wiki_ingest` | 后端工具，本 skill 输出结构化 JSON 后由后端校验+落盘 |
| `read_file` | 读章节正文 / 现有 knowledge 条目 |
| `grep` | 查重（slug、aliases） |
| `list_files` | 列 knowledge 目录 |

**绝对禁止**：
- 不要用通用 `write_file` 工具直接写 `knowledge/`——必须走 `wiki_ingest`
- 不要修改章节正文 / SOUL.md / outline/——本 skill 只往 knowledge/ 和 timeline 写
- 不要"创造"正文里没有的设定（不能编主角眼睛颜色，正文没说就留空）

---

## FAQ

**Q1：抽不到任何新实体怎么办？**
A：可能本章是过渡章。只追加 log.md 摘要 + 更新已有实体的 `last_update_chapter`，不强抽。

**Q2：实体冲突（同一个名字在两章描述不一样）怎么办？**
A：不强行合并，**写报告到 `reviews/consistency/章N-冲突.md`** 提示用户裁决，本次先按最新章节描述更新。

**Q3：伏笔状态判定不确定（这是埋还是写实）怎么办？**
A：宁愿不标 open（漏标可补），不要乱标 open（误标会让 foreshadow-tracker 一直报警）。判定阈值：**章末显式留白 + 主角内心独白点出 = open；正文一带而过 = 不标**。

**Q4：摘要太长 / 太短？**
A：硬约束 80-150 字。短了 grep 检索不到关键信息，长了让 lead_agent prompt 膨胀。

**Q5：能不能跨章批量沉淀？**
A：可以，调 `/wiki-rebuild` 触发。但**默认是写一章沉淀一章**，避免 LLM 上下文超限。
