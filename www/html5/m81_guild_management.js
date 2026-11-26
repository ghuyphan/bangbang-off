/* Native Guild management sub-tabs inside Box3 (no box-in-a-box, no text walls). */
import {element, selectInput, numberText, flashSpriteButton, flashTabButton} from './m8_ui_helpers.js';
import {renderGuildApplications} from './m81_guild_applications.js';
import {renderGuildRecruitment} from './m81_guild_recruitment.js';

export function guildName(value) {
  const name = String(value ?? '').trim();
  if (!name || new TextEncoder().encode(name).length > 12 || /[\x00-\x1f]/.test(name)) {
    throw new Error('Tên không được trống, tối đa 12 byte UTF-8 và không chứa ký tự điều khiển.');
  }
  return name;
}

export function recruitmentFlags(flags, bit, on) {
  let result = Number(flags) & 7;
  result = on ? result | bit : result & ~bit;
  if (on && bit === 1) result &= ~2;
  if (on && bit === 2) result &= ~1;
  return result;
}

export function guildPermissions(account, uuid, target = null) {
  const g = account.guild || {}, teams = account.teams || [];
  const mine = Object.values(account.members || {}).flat().find(m => m.charUuid === uuid);
  const leader = !!uuid && g.leaderUuid === uuid, vice = !!uuid && g.viceLeaderUuid === uuid, officer = leader || vice;
  const team = teams.find(t => t.teamId === target?.teamId), ownTeam = teams.find(t => t.teamId === mine?.teamId);
  const captain = !!uuid && team?.leaderUuid === uuid;
  const protectedTarget = target && [g.leaderUuid, g.viceLeaderUuid].includes(target.charUuid);
  return {
    leader, vice, officer, mine,
    remove: !!target && target.charUuid !== uuid && (leader || (vice && target.charUuid !== g.leaderUuid) || (ownTeam?.leaderUuid === uuid && mine?.teamId === target.teamId && !protectedTarget)),
    posts: !target ? [] : [10, 9, 5, 0].filter(post => {
      if ((post === 10 || post === 9 || protectedTarget) ? !leader : !(officer || captain)) return false;
      return post === 10 ? target.charUuid !== uuid : post === 9 || post === 0 ? target.charUuid !== g.leaderUuid : true;
    }),
    move: !!target && (officer || target.charUuid === uuid) && team?.leaderUuid !== target.charUuid,
    inviteTeam: tid => !!uuid && (officer || teams.find(t => t.teamId === tid)?.leaderUuid === uuid || !!(g.settings & 4)),
  };
}

function showError(ui, e) {
  ui.message = e.message || String(e);
  ui.messageError = true;
  ui.render();
}

function send(ui, label, detail, op, values, {skin = 'public.blueButton', width = 92, height = 28, ...options} = {}) {
  return flashSpriteButton(ui, skin, label, () => {
    if (!ui.canMutate()) return;
    try {
      const data = typeof values === 'function' ? values() : values;
      ui.confirm(label, typeof detail === 'function' ? detail(data) : detail, () => ui.client.guildAction(op, data), {success: 'Đã cập nhật Guild.', button: label});
    } catch (e) { showError(ui, e); }
  }, {width, height, disabled: !ui.canMutate(), ...options});
}

function cardCount(ui, id) {
  return Object.values(ui.snapshot.meta?.containers || {})
    .flatMap(b => b.items || [])
    .filter(i => i.templateId === id)
    .reduce((n, i) => n + Math.max(0, i.count), 0);
}

