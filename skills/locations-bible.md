# locations-bible · 地点档案（立项 ④a）

> 立项硬闸门 stage 4 的第一份资产：开篇 ~10 章会出现的「关键地点」逐个建档。
> 不是每个地点都要写——只写**会反复出现**或**承担剧情功能**的，避免设定爆炸。

## 何时启用

- 用户说"立地点 / 搭场景 / 关键地点 / 驻地档案 / 地图"等。
- 或 `setupStage.stage === 3`（人物档案完成）但 `knowledge/locations/*.md` < 3 时，**立项流程会自动把这一步挂上**。

## 必读前置

- `SOUL.md`：题材、初始环境
- `knowledge/world/geography.md`：粗粒度地理已经定下来
- `knowledge/world/factions.md`：势力分布
- `knowledge/entities/*.md`：主角和配角的活动半径
- `knowledge/relationships.md`：势力间关系

## 必调工具

- `read_file`：先读上面 5 类前置
- `ask_user`：每写完 1-2 个地点，就和用户确认
- `wiki_ingest`：把每个地点档案落到 `knowledge/locations/<location-slug>.md`
- `lookup_rebuild`：所有地点写完后必须重建索引
- 推荐 `conflict_check`：地点设定与世界观/势力档案是否冲突

## 禁用工具

- `write_chapter`、`write_outline`：地点没建完，禁止写正文/卷纲

## 输出要求（每个地点档案）

文件名：`knowledge/locations/<slug>.md`，slug 用拼音或英文短词，不带空格。

frontmatter（可选 yaml block）+ 正文，建议结构：

```markdown
# <地点中文全名>

- **type**：势力总部 / 主角居所 / 资源点 / 禁地 / 路过地 / 战场 / ...
- **region**：所在大区域（与 geography.md 对齐）
- **vibes**：3 个氛围关键词（例：阴森、潮湿、铜锈味）
- **first_chapter_range**：约第 X-Y 章首次出现
- **status**：常驻 / 已毁 / 一次性

## 地理与物质
- 位置（与已有地理档案的相对方位）
- 面积、地貌、气候
- 关键物件（建筑、地标、自然奇观）

## 经济与人群
- 人口、产业、阶级
- 谁掌权、谁服从、谁反抗

## 与主线的关联
- 这里会发生哪些**剧情节点**
- 哪些**人物**驻守 / 路过 / 出生于此
- 哪些**物品**是这里独有 / 起源于此

## 视觉与五感
- 让读者一闭眼就能"在场"的 3-5 行描写素材
- 颜色、声音、气味、温度、触感
```

## 数量与节奏

- **至少 3 个**地点档案才能进入下一阶段（硬闸门）
- 推荐数量上限 ≤ 15 个，太多反而管理混乱
- 类型至少覆盖：① 主角常驻地 ② 一个开篇主场景 ③ 一个对手/势力据点

## 退出条件（exitWhen）

- `knowledge/locations/*.md` 文件数 ≥ 3
- 每个文件都至少包含 `## 与主线的关联` 段
- `lookup_rebuild` 成功，地点条目可被 `lookup_query` 找到

## 常见错误

- ❌ 把地理总览（已经在 `world/geography.md`）抄一遍当地点档案。地点是**具体场景**，不是大区域。
- ❌ 一次性堆 30 个地点，结果开篇 5 章只用到 2 个。先写**会马上用到**的。
- ❌ 与 `factions.md` 重复（势力总部档案应只放在这里，势力档案只引用名字）。

## 与下游 skill 的衔接（chainsTo）

完成后链到 `items-bible`：先地点、再"地点里的关键物品"。
