/* Native Flash Guild UI (Box1 BOTTOM_BAR 1000×600 + Box3/Box4, no box-in-a-box). */
import {at, element, numberText, nativeText, flashAssets, flashSpriteButton, flashTabButton} from './m8_ui_helpers.js';
import {ownGuildMember} from './m8_account_state.js';
import {createNativePanel} from './m81_native_panel.js';
import {guildPermissions, renderGuildManagement, renderGuildInvitations} from './m81_guild_management.js';
import {renderNativeGuildSkills} from './m81343_guild_skills.js';

export const GUILD_GEOMETRY = Object.freeze({width: 1000, height: 600});

function guildLeaderName(account) {
  const g = account.guild;
  if (!g) return '—';
  const leader = Object.values(account.members || {}).flat().find(m => m.charUuid === g.leaderUuid);
  return (leader && account.buddies?.[leader.accountId]?.name) || '—';
}

function renderPager(ui, assets, page, pages) {
  const nav = element('nav', null, 'm81-guild-pager');
  nav.setAttribute('aria-label', 'Trang danh sách Guild');
  const go = delta => {
    const next = Math.max(0, Math.min(pages - 1, page + delta));
    if (next === page || ui.loading.has('guildList')) return;
    ui.guildPage = next;
    ui.loadSection();
  };
  const prev = flashSpriteButton(ui, 'paging.btn_s2_prev', '', () => go(-1), {
    width: 33, height: 29, disabled: page <= 0 || ui.loading.has('guildList'), testId: 'guild-page-prev', title: 'Trang trước',
  });
  prev.setAttribute('aria-label', 'Trang trước');
  const pill = element('span', null, 'm81-guild-pager-pill');
  const bg = assets['paging.pager_bk'];
  if (bg?.url) pill.style.backgroundImage = `url("${bg.url}")`;
  pill.append(element('span', `${page + 1}/${pages}`));
  const next = flashSpriteButton(ui, 'paging.btn_s2_next', '', () => go(1), {
    width: 33, height: 29, disabled: page + 1 >= pages || ui.loading.has('guildList'), testId: 'guild-page-next', title: 'Trang sau',
  });
  next.setAttribute('aria-label', 'Trang sau');
  nav.append(prev, pill, next);
  return nav;
}

