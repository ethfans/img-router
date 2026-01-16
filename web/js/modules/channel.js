/**
 * 渠道设置模块
 * 
 * 负责渲染和管理各个 Provider 的详细配置。
 * 包括模型选择、尺寸设置、质量选项以及启用/禁用状态。
 * 支持动态加载支持的尺寸列表。
 */

import { apiFetch, debounce } from './utils.js';

let currentConfig = {};
let channelSupportedSizes = [];
let channelRuntimeConfig = { providers: {} };

/**
 * 渲染渠道设置页面
 * 
 * @param {HTMLElement} container - 容器元素
 */
export async function renderChannel(container) {
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">渠道设置</h3>
                <div class="status-pill">
                    <span class="status-dot"></span>
                    <span>运行中</span>
                </div>
            </div>
            <div id="channelsContainer">
                <div class="loading">加载中...</div>
            </div>
        </div>
    `;

    // 事件委托处理变更
    // 监听所有配置项的变动并触发自动保存
    container.addEventListener('change', (e) => {
        // 检查是否是配置项 (带有 data-provider 属性)
        if (e.target.dataset.provider) {
            debounceSave();
        }
    });

    // 加载配置
    await loadChannelConfig();
}

/**
 * 加载渠道配置
 */
async function loadChannelConfig() {
    try {
        const res = await apiFetch('/api/config');
        if (!res.ok) return;
        const config = await res.json();
        currentConfig = config;
        
        channelSupportedSizes = Array.isArray(config.supportedSizes) ? config.supportedSizes : [];
        channelRuntimeConfig = config.runtimeConfig || { providers: {} };

        const providers = Array.isArray(config.providers) ? config.providers : [];
        renderAllChannels(providers);
        
    } catch (e) {
        console.error('Failed to load channel config:', e);
        document.getElementById('channelsContainer').innerHTML = '<div style="padding:20px; text-align:center; color:red;">加载失败</div>';
    }
}

/**
 * 渲染所有渠道的配置卡片
 * 
 * @param {Array<Object>} providers - Provider 列表
 */
function renderAllChannels(providers) {
    const container = document.getElementById('channelsContainer');
    if (!container) return;

    container.innerHTML = '';

    for (const provider of providers) {
        // 获取运行时配置中的默认值
        const providerDefaults = (channelRuntimeConfig.providers || {})[provider.name] || {};
        const textDefaults = providerDefaults.text || {};
        const editDefaults = providerDefaults.edit || {};
        const isEnabled = provider.enabled !== false;

        const section = document.createElement('div');
        section.className = 'form-section';
        section.style.padding = '12px 16px';
        section.innerHTML = `
            <div class="form-header" style="display:flex; justify-content:space-between; align-items:center; padding-bottom: 8px; margin-bottom: 8px;">
                <h3 class="card-title" style="font-size: 0.9rem;">${provider.name}</h3>
                <div style="display:flex; align-items:center; gap:10px;">
                    <label class="switch" style="transform: scale(0.8);">
                        <input type="checkbox" data-provider="${provider.name}" data-field="enabled" ${isEnabled ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="channel-table" style="${isEnabled ? '' : 'opacity:0.5; pointer-events:none; transition: opacity 0.3s;'}">
                <div class="channel-row">
                    <div class="channel-label"></div>
                    <div class="channel-header">模型</div>
                    <div class="channel-header">尺寸</div>
                    <div class="channel-header">质量</div>
                </div>
                <div class="channel-row">
                    <div class="channel-label">
                        <i class="ri-image-add-line"></i>
                        <span>文生图</span>
                    </div>
                    <div class="channel-cell">${buildModelSelect(provider, 'text', textDefaults.model)}</div>
                    <div class="channel-cell">${buildSizeSelect(provider, 'text', textDefaults.size)}</div>
                    <div class="channel-cell">${buildQualitySelect(provider, textDefaults.quality, 'text')}</div>
                </div>
                <div class="channel-row">
                    <div class="channel-label">
                        <i class="ri-edit-2-line"></i>
                        <span>图片编辑</span>
                    </div>
                    <div class="channel-cell">${buildModelSelect(provider, 'edit', editDefaults.model)}</div>
                    <div class="channel-cell">${buildSizeSelect(provider, 'edit', editDefaults.size)}</div>
                    <div class="channel-cell">${buildQualitySelect(provider, editDefaults.quality, 'edit')}</div>
                </div>
            </div>
        `;
        container.appendChild(section);
    }
}

/**
 * 构建模型选择下拉框
 * 
 * @param {Object} provider - Provider 对象
 * @param {string} task - 任务类型 ('text' | 'edit')
 * @param {string} currentValue - 当前选中的值
 * @returns {string} HTML 字符串
 */
function buildModelSelect(provider, task, currentValue) {
    const baseModel = task === 'edit'
        ? (provider.defaultEditModel || provider.defaultModel)
        : provider.defaultModel;
    const models = task === 'edit'
        ? ((provider.editModels && provider.editModels.length > 0) ? provider.editModels : provider.supportedModels)
        : provider.supportedModels;

    let html = `<select class="form-control" data-provider="${provider.name}" data-task="${task}" data-field="model">`;
    html += `<option value="">跟随默认（${baseModel}）</option>`;
    for (const m of models || []) {
        const selected = currentValue === m ? 'selected' : '';
        html += `<option value="${m}" ${selected}>${m}</option>`;
    }
    html += '</select>';
    return html;
}

/**
 * 构建尺寸选择下拉框
 * 
 * @param {Object} provider - Provider 对象
 * @param {string} task - 任务类型
 * @param {string} currentValue - 当前选中的值
 * @returns {string} HTML 字符串
 */
function buildSizeSelect(provider, task, currentValue) {
    const baseSize = task === 'edit'
        ? (provider.defaultEditSize || provider.defaultSize)
        : provider.defaultSize;
    const sizes = channelSupportedSizes && channelSupportedSizes.length > 0
        ? channelSupportedSizes
        : ['1024x1024', '1024x768', '768x1024', '1280x720'];

    let html = `<select class="form-control" data-provider="${provider.name}" data-task="${task}" data-field="size">`;
    html += `<option value="">跟随默认（${baseSize}）</option>`;
    for (const s of sizes) {
        const selected = currentValue === s ? 'selected' : '';
        html += `<option value="${s}" ${selected}>${s}</option>`;
    }
    html += '</select>';
    return html;
}

/**
 * 构建质量选择下拉框
 * 
 * @param {Object} provider - Provider 对象
 * @param {string} currentValue - 当前选中的值
 * @param {string} task - 任务类型
 * @returns {string} HTML 字符串
 */
function buildQualitySelect(provider, currentValue, task) {
    const baseQuality = currentConfig.defaultQuality || 'standard';
    const supportsQuality = !!provider.supportsQuality;
    const disabled = supportsQuality ? '' : 'disabled';
    const opacity = supportsQuality ? '1' : '0.6';

    let html = `<select class="form-control" data-provider="${provider.name}" data-task="${task}" data-field="quality" ${disabled} style="opacity: ${opacity}">`;
    html += `<option value="">跟随默认（${baseQuality}）</option>`;
    const stdSelected = currentValue === 'standard' ? 'selected' : '';
    const hdSelected = currentValue === 'hd' ? 'selected' : '';
    html += `<option value="standard" ${stdSelected}>标准</option>`;
    html += `<option value="hd" ${hdSelected}>高清</option>`;
    html += '</select>';
    return html;
}

/**
 * 防抖保存函数
 */
const debounceSave = debounce(async () => {
    await saveChannelSettings();
}, 1000);

/**
 * 保存渠道配置到后端
 */
async function saveChannelSettings() {
    const statusDot = document.querySelector('.status-pill .status-dot');
    const statusText = document.querySelector('.status-pill span');
    if (statusDot && statusText) {
        statusDot.style.background = '#ffd700';
        statusText.innerText = '保存中...';
    }

    try {
        // 构建 providers 配置对象
        const providersConfig = {};
        
        // 收集所有 provider 名称
        const providerNames = new Set();
        document.querySelectorAll('[data-provider]').forEach(el => providerNames.add(el.dataset.provider));
        
        for (const name of providerNames) {
             const enabledInput = document.querySelector(`input[data-provider="${name}"][data-field="enabled"]`);
             const isEnabled = enabledInput ? enabledInput.checked : true;
             
             // 收集 defaults (text/edit)
             const defaults = { text: {}, edit: {} };
             
             document.querySelectorAll(`select[data-provider="${name}"]`).forEach(sel => {
                 const task = sel.dataset.task; // text or edit
                 const field = sel.dataset.field; // model, size, quality
                 const val = sel.value;
                 
                 if (val) { // 只有非空值才保存
                     if (!defaults[task]) defaults[task] = {};
                     defaults[task][field] = val;
                 }
             });
             
             // 构建单个 provider 配置
             providersConfig[name] = {
                 enabled: isEnabled,
                 ...defaults
             };
        }
        
        // 发送配置更新
        await apiFetch('/api/runtime-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providers: providersConfig })
        });
        
        if (statusDot) {
            statusDot.style.background = 'var(--success)';
            statusText.innerText = '已保存';
            setTimeout(() => {
                statusText.innerText = '运行中';
            }, 2000);
        }
    } catch (e) {
        console.error(e);
        if (statusDot) statusDot.style.background = 'var(--error)';
        statusText.innerText = '保存失败';
    }
}
