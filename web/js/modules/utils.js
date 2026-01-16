/**
 * 工具函数模块
 * 
 * 提供通用的 API 请求封装、数据格式化、防抖等实用函数。
 * 同时也包含 Provider 的元数据定义。
 */

/**
 * Provider 元数据定义
 * 用于前端展示 Provider 的图标、颜色和描述信息。
 * @type {Object.<string, {icon: string, color: string, desc: string}>}
 */
export const providerMeta = {
    "Doubao": { icon: "ri-openai-fill", color: "#00a187", desc: "豆包模型支持" },
    "Gitee": { icon: "ri-code-box-line", color: "#c71d23", desc: "OpenAI 兼容接口" },
    "ModelScope": { icon: "ri-cloud-line", color: "#624aff", desc: "魔搭社区" },
    "HuggingFace": { icon: "ri-bear-smile-line", color: "#ffeb3b", desc: "HF Spaces" },
    "Pollinations": { icon: "ri-plant-line", color: "#4caf50", desc: "免费开源生成" }
};

// 获取本地存储的 Auth Token (如果有)
const authToken = localStorage.getItem('authToken') || '';

/**
 * 封装的 fetch 请求
 * 
 * 自动添加 Authorization 头 (如果有 Token)。
 * 
 * @param {string} url - 请求地址 (相对于当前域名的路径)
 * @param {RequestInit} [options={}] - fetch 选项
 * @returns {Promise<Response>} fetch 响应对象
 */
export async function apiFetch(url, options = {}) {
    if (authToken) {
        options.headers = {
            ...options.headers,
            'Authorization': `Bearer ${authToken}`
        };
    }
    const res = await fetch(url, options);
    return res;
}

/**
 * 检测 API Key 格式并推断 Provider 类型
 * 
 * 根据不同 Provider 的 Key 格式特征进行简单验证。
 * 注意：这只是前端的初步验证，精确验证在后端进行。
 * 
 * @param {string} apiKey - 待检测的 API Key
 * @param {string} provider - 目标 Provider 名称
 * @returns {boolean} 格式是否匹配
 */
export function detectApiKey(apiKey, provider) {
    if (!apiKey) return false;
    switch(provider) {
        case 'Doubao': 
            // UUID 格式
            return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(apiKey);
        case 'Gitee': 
            // 30-60 位字母数字组合
            return /^[a-zA-Z0-9]{30,60}$/.test(apiKey);
        case 'ModelScope': 
            // 以 ms- 开头
            return apiKey.startsWith('ms-');
        case 'HuggingFace': 
            // 以 hf_ 开头
            return apiKey.startsWith('hf_');
        case 'Pollinations': 
            // 以 pk_ 或 sk_ 开头
            return apiKey.startsWith('pk_') || apiKey.startsWith('sk_');
        default: 
            return false;
    }
}

/**
 * 防抖函数
 * 
 * 限制函数在一定时间内只能执行一次。
 * 
 * @param {Function} func - 需要防抖的函数
 * @param {number} wait - 等待时间 (毫秒)
 * @returns {Function} 包装后的函数
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * HTML 转义
 * 
 * 将特殊字符转换为 HTML 实体，防止 XSS 攻击。
 * 使用浏览器原生的 DOM API 进行转义。
 * 
 * @param {string} text - 原始文本
 * @returns {string} 转义后的 HTML 字符串
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