function renderNoGuild(ui, content, bottomRight, account, assets) {
  const toolbar = at(element('div', null, 'm81-guild-toolbar'), 26, 52, 948, 34);
  const search = ui.input('guildSearch', '', {placeholder: 'Tìm tên Guild chính xác…', maxLength: 80});
  search.className = 'm81-guild-search-input';
  const runSearch = () => {
    const q = search.value.trim();
    if (!q) return;
    ui.queryServer('guildSearchResult', 'cGuildInfo.php', {gn: q}, true);
  };
  const findBtn = flashSpriteButton(ui, 'public.blueButton', 'Tìm', runSearch, {
    width: 82, height: 28, disabled: ui.pending || !search.value.trim(), testId: 'guild-search',
  });
  search.addEventListener('input', () => {
    ui.fields.guildSearch = search.value;
    findBtn.disabled = ui.pending || !search.value.trim();
  });
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });

  const filter = element('label', null, 'm81-guild-check');
  const joinable = element('input');
  joinable.type = 'checkbox';
  joinable.checked = !!ui.guildJoinable;
  joinable.addEventListener('change', () => {
    ui.guildJoinable = joinable.checked;
    ui.guildPage = 0;
    ui.loadSection();
  });
  filter.append(joinable, element('span', 'Chỉ Guild tự do'));

  const cardCount = Object.values(ui.snapshot.meta?.containers || {})
    .flatMap(b => b.items || [])
    .filter(i => i.templateId === 2600007)
    .reduce((n, i) => n + Math.max(0, i.count), 0);
  const badge = element('span', `Thẻ Tạo Guild: ${numberText(cardCount)}`, 'm81-guild-header-meta');
  toolbar.append(search, findBtn, filter, badge);
  content.append(toolbar);

  const inviteBar = renderGuildInvitations(ui, account);
  if (inviteBar) content.append(at(inviteBar, 26, 88, 948, 32));

  const listTop = inviteBar ? 124 : 90;
  const listHeight = 532 - listTop;
  const listFrame = createNativePanel({assets, kind: 'box4', width: 948, height: listHeight});
  at(listFrame.root, 26, listTop);
  content.append(listFrame.root);

  const viewport = element('div', null, 'm81-guild-list-viewport');
  listFrame.content.append(viewport);

  if (ui.loading.has('guildSearchResult') || Object.hasOwn(ui.cache, 'guildSearchResult')) {
    const strip = element('div', null, 'm81-guild-search-hit');
    if (ui.loading.has('guildSearchResult')) {
      strip.append(element('span', 'Đang tìm Guild…'));
    } else {
      const found = ui.cache.guildSearchResult;
      if (found?.nGuildId) {
        strip.append(
          element('strong', found.szGuildName),
          element('span', `Cấp ${found.nGuildLv} · ${found.nGuildNumMember} TV · Chủ: ${found.szGuildLeader || '—'}`),
          flashSpriteButton(ui, 'polish.btn2GreenS', 'Xin vào', () => ui.confirm(
            'Xin tham gia Guild', found.szGuildName,
            () => ui.client.guildAction('apply', {guildId: found.nGuildId, inviter: '', fast: 0}),
            {success: 'Đã gửi yêu cầu tham gia.'}
          ), {width: 82, height: 24, disabled: !ui.canMutate(), testId: 'guild-search-apply'}),
        );
      } else {
        strip.append(element('span', found?.queryError || 'Không tìm thấy Guild này.', 'is-error'));
      }
      strip.append(flashSpriteButton(ui, 'public.blueButton', 'Đóng', () => {
        delete ui.cache.guildSearchResult;
        ui.render();
      }, {width: 56, height: 24, testId: 'guild-search-clear'}));
    }
    viewport.append(strip);
  }

  const data = ui.cache.guildList;
  const rows = data?.datas || [];
  const charLevel = Number(ui.snapshot.meta?.character?.level || 0);

  if (ui.loading.has('guildList')) {
    viewport.append(element('p', 'Đang tải danh sách Guild…', 'm81-guild-empty'));
  } else if (data?.queryError) {
    viewport.append(element('p', data.queryError, 'm81-guild-empty is-error'));
  } else if (!rows.length) {
    viewport.append(element('p', 'Chưa có Guild nào.', 'm81-guild-empty'));
  } else {
    const table = element('table', null, 'm81-guild-table');
    const thead = element('thead');
    const trHead = element('tr');
    for (const [label, cls] of [['Guild', 'col-name'], ['Cấp', 'col-lv'], ['Thành viên', 'col-num'], ['Điều kiện', 'col-cond'], ['', 'col-act']]) {
      trHead.append(element('th', label, cls));
    }
    thead.append(trHead);
    table.append(thead);

    const tbody = element('tbody');
    for (const row of rows) {
      const tr = element('tr');
      const nameCell = element('td');
      nameCell.append(element('strong', row.guild_name, 'm81-guild-row-name'));
      if (row.guild_notice) {
        const sub = element('span', row.guild_notice, 'm81-guild-row-sub');
        sub.title = row.guild_notice;
        nameCell.append(sub);
      }
      const condText = [
        `Lv.${row.guild_level_limit || 1}+`,
        row.auto_join ? 'Tự do' : 'Duyệt',
        Number(row.guild_ladder_limit) > 0 ? `Hạng ${row.guild_ladder_limit}+` : '',
      ].filter(Boolean).join(' · ');

      const actCell = element('td', null, 'col-act');
      const disabled = !ui.canMutate() || charLevel < Number(row.guild_level_limit || 0) || Number(row.guild_ladder_limit) > 0;
      actCell.append(flashSpriteButton(ui, row.auto_join ? 'polish.btn2GreenS' : 'polish.btn2SBlue', row.auto_join ? 'Tham gia' : 'Xin vào', () => {
        ui.confirm(row.auto_join ? 'Tham gia Guild' : 'Xin vào Guild', `${row.guild_name} · Yêu cầu cấp ${row.guild_level_limit}.`,
          () => ui.client.guildAction('apply', {guildId: row.guild_id, inviter: '', fast: 0}),
          {success: row.auto_join ? 'Đã tham gia Guild.' : 'Đã gửi đơn xin vào Guild.'});
      }, {width: 82, height: 25, disabled, testId: `guild-join-${row.guild_id}`}));

      tr.append(nameCell, element('td', numberText(row.guild_level), 'col-lv'), element('td', `${numberText(row.guild_number)}/${numberText(row.guild_maxnum)}`, 'col-num'), element('td', condText, 'col-cond'), actCell);
      tbody.append(tr);
    }
    table.append(tbody);
    viewport.append(table);
  }

  const pages = Math.max(1, Math.ceil(Number(data?.amount || 0) / 10));
  const page = Math.min(pages - 1, ui.guildPage || 0);
  content.append(at(renderPager(ui, assets, page, pages), 417, 545, 166, 30));

  const card = ui.catalog.guildItems?.['2600007'];
  if (card && cardCount < 1) {
    bottomRight.append(flashSpriteButton(ui, 'public.orange100', `Mua thẻ (${numberText(card.silverPrice)})`, () => ui.buyGuildCreationCard(), {
      width: 136, height: 32, disabled: !ui.canMutate() || Number(ui.snapshot.meta?.character?.currency?.golden || 0) < card.silverPrice,
      testId: 'guild-buy-create-card', title: `Mua 1 Thẻ Tạo Guild với ${numberText(card.silverPrice)} Bạc`,
    }));
  }
  bottomRight.append(flashSpriteButton(ui, 'public.green120', 'Tạo Guild', () => ui.openGuildCreation(false), {
    width: 118, height: 34, disabled: !ui.canMutate(), testId: 'guild-create',
  }));
}