function renderRenameRow(ui, host, title, op, id, teamId) {
  const count = cardCount(ui, id);
  const head = element('div', null, 'm81-guild-sec-head');
  head.append(element('strong', title), element('span', `Thẻ: ${numberText(count)}`));
  host.append(head);

  const row = element('div', null, 'm81-guild-inline-row');
  const input = ui.input(`gm-${op}-${teamId || 0}`, '', {placeholder: 'Tên mới (≤12 byte)', maxLength: 12});
  row.append(input);
  const item = ui.catalog.guildItems?.[id];
  if (item && count < 1) {
    row.append(flashSpriteButton(ui, 'public.orange100', `Mua (${numberText(item.silverPrice)})`, () => {
      ui.confirm('Mua thẻ đổi tên', `${numberText(item.silverPrice)} Bạc · 1 thẻ.`, () => ui.client.guildPurchase(item, {coinType: 2, count: 1}), {success: 'Đã mua thẻ đổi tên.'});
    }, {width: 108, height: 28, disabled: !ui.canMutate() || Number(ui.snapshot.meta?.character?.currency?.golden || 0) < item.silverPrice, testId: `guild-buy-${id}`}));
  }
  row.append(send(ui, 'Đổi tên', data => `Đổi thành “${data.name}” (1 thẻ).`, op, () => ({name: guildName(input.value), ...(teamId ? {teamId} : {})}), {
    skin: 'public.green100', width: 82, height: 28, disabled: !ui.canMutate() || count < 1, testId: `guild-${op}-${teamId || 0}`,
  }));
  host.append(row);
}

