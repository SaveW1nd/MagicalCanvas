/**
 * toolProtocol.js
 *
 * 在画布侧自行实现 function-calling（不依赖后端原生 tools）：
 *  - buildToolSystemPrompt：把工具 schema 渲染成系统指令块，要求模型用 <tool_calls> XML 输出工具调用；
 *  - parseToolCalls：从模型文本里容错解析工具调用（XML / JSON envelope / JSON array / 替代标签）；
 *  - toolCallsToXml：把已发生的工具调用还原成 XML，喂回多轮历史；
 *  - flattenForPlainChat：把含 tool_calls / role:"tool" 的消息扁平化成纯 user/assistant/system，
 *    使任意纯聊天后端（KleinAI/grok2api/裸 grok）都能驱动 agent。
 *
 * 移植自 grok2api 的 tool_prompt.py + tool_parser.py，适配 Node。
 */

// ============================================================================
// 注入：把工具 schema 渲染成系统指令
// ============================================================================

const TOOL_SYSTEM_HEADER = `你可以调用以下工具。

可用工具：
{tool_definitions}

工具调用格式 —— 严格遵守：
- 需要调用工具时，**只输出**下面这个 XML 块，前后不要有任何其它文字。
- <parameters> 必须是单行合法 JSON（内部不要换行）。
- 多个工具调用放进同一个 <tool_calls> 元素里。
- 不要给 XML 套 markdown 代码围栏。

<tool_calls>
  <tool_call>
    <tool_name>工具名</tool_name>
    <parameters>{"键":"值"}</parameters>
  </tool_call>
</tool_calls>

错误示范（不要这样）：
\`\`\`xml
<tool_calls>...</tool_calls>
\`\`\`
我现在来调用工具。<tool_calls>...</tool_calls>

何时调用：需要新建/连线/修改/生成/删除节点等改动画布的操作时，必须输出 <tool_calls> XML；纯聊天/答疑/分析时用普通文字回答，不要输出 XML。
工具结果会在下一轮以「工具执行结果」形式回传给你，据此再决定继续调用工具或给出最终文字回复。`;

/** 渲染单个工具定义 */
function formatToolDefinitions(tools) {
    return (tools || []).map(t => {
        const fn = t.function || {};
        const lines = [`工具: ${fn.name || ''}`];
        if (fn.description) lines.push(`说明: ${fn.description}`);
        if (fn.parameters) {
            try { lines.push(`参数: ${JSON.stringify(fn.parameters)}`); }
            catch { lines.push(`参数: ${fn.parameters}`); }
        }
        return lines.join('\n');
    }).join('\n\n');
}

/** 构建工具系统指令块（拼到 AGENT_SYSTEM_PROMPT 之后） */
export function buildToolSystemPrompt(tools) {
    return TOOL_SYSTEM_HEADER.replace('{tool_definitions}', formatToolDefinitions(tools));
}

// ============================================================================
// 解析：从模型文本里提取工具调用
// ============================================================================

