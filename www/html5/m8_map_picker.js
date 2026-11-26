import {BATTLE_MAPS} from './m810_modes.js';
import {element, actionButton, assetImage, setText, flashTabButton, createFlashDialog} from './m8_ui_helpers.js';

/**
 * Unscaled Flash-native Map Picker modal.
 * Lives in createSettingsSurface outside transformed stages so taps work reliably on mobile & fullscreen.
 */
export function openMapPickerModal(ui, {
  currentMode = 'pk_robo',
  includeTraining = false,
  title = 'Chọn bản đồ chiến đấu',
  onSelect,
  returnFocus = null,
} = {}) {
  if (ui.mapPickerDispose) return;
  const maps = BATTLE_MAPS.filter(m => includeTraining || m.mode !== 'test_desert');
  const groups = ['Tất cả', ...new Set(maps.map(m => m.group))];
  let selectedGroup = 'Tất cả';
  let busy = false;

  const dialog = createFlashDialog(ui, {
    width: 726, height: 520, title, statusText: 'Chạm vào bản đồ để chọn ngay',
    closeTestId: 'map-picker-close', canClose: () => !busy,
    onAfterClose: () => { ui.mapPickerDispose = null; }, returnFocus,
  });
  ui.mapPickerDispose = dialog.close;
  const grid = element('div', null, 'm8-map-grid');
  dialog.body.append(grid);
  const {tabsRow, status, close} = dialog;

  const renderGrid = () => {
    const tabWidth = Math.max(72, Math.floor((674 - Math.max(0, groups.length - 1) * 4) / Math.max(1, groups.length)));
    tabsRow.replaceChildren(...groups.map(group => {
      const active = group === selectedGroup;
      const tab = flashTabButton(ui, group, active, () => {
        selectedGroup = group;
        renderGrid();
      }, {width: tabWidth, height: 28, testId: `map-group-${group}`});
      tab.setAttribute('aria-pressed', String(active));
      return tab;
    }));

    const visible = selectedGroup === 'Tất cả' ? maps : maps.filter(m => m.group === selectedGroup);
    grid.replaceChildren(...visible.map(map => {
      const selected = map.mode === currentMode;
      const tile = actionButton('', async () => {
        if (busy) return;
        busy = true;
        setText(status, `Đang chọn ${map.name}…`);
        try {
          await onSelect?.(map);
          close();
        } catch (err) {
          busy = false;
          setText(status, err?.message || 'Không đổi được bản đồ.');
        }
      }, {className: `m8-map-tile${selected ? ' is-selected' : ''}`, testId: `map-pick-${map.mode}`});
      tile.setAttribute('aria-pressed', String(selected));
      const preview = ui.assets?.m3?.maps?.[String(map.mapId)]?.preview;
      if (preview) tile.append(assetImage(preview, map.name, 'm8-map-tile-img'));
      const meta = element('div', null, 'm8-map-tile-meta');
      meta.append(element('small', map.group), element('strong', map.name));
      tile.append(meta);
      if (selected) tile.append(element('span', 'Đang chọn', 'm8-map-tile-badge'));
      return tile;
    }));
  };

  renderGrid();
  (grid.querySelector('.is-selected') || dialog.closeBtn)?.focus?.({preventScroll: true});
}
