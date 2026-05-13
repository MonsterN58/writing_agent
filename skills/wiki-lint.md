# Wiki-Lint：档案体检报告

## 调用时机

- 用户说「wiki 体检」「档案体检」「检查档案」「知识库体检」「设定体检」。
- system prompt 出现 `<lint_due>` 时。
- 每写满 10 章后，下一次涉及设定/写章/体检的对话应优先跑。

## 核心原则

wiki-lint 是医生体检，不动手术。

- 只写 `knowledge/lint-report.md`。
- 只报告问题，不自动修改 canon。
- 修不修由作者拍板。

## 检查范围

当前实现以机械检查为主：

1. frontmatter 字段是否齐全。
2. `knowledge/*.md` 是否为空正文。
3. 短小 TODO / 待补 / 请补 / 补全 stub 是否残留。
4. 重复 id。
5. open 伏笔是否悬置太久。

## 流程

1. 如果 `<lint_due>` 指定 chapter，优先传 `currentChapter`。
2. 调 `wiki_lint`：

```json
{
  "scope": "mechanical",
  "currentChapter": 10
}
```

3. 把报告路径、问题数量、warning 数量总结给用户。

## 禁止

- 禁止自动修改实体、概念、世界观文件。
- 禁止把 `lint-report.md` 当 canon 依据；它只是诊断报告。
- 禁止体检完直接大规模改档案，必须先让作者确认修复策略。
