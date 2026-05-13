# Wiki-Archive：跨章推论归档 synthesis/

## 调用时机

- 用户说「记一下」「归档这个规律」「沉淀这个推论」「这是跨章规律」时触发。
- 你在推演中发现不是单章事实、而是多条设定之间形成的第二层规律时触发。

## 核心边界

本 skill 只写 `knowledge/synthesis/*.md`，不修改实体、概念、地点、世界观 canon。

- 事实层变化：用 `wiki_ingest` 或设定补充流程。
- 推论层变化：用 `wiki_archive`。
- 不确定结论必须降低 `confidence`，默认 0.65。

## 流程

1. 先确认推论来源，至少 2 个 `derived_from`。
2. 把结论压缩成一句 `thesis`，不要把用户长段原文直接塞进去。
3. 调 `wiki_archive`：

```json
{
  "title": "雾的选择性惩罚",
  "thesis": "死雾更像惩罚主动越界者，而不是无差别灾害。",
  "derived_from": ["knowledge/concepts/dead-fog.md", "knowledge/world/rules.md"],
  "confidence": 0.65,
  "tier": "working"
}
```

## 输出要求

归档后只给用户简短确认：标题、路径、置信度、来源数量。

## 禁止

- 禁止把未经来源支撑的脑补写成 permanent。
- 禁止修改 `knowledge/entities/`、`knowledge/concepts/` 或 `SOUL.md`。
- 禁止用 `update_progress` 绕过 `wiki_archive` 写 synthesis。