let _idSeq = 0;
function makeCall(name, args) {
    const id = `call_${Date.now()}${(_idSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    let argStr;
    if (typeof args === 'string') argStr = args;
    else {
        try { argStr = JSON.stringify(args); } catch { argStr = '{}'; }
    }
    return { id, type: 'function', function: { name, arguments: argStr } };
}

/** 容错解析 JSON：失败则尝试把字符串内未转义换行修掉再解析 */
function parseJsonTolerant(s) {
    if (!s) return {};
    try { return JSON.parse(s); }
    catch {
        try { return JSON.parse(s.replace(/(?<!\\)\n/g, '\\n')); }
        catch { return null; }
    }
}

const TOOL_SYNTAX_RE = /<tool_calls|<tool_call|<function_call|<invoke\s|"tool_calls"\s*:|\btool_calls\b/i;
const hasToolSyntax = (t) => TOOL_SYNTAX_RE.test(t);

// Parser 1: <tool_calls> XML（首选）
const XML_ROOT_RE = /<tool_calls\s*>([\s\S]*?)<\/tool_calls\s*>/i;
const XML_CALL_RE = /<tool_call\s*>([\s\S]*?)<\/tool_call\s*>/ig;
const XML_NAME_RE = /<tool_name\s*>([\s\S]*?)<\/tool_name\s*>/i;
const XML_PARAMS_RE = /<parameters\s*>([\s\S]*?)<\/parameters\s*>/i;

function parseXmlToolCalls(text) {
    const root = XML_ROOT_RE.exec(text);
    if (!root) return [];
    const calls = [];
    let m;
    XML_CALL_RE.lastIndex = 0;
    while ((m = XML_CALL_RE.exec(root[1])) !== null) {
        const inner = m[1];
        const nameM = XML_NAME_RE.exec(inner);
        if (!nameM) continue;
        const paramsM = XML_PARAMS_RE.exec(inner);
        const args = parseJsonTolerant(paramsM ? paramsM[1].trim() : '{}');
        if (args === null) continue;
        calls.push(makeCall(nameM[1].trim(), args));
    }
    return calls;
}

// Parser 2: {"tool_calls":[...]} JSON envelope
function extractFromCallList(items) {
    const calls = [];
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const name = (item.name || item.tool_name || '').trim();
        const args = item.input || item.arguments || item.parameters || {};
        if (!name) continue;
        calls.push(makeCall(name, args));
    }
    return calls;
}

function parseJsonEnvelope(text) {
    if (!text.includes('"tool_calls"')) return [];
    const start = text.indexOf('{');
    if (start === -1) return [];
    const end = text.lastIndexOf('}');
    if (end <= start) return [];
    let obj = null;
    try { obj = JSON.parse(text.slice(start, end + 1)); } catch { obj = null; }
    if (!obj || !Array.isArray(obj.tool_calls)) return [];
    return extractFromCallList(obj.tool_calls);
}

// Parser 3: 裸 JSON 数组 [{"name":..,"input":..}]
function parseJsonArray(text) {
    const m = /\[[\s\S]+\]/.exec(text);
    if (!m) return [];
    let arr;
    try { arr = JSON.parse(m[0]); } catch { return []; }
    if (!Array.isArray(arr)) return [];
    return extractFromCallList(arr);
}

// Parser 4: 替代标签 <function_call> / <invoke name="..">
const FC_RE = /<function_call\s*>([\s\S]*?)<\/function_call\s*>/ig;
const INVOKE_RE = /<invoke\s+name=["']?(\w+)["']?\s*>([\s\S]*?)<\/invoke\s*>/ig;
const FC_NAME_RE = /<name\s*>([\s\S]*?)<\/name\s*>/i;
const FC_ARGS_RE = /<arguments\s*>([\s\S]*?)<\/arguments\s*>/i;

function parseAltXml(text) {
    const calls = [];
    let m;
    FC_RE.lastIndex = 0;
    while ((m = FC_RE.exec(text)) !== null) {
        const inner = m[1];
        const nameM = FC_NAME_RE.exec(inner);
        if (!nameM) continue;
        const argsM = FC_ARGS_RE.exec(inner);
        const args = parseJsonTolerant(argsM ? argsM[1].trim() : '{}');
        if (args === null) continue;
        calls.push(makeCall(nameM[1].trim(), args));
    }
    INVOKE_RE.lastIndex = 0;
    while ((m = INVOKE_RE.exec(text)) !== null) {
        const args = parseJsonTolerant(m[2].trim()) || {};
        calls.push(makeCall(m[1].trim(), args));
    }
    return calls;
}

/** 把文本里第一个工具语法块之前的部分作为对话正文（剥离 XML/JSON 工具块） */
function extractCleanText(text) {
    const idx = text.search(/<tool_calls|<tool_call|<function_call|<invoke\s/i);
    if (idx !== -1) return text.slice(0, idx).trim();
    // JSON envelope/array：若整段就是工具 JSON，正文为空
    return text;
}

/**
 * 解析模型输出里的工具调用。
 * @returns {{ toolCalls: Array, cleanText: string }}
 */
export function parseToolCalls(text, availableNames) {
    const raw = String(text || '');
    if (!raw.trim() || !hasToolSyntax(raw)) {
        return { toolCalls: [], cleanText: raw.trim() };
    }
    let calls = parseXmlToolCalls(raw);
    if (!calls.length) calls = parseJsonEnvelope(raw);
    if (!calls.length) calls = parseJsonArray(raw);
    if (!calls.length) calls = parseAltXml(raw);

    if (calls.length && Array.isArray(availableNames) && availableNames.length) {
        calls = calls.filter(c => availableNames.includes(c.function.name));
    }
    const cleanText = calls.length ? extractCleanText(raw) : raw.trim();
    return { toolCalls: calls, cleanText };
}

// ============================================================================
// 多轮历史扁平化（让纯聊天后端也能理解工具上下文）
// ============================================================================

/** 把一组工具调用还原成 <tool_calls> XML（用于重建 assistant 历史消息） */
export function toolCallsToXml(toolCalls) {
    const lines = ['<tool_calls>'];
    for (const tc of (toolCalls || [])) {
        const fn = tc.function || {};
        let args = fn.arguments || '{}';
        try { args = JSON.stringify(JSON.parse(args)); } catch { /* 保持原样 */ }
        lines.push('  <tool_call>');
        lines.push(`    <tool_name>${fn.name || ''}</tool_name>`);
        lines.push(`    <parameters>${args}</parameters>`);
        lines.push('  </tool_call>');
    }
    lines.push('</tool_calls>');
    return lines.join('\n');
}

/**
 * 把内部 working 消息（可能含 assistant.tool_calls 与 role:"tool"）扁平化成
 * 纯 user/assistant/system 消息，使任何纯聊天后端都能消费。
 * - assistant 带 tool_calls → content 用 XML 还原（保留正文若有）
 * - role:"tool" 结果 → 合并成一条 user 消息「工具执行结果」
 */
export function flattenForPlainChat(messages) {
    const out = [];
    let pendingToolResults = [];

    const flushToolResults = () => {
        if (!pendingToolResults.length) return;
        const body = pendingToolResults
            .map(r => `- ${r.name ? r.name + ': ' : ''}${r.content}`)
            .join('\n');
        out.push({ role: 'user', content: `【工具执行结果】\n${body}` });
        pendingToolResults = [];
    };

    for (const m of messages) {
        if (m.role === 'tool') {
            pendingToolResults.push({ name: m.name, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
            continue;
        }
        flushToolResults();
        if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
            const xml = toolCallsToXml(m.tool_calls);
            const content = m.content ? `${m.content}\n${xml}` : xml;
            out.push({ role: 'assistant', content });
        } else {
            out.push({ role: m.role, content: m.content });
        }
    }
    flushToolResults();
    return out;
}

export default { buildToolSystemPrompt, parseToolCalls, toolCallsToXml, flattenForPlainChat };
