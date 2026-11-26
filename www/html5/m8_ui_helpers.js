import {createNativePanel} from './m81_native_panel.js';
import {createSettingsSurface} from './m85_settings_host.js';

// Small DOM helpers. Native/user text is always textContent, never HTML.
export const numberText = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('vi-VN') : '—';
export function at(node, x, y, width, height) {
  Object.assign(node.style, {position: 'absolute', left: `${x}px`, top: `${y}px`});
  if (width != null) node.style.width = `${width}px`;
  if (height != null) node.style.height = `${height}px`;
  return node;
}
export const place = at;
export const flashAssets = ui => ({...(ui?.assets?.ui?.assets || {}), ...(ui?.assets?.panels?.assets || {})});
export async function sha256Hex(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function fetchVerifiedJson(url, errorMessage = 'Không tải được dữ liệu.') {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error(errorMessage);
  const bytes = await response.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const catalog = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  return {catalog, sha256, bytes: bytes.byteLength};
}
export function imageAssetsFromSource(source) {
  if (/\.(png|jpe?g|webp)$/i.test(source?.url || '')) return [source];
  const d = source?.derived;
  return [d?.asset, ...(d?.assets || []), ...(d?.layers || []).flatMap(layer => [layer.asset, ...(layer.assets || [])])]
    .filter(Boolean);
}
export function createFlashDialog(ui, {
  width = 726, height = 520, title = '', statusText = '', closeLabel = 'Đóng',
  closeTestId = 'dialog-close', canClose = () => true, onBeforeClose = null, onAfterClose = null,
  returnFocus = null,
} = {}) {
  const focusBefore = returnFocus || document.activeElement;
  const surface = createSettingsSurface({width, height});
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    onBeforeClose?.(surface);
    surface.dispose();
    onAfterClose?.();
    if (focusBefore?.isConnected) focusBefore.focus({preventScroll: true});
  };
  const tryClose = () => { if (canClose()) close(); };
  const panel = createNativePanel({
    assets: flashAssets(ui), kind: 'box1', state: 'CONFIRM', width, height,
    close: {asset: 'public.close', x: width - 50, y: 15, label: closeLabel}, onClose: tryClose,
  });
  panel.root.classList.add('m8-flash-dialog');
  const heading = at(element('h2', title, 'm8-flash-dialog-title'), 60, 18, width - 120);
  const tabsRow = at(element('div', null, 'm8-flash-tabs'), 26, 52, width - 52, 32);
  const boxBg = createNativePanel({assets: flashAssets(ui), kind: 'box3', state: 'DARK_BG', width: width - 52, height: height - 160});
  at(boxBg.root, 26, 86);
  const status = at(element('span', statusText, 'm8-flash-dialog-hint'), 28, height - 54, width - 194);
  status.setAttribute('role', 'status');
  const closeBtn = at(flashSpriteButton(ui, 'zh_CN/gui_summer/controls/public/button_window_blue.png', closeLabel, tryClose, {
    width: 120, height: 35, testId: closeTestId,
  }), width - 148, height - 59);
  panel.content.append(heading, tabsRow, boxBg.root, status, closeBtn);
  surface.stage.append(panel.root);
  surface.resize();
  surface.root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); tryClose(); }
  });
  return {surface, panel, tabsRow, body: boxBg.content, status, closeBtn, close};
}
export function nativeText(value) {
  return String(value ?? '').replace(/#ENTER#/g, '\n').replace(/#COLOR_[0-9a-fA-F]+_/g, '')
    .replace(/_END#/g, '').replace(/<[^>]*>/g, '');
}
export function element(tag, text, className = '') {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
export function actionButton(text, handler, {disabled = false, className = '', title = '', testId = ''} = {}) {
  const node = element('button', text, `m8-button ${className}`.trim());
  node.type = 'button'; node.disabled = !!disabled;
  if (title) node.title = title;
  if (testId) node.dataset.testid = testId;
  if (handler) node.addEventListener('click', handler);
  return node;
}
export function assetImage(asset, alt = '', className = '') {
  const node = element('img', null, className); node.alt = alt; node.draggable = false;
  node.decoding = 'async';
  if (asset?.url && !/\.swf(?:$|[?#])/i.test(asset.url)) node.src = asset.url;
  else { node.hidden = true; node.dataset.assetMissing = 'true'; }
  return node;
}
export function field(label, input) {
  const node = element('label', null, 'm8-field');
  node.append(element('span', label), input); return node;
}
export function selectInput(options, value, label = '') {
  const input = element('select'); if (label) input.setAttribute('aria-label', label);
  for (const row of options) {
    const option = element('option', row.label); option.value = String(row.value);
    option.disabled = !!row.disabled; input.append(option);
  }
  if (value != null) input.value = String(value);
  return input;
}
export function textInput(value = '', {placeholder = '', maxLength = 100, type = 'text'} = {}) {
  const input = element('input'); input.type = type; input.value = String(value);
  input.placeholder = placeholder; input.maxLength = maxLength; return input;
}
export function note(text, kind = '') { return element('p', text, `m8-note ${kind}`.trim()); }
export function setText(node, value) {
  const text = String(value ?? ''); if (node.textContent !== text) node.textContent = text;
}
export function resolveFlashAsset(source, key) {
  if (!source || !key) return null;
  if (typeof source === 'object' && typeof source.url === 'string' && key === source.logical) return source;
  const assets = source.assets || source;
  return assets?.get?.(key) || assets?.resources?.get?.(key)
    || assets?.ui?.assets?.[key] || assets?.panels?.assets?.[key]
    || assets?.flashPolish?.assets?.[key] || assets?.garage?.assets?.[key]
    || assets?.[key] || null;
}
export function flashSpriteButton(source, skinKey, text, handler, {
  width = null, height = null, className = '', title = text, testId = '', disabled = false,
} = {}) {
  const asset = resolveFlashAsset(source, skinKey);
  const w = width ?? asset?.width ?? 100;
  const h = height ?? asset?.height ?? 32;
  const btn = actionButton('', handler, {
    disabled, className: `${asset ? 'm8-flash-btn' : ''} ${className}`.trim(), title, testId,
  });
  if (asset) {
    Object.assign(btn.style, {width: `${w}px`, height: `${h}px`});
    const img = assetImage(asset, '', 'm8-flash-btn-bg');
    Object.assign(img.style, {width: `${w}px`, height: `${h}px`});
    btn.append(img);
    btn.append(element('span', text, 'm8-flash-btn-label'));
  } else {
    btn.textContent = String(text ?? '');
  }
  return btn;
}
export function flashTabButton(source, text, selected, handler, {
  upKey = 'polish.tabTopUp', selectedKey = 'polish.tabTopSelected',
  width = 104, height = 30, className = '', title = text, testId = '',
} = {}) {
  return flashSpriteButton(source, selected ? selectedKey : upKey, text, handler, {
    width, height,
    className: `m8-flash-tab-sprite${selected ? ' is-selected' : ''}${className ? ' ' + className : ''}`,
    title, testId,
  });
}
export function flashCloseButton(source, handler, {
  label = 'Đóng', key = 'public.close', disabledKey = 'public.closeDisabled',
  className = '', testId = '',
} = {}) {
  const asset = resolveFlashAsset(source, key);
  const btn = element('button', asset ? null : '×', `m8-button m8-flash-close-btn ${className}`.trim());
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  if (testId) btn.dataset.testid = testId;
  if (asset) {
    btn.style.width = `${asset.width}px`;
    btn.style.height = `${asset.height}px`;
    btn.append(assetImage(asset, '', 'm8-flash-close-img'));
    const dis = resolveFlashAsset(source, disabledKey);
    if (dis) btn.dataset.disabledUrl = dis.url;
  }
  if (handler) btn.addEventListener('click', handler);
  return btn;
}
export function flashProgressBar(source, fraction = 0, {
  trackKey = 'loading.progressTrack', fillKey = 'loading.progress',
  width = null, height = 16, label = '', className = '',
} = {}) {
  const track = resolveFlashAsset(source, trackKey);
  const fill = resolveFlashAsset(source, fillKey);
  const clamped = Math.max(0, Math.min(1, Number(fraction) || 0));
  const root = element('div', null, `m8-flash-progress ${className}`.trim());
  if (width != null) root.style.width = typeof width === 'number' ? `${width}px` : String(width);
  root.style.height = `${height}px`;
  if (track?.url) root.style.backgroundImage = `url("${track.url}")`;
  const fillNode = element('div', null, 'm8-flash-progress-fill');
  fillNode.style.width = `${Math.round(clamped * 1000) / 10}%`;
  if (fill?.url) fillNode.style.backgroundImage = `url("${fill.url}")`;
  root.append(fillNode);
  if (label) root.append(element('span', label, 'm8-flash-progress-label'));
  root.setProgress = (nextFraction, nextLabel = null) => {
    const pct = Math.max(0, Math.min(1, Number(nextFraction) || 0));
    fillNode.style.width = `${Math.round(pct * 1000) / 10}%`;
    if (nextLabel != null) {
      const span = root.querySelector('.m8-flash-progress-label');
      if (span) setText(span, nextLabel);
    }
  };
  return root;
}
export function flashPagerDots(source, total, activeIndex, onSelect, {className = ''} = {}) {
  const row = element('div', null, `m8-flash-pager ${className}`.trim());
  const normal = resolveFlashAsset(source, 'paging.circlepager_blue');
  const active = resolveFlashAsset(source, 'paging.circlepager_selected');
  for (let i = 0; i < total; i++) {
    const isCurrent = i === activeIndex;
    const btn = actionButton(normal && active ? '' : String(i + 1), () => onSelect?.(i), {
      className: `m8-flash-pager-dot${isCurrent ? ' is-selected' : ''}`,
      title: `Trang ${i + 1}/${total}`,
    });
    const icon = isCurrent ? active : normal;
    if (icon) btn.append(assetImage(icon, `Trang ${i + 1}`, 'm8-flash-pager-img'));
    row.append(btn);
  }
  return row;
}
