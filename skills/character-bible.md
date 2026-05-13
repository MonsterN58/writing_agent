---
name: character-bible
description: 立项主要人物谱，生成核心人物 wiki、关系图，并重建 lookup。
phase: setup:characters
chains_from: [worldbuilding-systems, bulk-import]
chains_to: [outline-collaborator]
must_call_tools: [wiki_ingest, update_progress, lookup_rebuild]
forbid_tools: [write_chapter]
exit_when: [knowledge/entities/* exists, knowledge/relationships.md exists]
prerequisite_files: [SOUL.md, knowledge/world/*]
---

# Character-Bible：主要人物谱（立项 ③）

## 调用时机

- setup-pipeline 阶段 ③（世界观已写完）
- 用户说"立人物 / 搭主要人物 / 把人物都写上"
- 中途要加一个主要配角/反派时（走微型流程）

---

## 核心任务

把"故事里的主要人物"一次性立起来：主角 + 核心配角 + 主要反派 + 关键 NPC。每个人作为一个 wiki entity 写入 `knowledge/entities/<slug>.md`，带 frontmatter 结构化属性 + markdown body 详细描述。**每个角色至少埋 1 条 open 伏笔**。最后输出一份 `knowledge/relationships.md` 关系总览。

---

## 角色数量建议

| 角色类型 | 建议数 | 说明 |
|---|---|---|
| 主角 | 1（男女主双线则 2） | 必须 |
| 核心配角 | 2-4 | 长期陪伴，有独立弧光 |
| 主要反派 | 1-2 | 至少分「当前敌人」和「终极敌人」 |
| 关键 NPC | 1-3 | 推动剧情但无独立弧光（师父/导师/信息源） |

**不要一开始立太多**（新手写手常犯）。开卷只立**会在第 1 卷出场的 6-10 个人**，其他等出场时 wiki_ingest 增补即可。

---

## Entity frontmatter 结构

每个人物文件 `knowledge/entities/<slug>.md`：

```markdown
---
id: lin-chen
type: character
name: 林尘
aliases: [小尘, 废柴, 林家三公子]
faction: 青云宗外门
role: protagonist           # protagonist / companion / antagonist / mentor / npc
age: 18
gender: male
status: 炼气五层            # 当前修为/状态，会被 wiki_ingest 更新
first_appear_chapter: 1
last_update_chapter: 1
foreshadow:
  - tag: 身世之谜
    state: open
    set_chapter: 1
  - tag: 母亲玉佩来历
    state: open
    set_chapter: 1
  - tag: 真道体觉醒
    state: open
    set_chapter: 1
    hint: 隐藏设定，主角以为自己是废灵根，实为先天道体
---

# 林尘

## 一句话人设
<一句话抓住角色核心，例：表面自卑内心倔强的少年，被命运按着头仍死咬不松口>

## 外貌
<2-4 句，只写会在文本中反复出现的标志性特征>

## 性格（3 条关键特质 + 1 个反差点）
- **倔强**：被欺负不还嘴但偷偷记账
- **护短**：对青梅竹马有底线式护短
- **自卑转自信的慢过程**：前 10 章还在自我怀疑
- **反差点**：表面木讷，心思缜密得可怕

## 能力 / 资源
- 灵根：<类型 + 品阶>（**此处可埋伏笔**：世人以为的 vs 实际的）
- 家世：<背景简述>
- 特殊：<法宝 / 血脉 / 系统 / 师承 ...>

## 动机栈（3 层）
1. **表层目标**：报家族逐出之仇
2. **中层目标**：查明母亲之死真相
3. **深层目标**：证明"废物"也能踏上巅峰

## 与主要人物的关系
- **叶清雪**：青梅竹马，3 年未见；有婚约
- **王麟**：同门，打压过林尘；死对头
- **林父**：家族放逐的执行者；恩怨交织
（此处 3-5 条核心关系，详细在 relationships.md）

## 出场规划
- 第 1 章：<一段话描述首次出场的情境>
- 第 5 章左右：<关键成长节点>
- 本卷末：<到达什么状态>

## 语言习惯（可选）
- 自称：<"我"/"在下"/"本少爷"...>
- 口癖：<无 / 某句话常挂嘴边>
- 称呼别人：<对敌人/朋友的差别>

## 禁止
- <本角色不能出现的行为/态度，避免 AI 写崩。例：林尘不会懦弱到连还嘴都不敢，他是「忍但记账」>
```

---

## 反派特别模板

反派额外字段：

```markdown
## 立场与动机
- **表层动机**：<例：抢夺林尘的玉佩>
- **深层动机**：<例：为了给妹妹续命>（让反派有合理性，不是纸板）
- **与主角的根本矛盾**：<不可调和点>

## 交锋节奏
- 第一次交锋：第 X 章（双方相对实力 + 结果）
- 第二次：第 Y 章
- 终极对决：第 Z 章

## 反派弱点
- <可被主角利用的弱点，避免反派开挂无敌>

## 反派是否有"人味"
- <至少 1 个让读者能理解甚至同情的瞬间>
```

---

## 关系图：knowledge/relationships.md

最后写一份人物关系总览：

```markdown
# 人物关系图

## 主要阵营

### 正方（主角阵营）
- 林尘（主角）
- 叶清雪（未婚妻，核心盟友）
- 青松子（师父）

### 反方（王家）
- 王麟（主要对手）
- 王元霸（家主，幕后黑手）

### 中立 / 摇摆
- 林父（亲情与家族立场拉扯）

## 关键关系表

| A | B | 当下关系 | 将来走向（伏笔） |
|---|---|---|---|
| 林尘 | 叶清雪 | 3 年未见的青梅婚约 | 本卷重逢 → 误会 → 情投意合 |
| 林尘 | 王麟 | 被打压的外门弟子 vs 嫡子 | 第 4 章反杀 → 结下血仇 |
| 林尘 | 林父 | 被放逐 | 中后期揭真相（林父曾护过林尘） |
| 叶清雪 | 王麟 | 被纠缠 | 王麟觊觎 → 成为导火索 |
| 青松子 | 林父 | 旧识 | 师父知情林尘身世（大伏笔） |

## 关系变化触发点（情节钩子）
- 第 X 章：<关系 A→B 从 X 态变 Y 态，因为 Z 事件>
- ...

## 视觉化（ASCII/mermaid 简笔）
```
       林父 ─────(真相待揭)─────→ 林尘 ←─(婚约)──→ 叶清雪
                                    │                │
                                   (仇)           (被觊觎)
                                    ↓                │
                                   王麟 ←──(保护欲)──┘
                                    │
                               (嫡庶矛盾)
                                    ↓
                                  王元霸
```
```

---

## 工作流

1. **读必要上下文**：
   - `SOUL.md`（主角字段已有初步设定）
   - `knowledge/world/overview.md` + `power-system.md` + `factions.md`（阵营和体系约束）
   - `outline/overall.md`（如果已有，看主角要经历什么，倒推他的起点设定）

2. **与用户确认人物阵容**（不要闷头自己决定）：
   > "基于 SOUL + 世界观，我建议立这几个人：
   > - 主角：林尘（已有）
   > - 核心配角：① 叶清雪（青梅/情感线）② <建议 2>
   > - 主要反派：王麟（近期对手）+ 王元霸（远期终极反派）
   > - 师父：青松子（信息源 + 身世钥匙）
   >
   > 共 6 人。你想加谁减谁，或名字要改？"

3. **用户确认后，一次性立全部人物**：
   - 调 `wiki_ingest`，把所有角色作为 `new_entities` 批量写入
   - 每个角色至少 1 条 `foreshadow` open 标签
   - 主角 2-3 条 foreshadow（身世/动机/天赋）
   - 反派有"深层动机"和"弱点"两块

4. **再调 `update_progress`** 写 `knowledge/relationships.md`

5. **汇报用户**：
   > "立好 6 个主要人物，共埋 11 条 open 伏笔（主角 3 条、叶清雪 2 条、王麟 2 条、王元霸 2 条、青松子 1 条、林父 1 条）。关系图落在 knowledge/relationships.md，有 5 条关系在未来会变动。下一步写总纲，继续？"

---

## 反面禁忌

- ❌ **人物立得太多**：第 1 卷用不到的人物不立，等出场时 wiki_ingest 补
- ❌ **全是"纸板反派"**：每个反派至少 1 个"能被理解的瞬间"
- ❌ **主角没有"禁止条款"**：不写"角色禁止行为"，后面 AI 会写崩人设
- ❌ **只写属性不写动机**：外貌/年龄是次要，动机栈 3 层是必要
- ❌ **不埋伏笔**：每个主要人物至少 1 条 open，写完人物 foreshadow 总账要增加 8-15 条
- ❌ **抢了总纲的活**：不要在本 skill 里把"第 X 章发生什么"写死，那是总纲/arc 的领地

---

## 工具

- `wiki_ingest`（批量写 entities + 埋伏笔）
- `update_progress`（路径 `knowledge/relationships.md`）
- `read_file`（读 SOUL / world / overall 约束）

---

## 与其他 skill 衔接

- **上游**：worldbuilding-systems（世界观包）
- **下游**：outline-collaborator（总纲，会引用本 skill 的人物）
- **平行参考**：character-arc（深度挖主角弧光）、naming（起不好的名字时）
