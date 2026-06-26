/**
 * tools/index.js
 *
 * 画布 Agent 的 function-calling 工具定义（OpenAI tools 格式）。
 *
 * 这些工具由模型决定调用，实际执行发生在**前端**（画布状态在前端 React 里）：
 * 后端把工具 schema 注入 grok，模型返回 tool_calls → SSE 下发给前端 →
 * 前端 App.tsx 在画布执行并把结构化结果回传 → 作为 role:"tool" 消息喂回下一轮。
 *
 * 节点链路：text(提示词) → image(生图) → video(生视频)。
 */

// ============================================================================
// TOOL SCHEMAS（OpenAI function 格式）
// ============================================================================

/** 宽高比可选值（与前端 NodeData.aspectRatio 对齐） */
const ASPECT_RATIOS = ['16:9', '9:16', '1:1', 'Auto'];
const NODE_TYPES = ['text', 'image', 'video'];

/** 可选图片模型（与前端 NodeControls.IMAGE_MODELS 对齐）
 *  均走 fp（fpbrowser2api → Google Flow）的 Nano Banana 系列。 */
const IMAGE_MODELS = ['nana-banana-pro', 'nana-banana-2'];

/** 可选视频模型（与前端 NodeControls.VIDEO_MODELS 对齐）
 *  均走 fp（fpbrowser2api → Google Flow）。Veo 三档当前仅 8s 可用。 */
const VIDEO_MODELS = ['veo-omni-flash', 'veo-3-1-lite', 'veo-3-1-fast', 'veo-3-1-quality'];

export const TOOL_SCHEMAS = [
    {
        type: 'function',
        function: {
            name: 'get_canvas',
            description: '读取当前画布快照：返回所有节点的真实 id、类型、标题、提示词、状态(idle/loading/success/error)与父节点。需要引用/修改已有节点、或不确定画布现状时先调用它。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_node',
            description: '在画布新建一个节点。返回新节点的真实 id，可用于后续 connect/generate/update_node。text 节点写提示词/剧本；image 节点据提示词或父图(图生图)生成图片；video 节点据父图生成视频。',
            parameters: {
                type: 'object',
                properties: {
                    nodeType: { type: 'string', enum: NODE_TYPES, description: '节点类型' },
                    title: { type: 'string', description: '节点标题（可选，简短）' },
                    prompt: { type: 'string', description: '提示词/文本内容，中文撰写' },
                    aspectRatio: { type: 'string', enum: ASPECT_RATIOS, description: '画幅（image/video 用，可选，默认 Auto）' },
                    imageModel: { type: 'string', enum: IMAGE_MODELS, description: 'image 节点用的图片模型（可选；不传走「设置」里的默认模型）。nana-banana-pro 细节更强，nana-banana-2 更快。' },
                    videoModel: { type: 'string', enum: VIDEO_MODELS, description: 'video 节点用的视频模型（可选；不传走默认）。veo-omni-flash 短而快（4/6/8/10s），veo-3-1-quality 质量最佳但慢、veo-3-1-fast/lite 更快（Veo 三档当前仅 8s）。' },
                    parents: {
                        type: 'array',
                        items: { type: 'string' },
                        description: '父节点真实 id 数组（可选）。text→image 提供提示词；image→image 图生图；image→video 图生视频。',
                    },
                },
                required: ['nodeType'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_node',
            description: '修改一个已存在节点的提示词/标题/画幅/模型。id 必须是画布上的真实节点 id（可先 get_canvas 获取）。',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: '目标节点真实 id' },
                    prompt: { type: 'string', description: '新的提示词（可选）' },
                    title: { type: 'string', description: '新的标题（可选）' },
                    aspectRatio: { type: 'string', enum: ASPECT_RATIOS, description: '新的画幅（可选）' },
                    imageModel: { type: 'string', enum: IMAGE_MODELS, description: '新的图片模型（仅 image 节点，可选）' },
                    videoModel: { type: 'string', enum: VIDEO_MODELS, description: '新的视频模型（仅 video 节点，可选）' },
                },
                required: ['id'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'connect',
            description: '连接两个节点（数据从 from 流向 to，等价于把 from 加为 to 的父节点）。from/to 为真实节点 id。',
            parameters: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: '父节点真实 id' },
                    to: { type: 'string', description: '子节点真实 id' },
                },
                required: ['from', 'to'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'delete_node',
            description: '删除一个节点（破坏性操作，仅在用户明确要求时使用）。id 为真实节点 id。',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: '要删除的节点真实 id' },
                },
                required: ['id'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'generate',
            description: '触发节点生成（出图/出片）。target 为节点真实 id，或字符串 "all" 表示生成画布上所有可生成(image/video)节点。返回每个目标的最终状态(success+url 或 error)。text 节点不可生成。生成较慢（图数十秒、视频数分钟），会等待完成后返回结果。',
            parameters: {
                type: 'object',
                properties: {
                    target: { type: 'string', description: '节点真实 id 或 "all"' },
                },
                required: ['target'],
                additionalProperties: false,
            },
        },
    },
];

/** 工具名集合（用于前端/校验） */
export const TOOL_NAMES = TOOL_SCHEMAS.map(t => t.function.name);

export default TOOL_SCHEMAS;
