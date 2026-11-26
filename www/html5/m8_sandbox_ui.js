import {createNativePanel} from './m81_native_panel.js';
import {createSettingsSurface} from './m85_settings_host.js';
import {at, element, assetImage, textInput, setText, flashAssets, resolveFlashAsset, flashSpriteButton, flashTabButton} from './m8_ui_helpers.js';

const P = 'zh_CN/gui_summer/controls/';
const lookupAsset = resolveFlashAsset;

function createIconBadge(ui, keyOrItemId, alt = '') {
  const wrap = element('div', null, 'm8-sandbox-item-icon');
  const slotBg = lookupAsset(ui, `${P}tankbarn/BagItem_BK.png`);
  if (slotBg?.url) wrap.style.backgroundImage = `url("${slotBg.url}")`;
  const assetKey = typeof keyOrItemId === 'number' || /^\d+$/.test(String(keyOrItemId))
    ? ui.assets?.garage?.items?.[String(keyOrItemId)]?.icon
    : keyOrItemId;
  const asset = lookupAsset(ui, assetKey);
  if (asset) {
    wrap.append(assetImage(asset, alt));
  } else {
    wrap.textContent = '★';
    wrap.classList.add('is-fallback');
  }
  return wrap;
}

function segmentedButton(ui, label, selected, shape, handler, {width = 96, height = 28, testId = ''} = {}) {
  const skinKey = `${P}shop/shop_subnavItem${selected ? 'Selected' : ''}_${shape}.png`;
  const btn = flashSpriteButton(ui, skinKey, label, handler, {
    width,
    height,
    className: `m8-sandbox-seg-btn${selected ? ' is-selected' : ''}`,
    title: label,
    testId,
  });
  btn.setAttribute('aria-pressed', String(!!selected));
  return btn;
}

