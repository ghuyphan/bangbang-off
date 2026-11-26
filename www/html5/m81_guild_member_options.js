/* Native Flash Box3 member action menu. Host supplies freshly validated actions. */
import {element, flashAssets, flashSpriteButton, flashCloseButton} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';

export function renderGuildMemberOptions(ui, value, model) {
  const overlay = element('div', null, 'm8-account-modal');
  const assets = flashAssets(ui);
  const generation = ui.client?.generation, identity = ui.identity;
  const current = () => !ui.disposed && ui.confirmation === value && ui.epoch === value.epoch && ui.client?.generation === generation && ui.identity === identity;
  const close = () => { if (current() && !ui.pending) { ui.confirmation = null; ui.render(); } };

  const actions = model?.actions || [];
  const height = Math.min(340, 86 + actions.length * 36);
  const panel = createNativePanel({assets, kind: 'box3', state: 'DARK_BG', width: 244, height});
  panel.root.setAttribute('role', 'dialog');
  panel.root.setAttribute('aria-modal', 'true');
  panel.root.setAttribute('aria-label', 'Thành viên Guild');
  panel.root.dataset.nativeScreen = 'guild-member-options';

  const menu = element('div', null, 'm81-guild-member-menu');
  const head = element('div', null, 'm81-guild-member-menu-head');
  const name = element('strong', model?.name || 'Thành viên không còn trong Guild.');
  const cancel = flashCloseButton(ui, close, {label: 'Đóng', testId: 'account-confirm-cancel'});
  cancel.disabled = !!ui.pending;
  cancel.dataset.accountField = `member-option-close-${value.memberUuid}`;
  head.append(name, cancel);
  menu.append(head);

  const list = element('div', null, 'm81-guild-member-menu-actions');
  const nodes = [];
  for (const action of actions) {
    const skin = action.id.startsWith('guild-remove-') ? 'public.red120' : 'public.blueButton';
    const button = flashSpriteButton(ui, skin, action.label, () => {
      if (current() && !ui.pending) action.run();
    }, {width: 212, height: 30, disabled: !!action.disabled, testId: action.id});
    button.dataset.accountField = `member-option-${value.memberUuid}-${action.id}`;
    list.append(button);
    nodes.push(button);
  }
  nodes.push(cancel);
  menu.append(list);
  panel.content.append(menu);

  overlay.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const available = nodes.filter(n => !n.disabled);
      if (!available.length) return;
      const i = available.indexOf(document.activeElement);
      available[(i + (e.shiftKey ? -1 : 1) + available.length) % available.length].focus();
    }
  });
  overlay.append(panel.root);
  overlay.initialFocus = nodes.find(n => !n.disabled) || cancel;
  return overlay;
}