function renderOverview(ui, host, account, member, height, assets) {
  const g = account.guild;
  const team = (account.teams || []).find(t => t.teamId === account.selfTeamId);
  const uuid = ui.snapshot.meta?.character?.charUuid || '';
  const totalMembers = Object.values(account.members || {}).reduce((n, list) => n + list.length, 0);

  const left = at(element('section', null, 'm81-guild-members-col'), 0, 0, 489, height);
  ui.renderGuildMembers(left, account);

  const memberFooter = at(element('div', null, 'm81-guild-members-footer'), 0, 326, 489, 34);
  if (member && guildPermissions(account, uuid, member).move && (account.teams || []).length > 1) {
    memberFooter.append(flashSpriteButton(ui, 'public.blueButton', 'Chuyển đội của tôi', () => ui.openGuildMove(uuid), {
      width: 142, height: 28, disabled: !ui.canMutate(), testId: 'guild-self-move',
    }));
  }
  memberFooter.append(element('span', `${totalMembers} thành viên · ${numberText(member?.merit || 0)} cống hiến`, 'm81-guild-members-stat'));
  left.append(memberFooter);
  host.append(left);

  const infoFrame = createNativePanel({assets, kind: 'box3', state: 'DARK_BG', width: 445, height});
  at(infoFrame.root, 503, 0);
  const info = element('div', null, 'm81-guild-info-body');
  const rows = [
    ['Tên Guild', g.name],
    ['Chủ Guild', guildLeaderName(account)],
    ['Đội của bạn', team?.name || '—'],
    ['Cấp Guild', numberText(g.level)],
    ['Quỹ Guild', numberText(g.coin)],
    ['Quỹ Team', numberText(team?.coin || 0)],
    ['Cống hiến', numberText(member?.merit || 0)],
  ];
  const dl = element('dl', null, 'm81-guild-kv');
  for (const [label, value] of rows) {
    const dt = element('dt', label);
    const dd = element('dd', value);
    dd.title = String(value);
    dl.append(dt, dd);
  }
  info.append(dl);

  const notice = element('div', null, 'm81-guild-notice-block');
  notice.append(element('strong', 'Thông báo Guild'), element('p', nativeText(g.notice) || 'Chưa có thông báo.'));
  info.append(notice);

  infoFrame.content.append(info);
  host.append(infoFrame.root);
}

function canOpenManage(ui, account) {
  const uuid = ui.snapshot.meta?.character?.charUuid || '';
  const p = guildPermissions(account, uuid);
  if (p.officer || p.leader) return true;
  return (account.teams || []).some(t => t.leaderUuid === uuid || p.inviteTeam(t.teamId));
}

