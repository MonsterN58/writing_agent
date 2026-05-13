---
name: setting-supplement
description: 写章过程中或写章之间，用户临时补充/修改/统一替换设定时使用。区分 add / modify / rename 三类，先备份再写盘，最后跑一致性扫描。
---

# 设定补充 / 修订 skill

## 何时触发
用户在**已立项**的作品里，说出以下任意一类话时：

- **新增**：「对了/还有/我想加」+ 新人物/新势力/新道具/新概念
  - 例："对了，主角的剑叫青冥，是父亲遗物"
  - 例："我想加个反派暗线组织叫天枢阁"
- **修改**：「改一下/我改主意了」+ 既有设定字段
  - 例："女主其实是公主，前面她身世那段重写"
  - 例："修炼分五境改成七境"
- **重命名/术语统一**：「全篇/统一/全部把 X 叫 Y」
  - 例："全篇'魔气'改成'灵气逆流'"
  - 例："那个组织名换成'玄机阁'"

## 工作流（**严格按顺序**）

### Step 1 · 分类
先 emit 一段 `<thinking>` 判定属于哪类：

| 分类 | 判定 | 主工具 |
|---|---|---|
| `add` | wiki 里没有，用户首次提到 | `wiki_ingest`（新增 entity）或 `update_progress`（新增世界观字段） |
| `modify` | wiki 里**已有**该 slug，要改部分字段 | `wiki_ingest` 同 slug 覆盖 / `update_progress` 改 world/* |
| `rename` | 跨章统一替换术语（含正文+大纲+wiki） | 当前**没有 bulk-replace 工具**——必须 `ask_user` 让用户确认范围 |

含糊不清时（"加一个人物"但没说重要程度，可能新主角/可能 NPC）→ **调 `ask_user`** 问清。

### Step 2 · 备份（modify / rename 必做）
- world/* 或 relationships.md：`update_progress` 已自动备份（看 backedUp 字段）
- 已有 entity 文件：调 `backup_file` 显式备份 `knowledge/entities/<slug>.md`
- 涉及大纲层：调 `backup_file` 把对应 `outline/...` 备份

### Step 3 · 落盘
按分类调对应工具：

**add（人物 / 物品 / 势力 / 地点 / 概念）**：
```
wiki_ingest({
  chapter: <当前章号或 0>,
  new_entities: [{ name, slug, body }],
  ...
})
```
新势力/暗线组织在 entities 里建即可（type=faction）。

**add（世界观字段，如新增一种植物、节日、政治制度）**：
```
update_progress({
  path: 'knowledge/world/<slot>.md',
  content: '<追加后的完整内容>'
})
```
`<slot>` ∈ overview / power-system / factions / geography / history / rules / customs。

**add（人物关系）**：
```
update_progress({ path: 'knowledge/relationships.md', content: '<追加后的完整 mermaid + 表格>' })
```

**modify**：与 add 同工具，但要保留旧字段、只改用户说要改的部分（read_file 先读现有 → 局部改 → 写回）。

**rename（跨章替换）**：
1. **必先 ask_user 确认**：「全篇把 X 改 Y，会扫描所有章节正文+大纲+wiki，是否继续？预计影响 N 处」
2. 用户确认后：`list_chapters` + `list_files subPath='outline'` → 逐个 `read_file` 找出现位置
3. 对每个文件：`backup_file` → `update_progress` / `write_chapter` / `write_outline` 替换后写回
4. 最后 wiki 同步：`wiki_ingest` 改对应 slug

### Step 4 · 一致性扫描
设定一旦改动，跑：
```
consistency_check({
  chapter: <最新章号>,
  issues: [...],   // 比对新设定 vs 已写章节，列出冲突
  passed_checks: [...]
})
```
发现冲突时**别自己擅自改正文**，调 `ask_user` 给用户两个方案：
- A. 改设定迎合现有正文
- B. 改正文（具体哪些章）迎合新设定

### Step 5 · 摘要交付
向用户报告：

```
✅ 已落盘
- knowledge/entities/qingming-jian.md（新增：青冥剑）
- knowledge/relationships.md（更新：林尘 -父子-> 林玄）

⚠️ 一致性扫描结果
- 第 2 章场景 3 提到主角"无父无母"，与新增设定冲突
- 建议：改第 2 章那段为"父亲遗物随母失散"，需要我处理吗？
```

## 红线
- 不要把"补充"当"新立项"——别覆盖 SOUL.md
- 改既有设定**必须先备份**（不靠覆盖时的自动备份兜底，要显式 backup_file）
- 影响 ≥3 章的修改 **必须** plan_tasks（自驱原则）+ ask_user 确认（求证原则）
