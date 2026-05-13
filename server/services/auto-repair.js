// 工具级自动修复：基于错误信息判定是否可以静默补一个前置工具调用，然后让主循环重试原工具。
// 返回 null 表示不可修复，走原失败流程。

const NAME_PREFIX = '王李张刘陈杨赵黄周吴徐孙朱马胡郭林何高梁郑罗宋谢唐韩曹许邓萧冯曾程蔡彭潘袁于董余苏叶吕魏蒋田杜丁沈姜范江傅钟卢汪戴崔任陆廖姚方金邱夏谭韦贾邹石熊孟秦阎薛侯雷白龙段郝孔邵史毛常万顾赖武康贺严尹钱施牛洪龚';

/**
 * @param {object} opts
 * @returns {Promise<null | {injectToolCall:{name:string,args:object}, note:string}>}
 */
export async function tryAutoRepair({ name, args, err, ctx }) {
  const msg = String(err?.message || err);

  // gate_violation: write_chapter 缺 get_chapter_context
  if (name === 'write_chapter' && /get_chapter_context/.test(msg) && args.chapter) {
    return {
      injectToolCall: { name: 'get_chapter_context', args: { chapter: Number(args.chapter) } },
      note: '自动补跑 get_chapter_context',
    };
  }

  // gate_violation: write_chapter 缺 wiki_query
  if (name === 'write_chapter' && /wiki_query/.test(msg)) {
    const keywords = extractNames(args.content || '').slice(0, 6);
    if (keywords.length) {
      return {
        injectToolCall: { name: 'wiki_query', args: { keywords } },
        note: `自动补跑 wiki_query([${keywords.join('、')}])`,
      };
    }
  }

  // gate_violation: revise 场景缺 read_file 全文
  if (name === 'write_chapter' && /read_file.*全文|maxChars=0/.test(msg) && args.chapter) {
    // 没办法 auto-repair，因为我们不知道原章节的确切文件名；让 agent 自己处理。
    return null;
  }

  return null;
}

function extractNames(text) {
  if (!text) return [];
  const re = new RegExp(`[${NAME_PREFIX}][\\u4e00-\\u9fa5]{1,3}`, 'g');
  const m = text.match(re);
  if (!m) return [];
  return [...new Set(m)];
}