export function renderNativeGuild(ui, body) {
  const account = ui.snapshot.account || {};
  const assets = flashAssets(ui);
  const titleAsset = assets['account.guildTitle'];
  const panel = createNativePanel({
    assets, kind: 'box1', state: 'BOTTOM_BAR', width: 1000, height: 600,
    title: titleAsset ? {asset: 'account.guildTitle', x: (1000 - titleAsset.width) / 2, y: 19, label: 'Guild'} : undefined,
    close: {asset: 'public.close', x: 961, y: 15, label: 'Đóng Guild'},
    onClose: () => ui.onClose(),
  });
  const root = panel.root;
  root.classList.add('m81-guild-view');
  root.dataset.nativeScreen = 'guild';
  panel.close.dataset.testid = 'guild-close';
  const content = panel.content;

  const bottomLeft = at(element('div', null, 'm81-guild-bottom-left'), 26, 542, 330, 36);
  bottomLeft.append(flashSpriteButton(ui, 'public.blueButton', 'Làm mới', () => ui.refresh(), {
    width: 88, height: 30, disabled: !!ui.pending, testId: 'guild-refresh',
  }));
  const bottomRight = at(element('div', null, 'm81-guild-bottom-right'), 680, 542, 294, 36);
  content.append(bottomLeft, bottomRight);

  const statusText = ui.message || (!ui.canMutate() && !ui.pending ? 'Về sảnh hoặc phòng chờ để thao tác Guild.' : '');
  if (statusText) {
    const statusNode = at(element('span', statusText, `m81-guild-status${ui.messageError ? ' is-error' : ''}`), account.guild ? 346 : 124, 547, account.guild ? 330 : 285, 26);
    statusNode.setAttribute('role', 'status');
    statusNode.title = statusText;
    content.append(statusNode);
  }

  if (!account.guild) {
    renderNoGuild(ui, content, bottomRight, account, assets);
    body.append(root);
    return root;
  }

  const g = account.guild;
  const char = ui.snapshot.meta?.character || {};
  const member = ownGuildMember(account, Number(char.accountId || ui.identity));
  const uuid = char.charUuid || '';
  const p = guildPermissions(account, uuid);
  const team = (account.teams || []).find(t => t.teamId === account.selfTeamId);
  const showManage = canOpenManage(ui, account);

  const tabBar = at(element('div', null, 'm81-guild-tabs'), 26, 52, 948, 35);
  const nav = element('nav', null, 'm8-flash-tabs');
  nav.setAttribute('aria-label', 'Chức năng Guild');
  nav.setAttribute('role', 'tablist');

  const activeTab = ui.guildTab === 'manage' && showManage ? 'manage' : ui.guildTab === 'skills' ? 'skills' : 'overview';
  const tabs = [['overview', 'Tổng quan'], ['skills', 'Kỹ năng'], ...(showManage ? [['manage', 'Quản lý']] : [])];

  for (const [key, label] of tabs) {
    const selected = activeTab === key;
    const btn = flashTabButton(ui, label, selected, () => {
      if (key === 'skills') {
        ui.guildTab = 'skills';
        ui.afterRenderFocus = 'guild-skills-tab-' + (ui.fields.guildSkillsTab === 'research' ? 'research' : 'learn');
      } else {
        ui.guildTab = key;
      }
      ui.render();
    }, {width: 112, height: 33, testId: `guild-tab-${key}`});
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(selected));
    nav.append(btn);
  }

  const summary = element('span', `${g.name} · Lv.${numberText(g.level)} · Quỹ ${numberText(g.coin)} · ${team?.name || '—'}`, 'm81-guild-header-meta');
  tabBar.append(nav, summary);
  content.append(tabBar);

  const inviteBar = renderGuildInvitations(ui, account);
  if (inviteBar) content.append(at(inviteBar, 26, 89, 948, 32));

  const wsTop = inviteBar ? 125 : 88;
  const wsHeight = 532 - wsTop;
  const workspace = at(element('section', null, 'm81-guild-workspace'), 26, wsTop, 948, wsHeight);
  workspace.setAttribute('role', 'tabpanel');
  content.append(workspace);

  if (activeTab === 'manage') {
    const manageFrame = createNativePanel({assets, kind: 'box3', state: 'DARK_BG', width: 948, height: wsHeight});
    workspace.append(manageFrame.root);
    renderGuildManagement(ui, manageFrame.content, account);
  } else {
    renderOverview(ui, workspace, account, member, wsHeight, assets);
  }

  bottomLeft.append(
    flashSpriteButton(ui, 'public.green100', 'Cống hiến', () => ui.openGuildDonation(), {
      width: 96, height: 32, disabled: !ui.canMutate(), testId: 'guild-donate',
    }),
    flashSpriteButton(ui, 'public.blueButton', 'Kỹ năng', () => {
      ui.guildTab = 'skills';
      ui.afterRenderFocus = 'guild-skills-tab-' + (ui.fields.guildSkillsTab === 'research' ? 'research' : 'learn');
      ui.render();
    }, {width: 88, height: 30, testId: 'guild-open-skills'}),
  );

  const next = (ui.catalog.guildLevels || []).find(row => row.nLevel === g.level);
  if (p.officer && next?.iNextCoin) {
    bottomRight.append(flashSpriteButton(ui, 'public.orange100', `Nâng cấp (${numberText(next.iNextCoin)})`, () => {
      ui.confirm('Nâng cấp Guild', `Tiêu ${numberText(next.iNextCoin)} quỹ Guild để lên cấp ${g.level + 1}.`,
        () => ui.client.guildAction('upgrade'), {success: 'Đã nâng cấp Guild.'});
    }, {width: 152, height: 32, disabled: !ui.canMutate() || g.coin < next.iNextCoin, testId: 'guild-upgrade'}));
  }
  bottomRight.append(flashSpriteButton(ui, 'public.red120', 'Rời Guild', () => {
    ui.confirm('Rời Guild', 'Xác nhận rời Guild hiện tại?', () => ui.client.guildAction('leave'), {button: 'Rời Guild', success: 'Đã rời Guild.'});
  }, {width: 98, height: 32, disabled: !ui.canMutate(), testId: 'guild-leave'}));

  if (activeTab === 'skills') {
    for (const node of [...root.children]) node.inert = true;
    renderNativeGuildSkills(ui, root, account, member, {
      onClose: () => {
        delete ui.fields.guildSkillPickerSlot;
        ui.guildTab = 'overview';
        ui.afterRenderFocus = 'guild-tab-skills';
        ui.render();
      },
    });
  }

  body.append(root);
  return root;
}
