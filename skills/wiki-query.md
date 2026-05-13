
# Wiki-Query：写前知识检索（防崩核心）

## 调用时机

- **写新章前自动链**（由 `chinese-novelist` / `chapter-planner` 在第 1 步触发）
- 用户问"X 之前是什么修为？"/"Y 现在在哪？"等设定查询
- 用户主动 `/wiki <关键词>`
- 任何 skill 在做"一致性回顾"时

> **写章不查 wiki = 崩文从这里开始**。哪怕已经记得，也至少 grep 一次确认。

---

## 核心任务

在写之前，把**与本次创作相关的实体/概念/未闭合伏笔**捞出来塞进 prompt。本 skill **只读不写**。

---

## 流程

### 第 1 步：识别检索目标

从触发上下文里识别要查的关键词：

| 触发场景 | 关键词来源 |
|---|---|
| 写新章前 | 单章纲（`outline/chapters/chapter-N.md`）里列出的「出场人物」「涉及设定」「场景地点」 |
| 用户提问 | 用户消息里的人名/物名/概念名 |
| 一致性回顾 | 上一章末尾出现的所有专有名词 |

> 关键词去重，去掉常见无信息词（"主角"/"师父"/"那个"），保留专有名词。

---

### 第 2 步：并行 grep（关键提速）

**所有 grep 在同一个 LLM turn 里并行调用**，不要串行：

```
# 主名匹配
grep -l "^name: 林尘" knowledge/entities/*.md
# 别名匹配
grep -l "aliases:.*林尘" knowledge/entities/*.md
# 概念匹配
grep -l "^name: 修炼境界" knowledge/concepts/*.md
# 地点匹配
grep -l "^name: 青云山" knowledge/locations/*.md
# 伏笔扫描（必跑）
grep -rEl "state: open" knowledge/entities/ knowledge/concepts/
```

---

### 第 3 步：按相关度组装结果

对命中文件，**只读 frontmatter + 第一节正文**，不要全文塞 prompt：

```yaml
# 输出给 lead_agent 的结构（伪代码）
{
  "entities": [
    {
      "slug": "lin-chen",
      "name": "林尘",
      "status": "炼气五层",
      "faction": "青云宗外门",
      "open_foreshadow": ["身世之谜", "母亲玉佩来历"],
      "key_relations": ["师父：玄机子", "好友：叶清雪"],
      "last_update_chapter": 5
    }
  ],
  "concepts": [...],
  "locations": [...],
  "open_foreshadow_global": [
    {"on": "lin-chen", "tag": "身世之谜", "set_chapter": 3, "age_chapters": 2}
  ]
}
```

**伏笔分级**（提醒 lead_agent 优先回收年龄大的）：
- `age_chapters >= 30` → 红色高亮，强烈建议本章回收
- `age_chapters >= 15` → 黄色，可考虑推进
- `age_chapters < 15` → 绿色，正常埋着

---

### 第 4 步：注入 prompt

把结果以**最简形式**写进 lead_agent 的 system prompt 临时块：

```
<wiki_context chapter="6">
【相关实体】
- 林尘 (lin-chen)：炼气五层，青云宗外门，师父玄机子。开放伏笔：身世之谜(埋第3章)、母亲玉佩来历(埋第3章)。
- 叶清雪 (ye-qingxue)：炼气七层，青云宗内门首席，与林尘第3章初识。

【相关概念】
- 修炼境界：炼气→筑基→金丹→元婴→化神。

【全局开放伏笔提醒】
- 化神之上是否还有（埋第1章，已 5 章未推进）— 黄色

【一致性约束】
- 林尘修为是「炼气五层」，本章除非有突破场景，否则不要写成其他境界
- 林尘师父是玄机子，不要冒出第二个师父
</wiki_context>
```

---

## 工具调用约定

| 工具 | 用途 |
|---|---|
| `wiki_query` | 后端封装，输入关键词列表，返回结构化结果 |
| `grep` | 直接 grep `knowledge/` 目录 |
| `read_file` | 命中后读 frontmatter + 第一节 |

**绝对禁止**：
- 不要写任何文件（本 skill 只读）
- 不要把整个实体文件塞进 prompt——只塞 frontmatter + 一句话摘要
- 不要遍历 `knowledge/` 全目录——必须基于关键词 grep

---

## 性能预算

- 关键词 ≤ 10 个 → 一次并行 grep 拿完
- 注入 prompt 的 wiki_context 块 ≤ 800 字 token —— 超出说明检索目标太宽，回头精炼关键词
- 整个 skill 调用应在 1 个 LLM turn 内完成，不要循环深挖

---

## FAQ

**Q1：什么都没 grep 到怎么办？**
A：本章是新副本/新人物登场，正常。返回空 wiki_context，让 lead_agent 直接写。

**Q2：grep 命中了 20 个实体，prompt 装不下怎么办？**
A：按 `last_update_chapter` 倒序，只取 top 5。其他写到调用结果里供 lead_agent 按需追读，不全塞 prompt。

**Q3：用户问"X 上次出现是哪章？"怎么答？**
A：直接 grep `entities/<slug>.md` 的 `last_update_chapter` 字段返回，不需要进 LLM 推理。

**Q4：能不能用向量检索代替 grep？**
A：本期不上向量。grep 对中文专有名词足够准；向量检索引入额外服务和索引维护成本，等 knowledge 条目过 200 个再考虑。

**Q5：和 foreshadow-tracker 的关系？**
A：本 skill **写章前**注入伏笔提醒；foreshadow-tracker **写章后**做总账维护和长期未回收预警。两者读同一份 frontmatter，不冲突。