export function renderGuildManagement(ui, body, account) {
  if (!account.guild) return;
  const uuid = ui.snapshot.meta?.character?.charUuid || '';
  const p = guildPermissions(account, uuid);
  const g = account.guild;
  const ledTeams = (account.teams || []).filter(t => uuid && t.leaderUuid === uuid);
  const eligibleInvite = (account.teams || []).filter(t => p.inviteTeam(t.teamId));

  const tabs = [];
  if (p.officer || p.leader || ledTeams.length) tabs.push(['general', 'Thông báo & Đội']);
  if (p.officer || eligibleInvite.length) tabs.push(['recruit', 'Tuyển & Mời']);
  if (p.officer) tabs.push(['apps', `Đơn xin (${(account.applications || []).length})`]);
  if (!tabs.length) return;

  const active = tabs.some(([k]) => k === ui.fields.guildManageTab) ? ui.fields.guildManageTab : tabs[0][0];
  ui.fields.guildManageTab = active;

  const wrap = element('div', null, 'm81-guild-manage-wrap');
  const subtabs = element('nav', null, 'm81-guild-subtabs');
  subtabs.setAttribute('aria-label', 'Danh mục quản lý');
  for (const [key, label] of tabs) {
    const btn = flashTabButton(ui, label, key === active, () => {
      ui.fields.guildManageTab = key;
      ui.render();
    }, {width: 132, height: 30, testId: `guild-manage-tab-${key}`});
    btn.setAttribute('aria-pressed', String(key === active));
    subtabs.append(btn);
  }
  if (active === 'apps' && p.officer) {
    const reload = send(ui, 'Tải đơn', 'Làm mới danh sách đơn xin vào Guild.', 'applications', {}, {width: 96, height: 28, testId: 'guild-applications-refresh'});
    reload.style.marginLeft = 'auto';
    subtabs.append(reload);
  }
  wrap.append(subtabs);

  const stage = element('div', null, 'm81-guild-manage-body');
  wrap.append(stage);
  body.append(wrap);

  if (active === 'general') {
    const cols = element('div', null, 'm81-guild-manage-cols');
    const left = element('div', null, 'm81-guild-manage-col');
    const right = element('div', null, 'm81-guild-manage-col');

    if (p.officer) {
      const nHead = element('div', null, 'm81-guild-sec-head');
      nHead.append(element('strong', 'Thông báo Guild'));
      const input = element('textarea', null, 'm81-guild-notice-input');
      input.value = ui.fields['gm-notice'] ?? g.notice ?? '';
      input.maxLength = 1000;
      input.dataset.accountField = 'gm-notice';
      input.addEventListener('input', () => { ui.fields['gm-notice'] = input.value; });
      const saveBtn = send(ui, 'Lưu thông báo', 'Cập nhật thông báo Guild.', 'notice', () => {
        if (new TextEncoder().encode(input.value).length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.value)) {
          throw new Error('Tối đa 1.000 byte UTF-8, không chứa ký tự điều khiển.');
        }
        return {text: input.value};
      }, {skin: 'public.green100', width: 112, height: 28, testId: 'guild-save-notice'});
      nHead.append(saveBtn);
      left.append(nHead, input);
    }

    if (p.leader) renderRenameRow(ui, left, 'Đổi tên Guild', 'rename', 2600006);
    for (const team of ledTeams) renderRenameRow(ui, left, `Đổi tên đội · ${team.name}`, 'renameTeam', 2600003, team.teamId);

    const cap = Number((ui.catalog.guildLevels || []).find(r => r.nLevel === g.level)?.nTeamCount || 0);
    const tHead = element('div', null, 'm81-guild-sec-head');
    tHead.append(element('strong', `Các đội (${(account.teams || []).length}/${cap || '—'})`));
    if (p.officer) {
      tHead.append(flashSpriteButton(ui, 'public.green100', 'Tạo đội', () => ui.openGuildCreation(true), {
        width: 88, height: 28, disabled: !ui.canMutate() || g.coin < 10000 || !cap || account.teams.length >= cap,
        testId: 'guild-create-team', title: 'Cần 10.000 quỹ Guild; tạo đội trừ 1.000 quỹ',
      }));
    }
    right.append(tHead);

    const table = element('table', null, 'm81-guild-table m81-guild-teams-table');
    const thead = element('thead');
    const hRow = element('tr');
    for (const h of ['Đội', 'TV', 'Quỹ', ...(p.officer ? [''] : [])]) hRow.append(element('th', h));
    thead.append(hRow);
    table.append(thead);
    const tbody = element('tbody');
    for (const team of account.teams || []) {
      const tr = element('tr');
      const count = Array.isArray(account.members?.[team.teamId]) ? account.members[team.teamId].length : 0;
      tr.append(element('td', team.name), element('td', numberText(count)), element('td', numberText(team.coin)));
      if (p.officer) {
        const td = element('td');
        td.style.textAlign = 'right';
        td.append(send(ui, 'Giải tán', `Giải tán đội ${team.name}?`, 'dissolveTeam', {teamId: team.teamId}, {
          skin: 'polish.btn2OrangeS', width: 72, height: 24,
          disabled: !ui.canMutate() || account.teams.length <= 1 || !Array.isArray(account.members?.[team.teamId]) || count > 0,
          testId: `guild-dissolve-${team.teamId}`,
        }));
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    right.append(table);

    if (left.children.length) cols.append(left, right);
    else cols.append(right);
    stage.append(cols);
    return;
  }

  if (active === 'recruit') {
    const cols = element('div', null, 'm81-guild-manage-cols');
    if (p.officer) {
      const left = element('div', null, 'm81-guild-manage-col m81-guild-recruit-wrap');
      renderGuildRecruitment(ui, left, account, (u, label, detail, op, values, opts) => {
        return ui.button(label, () => {
          if (!ui.canMutate()) return;
          try {
            const data = typeof values === 'function' ? values() : values;
            ui.confirm(label, typeof detail === 'function' ? detail(data) : detail, () => ui.client.guildAction(op, data), {success: 'Đã cập nhật Guild.', button: label});
          } catch (e) { showError(ui, e); }
        }, {disabled: !ui.canMutate(), ...opts});
      }, recruitmentFlags);
      cols.append(left);
    }
    if (eligibleInvite.length) {
      const right = element('div', null, 'm81-guild-manage-col');
      const head = element('div', null, 'm81-guild-sec-head');
      head.append(element('strong', 'Mời người chơi'));
      right.append(head);
      const team = selectInput(eligibleInvite.map(t => ({value: t.teamId, label: t.name})), ui.fields['gm-invite-team'] || eligibleInvite[0].teamId, 'Đội nhận');
      team.dataset.accountField = 'gm-invite-team';
      team.addEventListener('change', () => { ui.fields['gm-invite-team'] = team.value; });
      const row = element('div', null, 'm81-guild-inline-row');
      row.append(
        team,
        flashSpriteButton(ui, 'public.green100', 'Mời vào Guild', () => ui.openGuildInvite(Number(team.value), 'invite'), {width: 112, height: 28, disabled: !ui.canMutate(), testId: 'guild-invite'}),
        flashSpriteButton(ui, 'public.blueButton', 'Mời chuyển đội', () => ui.openGuildInvite(Number(team.value), 'inviteTeam'), {width: 116, height: 28, disabled: !ui.canMutate(), testId: 'guild-invite-team'}),
      );
      right.append(row);
      cols.append(right);
    }
    stage.append(cols);
    return;
  }

  if (active === 'apps' && p.officer) {
    const appsWrap = element('div', null, 'm81-guild-apps-wrap');
    stage.append(appsWrap);
    const freshApplication = (row, teamId) => {
      const a = ui.snapshot.account || {}, curUuid = ui.snapshot.meta?.character?.charUuid;
      if (!guildPermissions(a, curUuid).officer || !a.applications?.some(x => x.charUuid === row.charUuid)) {
        throw new Error('Quyền hoặc đơn xin đã thay đổi.');
      }
      if (teamId != null && !(a.teams || []).some(t => t.teamId === teamId)) {
        throw new Error('Đội tiếp nhận không còn tồn tại.');
      }
      return a;
    };
    ui.guildApplicationRoot = renderGuildApplications(ui, appsWrap, account, {
      onApprove: (row, teamId) => ui.confirm('Chấp nhận đơn', `Tiếp nhận ${row.name}.`, () => { freshApplication(row, teamId); return ui.client.guildAction('approve', {charUuid: row.charUuid, teamId}); }, {success: 'Đã xử lý đơn xin.'}),
      onReject: row => ui.confirm('Từ chối đơn', `Từ chối ${row.name}.`, () => { freshApplication(row); return ui.client.guildAction('reject', {charUuid: row.charUuid}); }, {success: 'Đã xử lý đơn xin.'}),
      onView: row => { ui.profileIdentity = String(row.accountId || row.charUuid); ui.fields.profileIdentity = ui.profileIdentity; delete ui.cache.profile; ui.setSection('profile'); },
    });
  }
}

export function renderGuildInvitations(ui, account) {
  const uuid = ui.snapshot.meta?.character?.charUuid || '';
  for (const [kind, invite] of [['invitation', account.invitation], ['teamInvitation', account.teamInvitation]]) {
    if (!invite || (kind === 'invitation' ? !!account.guild : !account.guild || invite.charUuid !== uuid || invite.teamId === account.selfTeamId || !(account.teams || []).some(t => t.teamId === invite.teamId))) continue;
    const key = 'gm-dismiss-' + kind, signature = JSON.stringify(invite);
    if (ui.fields[key] === signature) continue;
    const bar = element('div', null, 'm81-guild-invite-bar');
    const text = kind === 'invitation'
      ? `Lời mời vào Guild: ${invite.guildName || ''} · ${invite.teamName || ''}`
      : `Lời mời chuyển sang đội: ${invite.teamName || ''}`;
    bar.append(
      element('span', text),
      send(ui, 'Chấp nhận', kind === 'invitation' ? 'Tham gia Guild theo lời mời.' : 'Chuyển đội (mất một nửa cống hiến hiện tại).',
        kind === 'invitation' ? 'join' : 'acceptTeam',
        kind === 'invitation' ? {guildId: invite.guildId, teamId: invite.teamId} : {teamId: invite.teamId, charUuid: uuid},
        {skin: 'polish.btn2GreenS', width: 86, height: 24, testId: `guild-accept-${kind}`}),
      flashSpriteButton(ui, 'public.blueButton', 'Ẩn', () => {
        ui.fields[key] = signature;
        ui.render();
      }, {width: 54, height: 24, testId: `guild-dismiss-${kind}`}),
    );
    return bar;
  }
  return null;
}