/** In-game Gift & Sandbox modal rendered directly inside a native Box1/Box3 dialog. */
export async function openSandboxModal(ui) {
  if (ui.sandboxShade || ui.state?.phase !== 'ready' || !['lobby', 'room'].includes(ui.state?.play?.phase)) return;
  const focusBefore = document.activeElement;
  const surface = createSettingsSurface({width: 726, height: 520});
  ui.sandboxShade = surface.root;

  const disposePortraits = root => {
    for (const p of root.querySelectorAll('.m8-portrait')) p.dispose?.();
  };

  const close = () => {
    if (!ui.sandboxShade) return;
    disposePortraits(surface.stage);
    surface.dispose();
    ui.sandboxShade = null;
    if (focusBefore?.isConnected) focusBefore.focus({preventScroll: true});
  };

  const panel = createNativePanel({
    assets: flashAssets(ui),
    kind: 'box1',
    state: 'BOTTOM_BAR',
    width: 726,
    height: 520,
    close: {asset: 'public.close', x: 687, y: 15, label: 'Đóng'},
    onClose: close,
  });
  panel.root.classList.add('m8-flash-dialog', 'm8-sandbox-dialog');

  const heading = at(element('h2', 'Quà Tặng & Sandbox', 'm8-flash-dialog-title'), 60, 18, 606);
  panel.content.append(heading);

  const tabsRow = at(element('div', null, 'm8-flash-tabs m8-sandbox-tabs'), 34, 53, 658, 35);
  tabsRow.style.zIndex = '2';
  panel.content.append(tabsRow);

  const boxBg = createNativePanel({
    assets: flashAssets(ui),
    kind: 'box3',
    state: 'DARK_BG',
    width: 674,
    height: 378,
  });
  at(boxBg.root, 26, 86).style.zIndex = '1';
  const body = element('div', null, 'm8-sandbox-flash-body');
  boxBg.content.append(body);
  panel.content.append(boxBg.root);

  const status = at(element('span', 'Đang tải…', 'm8-flash-dialog-hint'), 28, 478, 534);
  status.setAttribute('role', 'status');

  const btnBkAsset = lookupAsset(ui, `${P}public/window_button_blue_bk.png`);
  if (btnBkAsset) {
    panel.content.append(at(assetImage(btnBkAsset, '', 'm8-art'), 574, 468, btnBkAsset.width, btnBkAsset.height));
  }
  const closeBtn = at(flashSpriteButton(ui, `${P}public/button_window_blue.png`, 'Đóng', close, {
    width: 120,
    height: 35,
    testId: 'sandbox-close',
  }), 578, 472);
  panel.content.append(status, closeBtn);

  surface.stage.append(panel.root);
  surface.resize();
  surface.root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  closeBtn.focus({preventScroll: true});

  let busy = false;
  let activeTab = 'packs';
  let lastRenderedTab = 'packs';
  let tankQuery = '';
  let itemFilter = 'all';
  let itemQuery = '';
  let itemQty = 100;
  let data = null;

  const setStatus = (msg, isError = false) => {
    setText(status, msg);
    status.classList.toggle('is-error', !!isError);
  };

  const withAction = async (label, fn) => {
    if (busy) return;
    busy = true;
    setStatus(label);
    try {
      await fn();
      await loadInfo();
    } catch (error) {
      setStatus(error.message || 'Thao tác thất bại.', true);
    } finally {
      busy = false;
    }
  };

  const renderTabs = () => {
    const unownedCount = (data?.tanks || []).filter(t => !t.owned).length;
    const tabs = [
      ['packs', 'Gói Quà & Cấp'],
      ['tanks', `Nhận Tank (${unownedCount})`],
      ['items', 'Vật Phẩm'],
    ];
    tabsRow.replaceChildren(...tabs.map(([id, label]) => {
      const btn = flashTabButton(ui, label, activeTab === id, () => {
        activeTab = id;
        renderBody();
      }, {width: 136, height: 35, testId: `sandbox-tab-${id}`});
      btn.setAttribute('aria-pressed', String(activeTab === id));
      return btn;
    }));
  };

  const makeCutline = () => {
    const cutline = lookupAsset(ui, 'polish.cutline2');
    const divider = element('div', null, 'm8-sandbox-cutline');
    if (cutline?.url) divider.style.backgroundImage = `url("${cutline.url}")`;
    return divider;
  };

  const renderBody = () => {
    const prevScroll = lastRenderedTab === activeTab
      ? (body.querySelector('.m8-sandbox-scroll')?.scrollTop || 0)
      : 0;
    lastRenderedTab = activeTab;
    disposePortraits(body);
    body.replaceChildren();
    renderTabs();
    if (!data) return;

    if (activeTab === 'packs') {
      const lvlRow = element('div', null, 'm8-sandbox-level-bar');
      const lvlLead = element('div', null, 'm8-sandbox-level-lead');
      lvlLead.append(element('span', 'Cấp độ:'), element('strong', `Lv.${data.level}`));

      const lvlControls = element('div', null, 'm8-sandbox-level-controls');
      const lvlInput = textInput(String(Math.min(40, Number(data.level) || 1)), {maxLength: 2, placeholder: '1..40'});
      lvlInput.type = 'number';
      lvlInput.min = '1';
      lvlInput.max = '40';
      lvlInput.className = 'm8-sandbox-input';
      lvlInput.dataset.testid = 'sandbox-level-input';
      lvlInput.setAttribute('aria-label', 'Cấp nhân vật');

      const applyLevel = next => withAction(`Đang đặt Lv.${next}…`, async () => {
        const target = Math.max(1, Math.min(40, Math.trunc(Number(next) || 1)));
        await ui.client.setSandboxLevel(target);
        setStatus(`Đã đặt nhân vật lên Lv.${target}.`);
      });
      lvlInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyLevel(lvlInput.value);
        }
      });

      lvlControls.append(
        lvlInput,
        flashSpriteButton(ui, `${P}public/button_2_orange.png`, 'Đặt cấp', () => applyLevel(lvlInput.value), {
          width: 82, height: 28, testId: 'sandbox-level-set',
        }),
        flashSpriteButton(ui, `${P}public/button_2_blue.png`, '+1',
          () => applyLevel(Math.min(40, (Number(ui.state?.meta?.character?.level) || data.level) + 1)), {
            width: 56, height: 28, testId: 'sandbox-level-plus1',
          }),
        flashSpriteButton(ui, `${P}public/button_2_blue.png`, 'Lv.40', () => applyLevel(40), {
          width: 72, height: 28, testId: 'sandbox-level-40',
        }),
      );
      lvlRow.append(lvlLead, lvlControls);
      body.append(lvlRow, makeCutline());

      const list = element('div', null, 'm8-sandbox-scroll m8-sandbox-list');
      const packs = [
        ['upgrade_gems', 'Ngọc & Mảnh Cường Hóa (×500)', 'Saphire, Topaz, Hồng/Lục/Tử bảo, Mảnh giáp', null, 3000055],
        ['starter', 'Gói Khởi Đầu', '+500k Xu, +5M Bạc, +500k Xu khóa & nguyên liệu', null, 'currency.coupon'],
        ['currency', '+1M Xu & 5M Bạc', '+500k Xu khóa', {cash: 1_000_000, golden: 5_000_000, gift: 500_000}, 'currency.money'],
        ['crystals', 'Bộ Tinh Thể Lv.5', '16 tinh thể cấp 5', null, 8000024],
        ['materials', 'Nguyên Liệu & Trợ Thủ', 'Đá nâng cấp, cường hóa, thức ăn', null, 3000147],
        ['tanks', `Mở Khóa Tank (${data.unowned_tank_count} xe)`, 'Tối đa 32 tank vào Gara', null, 3000151],
      ];
      packs.forEach(([preset, name, desc, extra, iconKey], idx) => {
        const row = element('div', null, `m8-sandbox-list-row${idx % 2 === 1 ? ' is-alt' : ''}`);
        const lead = element('div', null, 'm8-flash-row-lead');
        const info = element('div', null, 'm8-flash-row-info');
        info.append(element('strong', name), element('small', desc));
        lead.append(createIconBadge(ui, iconKey, name), info);
        const claimBtn = flashSpriteButton(ui, `${P}public/button_2_green.png`, 'Nhận', () => withAction(`Đang nhận ${name}…`, async () => {
          const res = await ui.client.grantSandbox({preset, ...(extra || {})});
          setStatus(`Đã nhận: ${name} (${res.reward_count} mục).`);
        }), {width: 84, height: 28, testId: `sandbox-pack-${preset}`});
        if (preset === 'tanks' && data.unowned_tank_count === 0) claimBtn.disabled = true;
        row.append(lead, claimBtn);
        list.append(row);
      });
      body.append(list);
      list.scrollTop = prevScroll;
      return;
    }

    if (activeTab === 'tanks') {
      const bar = element('div', null, 'm8-sandbox-toolbar');
      const search = textInput(tankQuery, {placeholder: 'Tìm tên tank…', maxLength: 40});
      search.className = 'm8-sandbox-search';
      search.setAttribute('aria-label', 'Tìm tên tank');
      const countBadge = element('span', '', 'm8-sandbox-count');
      bar.append(search, countBadge);
      body.append(bar, makeCutline());

      const grid = element('div', null, 'm8-sandbox-scroll m8-flash-tank-grid');
      body.append(grid);

      const tileAsset = lookupAsset(ui, 'selection.tileUnselected');
      const renderTankGrid = () => {
        disposePortraits(grid);
        const q = tankQuery.trim().toLocaleLowerCase('vi');
        const unowned = (data.tanks || []).filter(t => !t.owned && (!q || t.name.toLocaleLowerCase('vi').includes(q)));
        setText(countBadge, `${unowned.length} xe`);
        if (!unowned.length) {
          grid.replaceChildren(element('p', q ? 'Không tìm thấy tank.' : 'Đã sở hữu toàn bộ tank!', 'm8-flash-empty'));
          return;
        }
        grid.replaceChildren(...unowned.map(tank => {
          const card = element('div', null, 'm8-sandbox-tank-tile');
          const stage = element('div', null, 'm8-sandbox-tank-stage');
          if (tileAsset?.url) stage.style.backgroundImage = `url("${tileAsset.url}")`;
          const portrait = ui.assets.portraitForTank({tankId: tank.id, level: 1}, {size: 70, animate: true});
          stage.append(portrait, element('strong', tank.name));
          const btn = flashSpriteButton(ui, `${P}public/button_2_green.png`, 'Nhận', () => withAction(`Đang mở ${tank.name}…`, async () => {
            await ui.client.grantSandbox({preset: 'tanks', tank_ids: [Number(tank.id)]});
            setStatus(`Đã nhận ${tank.name}.`);
          }), {width: 88, height: 25, testId: `sandbox-tank-${tank.id}`});
          card.append(stage, btn);
          return card;
        }));
      };
      search.addEventListener('input', () => { tankQuery = search.value; renderTankGrid(); });
      renderTankGrid();
      grid.scrollTop = prevScroll;
      return;
    }

    // Tab: items
    const filterBar = element('div', null, 'm8-sandbox-seg-bar');
    const searchRow = element('div', null, 'm8-sandbox-toolbar');
    const search = textInput(itemQuery, {placeholder: 'Tìm vật phẩm…', maxLength: 50});
    search.className = 'm8-sandbox-search';
    search.setAttribute('aria-label', 'Tìm vật phẩm');
    const isUpgradeMat = i => {
      const id = Number(i.id);
      return (id >= 3000001 && id <= 3000200) || id >= 3700000 || id === 8000024;
    };
    const categories = [
      ['all', 'Tất cả'],
      ['upgrade', 'Ngọc & Mảnh'],
      ['materials', 'Nguyên liệu'],
      ['crystals', 'Tinh thể'],
      ['helpers', 'Trợ thủ'],
      ['cosmetics', 'Skin'],
    ];
    const poolByKey = {
      upgrade: (data.materials || []).filter(isUpgradeMat).map(i => ({...i, group: 'Ngọc & Mảnh'})),
      materials: (data.materials || []).map(i => ({...i, group: 'Nguyên liệu'})),
      crystals: (data.crystals || []).map(i => ({...i, group: 'Tinh thể'})),
      helpers: (data.helpers || []).map(i => ({...i, group: 'Trợ thủ'})),
      cosmetics: (data.cosmetics || []).filter(i => !i.owned).map(i => ({...i, group: 'Skin'})),
    };
    const list = element('div', null, 'm8-sandbox-scroll m8-sandbox-list');

    const renderItems = () => {
      const q = itemQuery.trim().toLocaleLowerCase('vi');
      const pool = itemFilter === 'all'
        ? [...poolByKey.materials, ...poolByKey.crystals, ...poolByKey.helpers, ...poolByKey.cosmetics]
        : (poolByKey[itemFilter] || []);
      const filtered = q
        ? pool.filter(i => i.name.toLocaleLowerCase('vi').includes(q) || String(i.id).includes(q))
        : pool;
      if (!filtered.length) {
        list.replaceChildren(element('p', 'Không có vật phẩm phù hợp.', 'm8-flash-empty'));
        return;
      }
      list.replaceChildren(...filtered.slice(0, 120).map((item, idx) => {
        const row = element('div', null, `m8-sandbox-list-row${idx % 2 === 1 ? ' is-alt' : ''}`);
        const lead = element('div', null, 'm8-flash-row-lead');
        const info = element('div', null, 'm8-flash-row-info');
        info.append(element('strong', item.name), element('small', item.group));
        lead.append(createIconBadge(ui, Number(item.id), item.name), info);
        const btn = flashSpriteButton(ui, `${P}public/button_2_green.png`, `Nhận ×${itemQty}`, () => withAction(`Đang nhận ${item.name} ×${itemQty}…`, async () => {
          const res = await ui.client.grantSandbox({preset: 'item', id: Number(item.id), quantity: itemQty});
          setStatus(res.message || `Đã nhận ${item.name} ×${itemQty}.`);
        }), {width: 90, height: 26, testId: `sandbox-grant-item-${item.id}`});
        row.append(lead, btn);
        return row;
      }));
    };

    const renderCategoryBar = () => {
      const catWidths = [90, 118, 116, 104, 102, 118];
      filterBar.replaceChildren(...categories.map(([key, label], idx) => {
        const shape = idx === 0 ? 'left' : idx === categories.length - 1 ? 'right' : 'center';
        return segmentedButton(ui, label, itemFilter === key, shape, () => {
          itemFilter = key;
          renderCategoryBar();
          renderItems();
        }, {width: catWidths[idx], height: 28});
      }));
    };

    const qtyGroup = element('div', null, 'm8-sandbox-qty-toggle');
    const renderQtyToggle = () => {
      qtyGroup.replaceChildren(...[100, 500].map((qty, idx) => segmentedButton(ui, `×${qty}`, itemQty === qty, idx === 0 ? 'left' : 'right', () => {
        itemQty = qty;
        renderQtyToggle();
        renderItems();
      }, {width: 64, height: 28})));
    };

    renderCategoryBar();
    renderQtyToggle();
    search.addEventListener('input', () => { itemQuery = search.value; renderItems(); });
    searchRow.append(search, qtyGroup);
    body.append(filterBar, searchRow, makeCutline(), list);
    renderItems();
    list.scrollTop = prevScroll;
  };

  async function loadInfo() {
    data = await ui.client.sandboxInfo();
    if (!ui.sandboxShade) return;
    renderBody();
  }

  try {
    await loadInfo();
    setStatus('');
  } catch (error) {
    setStatus(error.message || 'Không tải được Sandbox.', true);
  }
}
