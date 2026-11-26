/** Twin-stick touch controls for mobile battle play.
 * - Left floating thumbstick: touch anywhere in the bottom-left zone to move.
 * - Right attack pad: hold to auto-aim + fire with gentle lead, drag >= 20px for 360° aimed fire.
 * - Skill wheel (R/E/SP/Q): dynamically mirrors native HUD cells (including P/R and Q/Commander),
 *   with conic cooldown sweep, numeric timer, charge count, tap-cast, drag-aim, and Cancel zone.
 */
import {skillCooldownDuration} from './m7_robo_hud.js';

export class TouchBattleControls {
  constructor({stage, input, onSettings, onModeChange = null}) {
    this.stage = stage;
    this.input = input;
    this.onModeChange = onModeChange;
    const document = stage.ownerDocument;
    const win = document.defaultView;
    this._coarseQuery = win?.matchMedia?.('(pointer: coarse)') || null;
    this._anyCoarseQuery = win?.matchMedia?.('(any-pointer: coarse)') || null;
    this._fineQuery = win?.matchMedia?.('(any-pointer: fine)') || null;
    this._lastInputKind = this._detectInitialInputKind(win);
    this._lastTouchActive = null;

    const root = this.root = document.createElement('div');
    root.className = 'touch-battle-controls';
    root.dataset.touchBattle = '';
    root.hidden = true;
    root.setAttribute('aria-label', 'Điều khiển cảm ứng');

    const button = (kind, text, label) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'touch-battle-' + kind;
      node.textContent = text;
      node.setAttribute('aria-label', label);
      return node;
    };

    const moveZone = document.createElement('div');
    moveZone.className = 'touch-battle-move-zone';
    root.append(moveZone);

    const stick = this.stick = document.createElement('div');
    stick.className = 'touch-battle-stick';
    stick.setAttribute('aria-label', 'Di chuyển');
    const thumb = this.thumb = document.createElement('span');
    stick.append(thumb);
    root.append(stick);

    const actions = document.createElement('div');
    actions.className = 'touch-battle-actions';
    root.append(actions);

    const cancel = this.cancel = document.createElement('div');
    cancel.className = 'touch-battle-cancel';
    cancel.textContent = '✕ Hủy';
    cancel.hidden = true;
    actions.append(cancel);

    // Order matches roboHudSkills index: 0=R/P, 1=E, 2=Space, 3=Q/Commander
    this.skillCells = [];
    this.skillDrags = new Map();
    const cellDefs = [
      {index: 0, defaultSlot: 10, label: 'R', name: 'Kỹ năng R', pos: 'r'},
      {index: 1, defaultSlot: 1,  label: 'E', name: 'Kỹ năng E', pos: 'e'},
      {index: 2, defaultSlot: 2,  label: 'SP', name: 'Kỹ năng Space', pos: 'sp'},
      {index: 3, defaultSlot: 4,  label: 'Q', name: 'Kỹ năng Q', pos: 'q'},
    ];
    for (const def of cellDefs) {
      const skill = button('skill', '', def.name);
      skill.classList.add(`touch-skill-${def.pos}`);
      skill.dataset.touchSkill = String(def.defaultSlot);
      const icon = document.createElement('img');
      icon.className = 'touch-skill-icon';
      icon.alt = '';
      icon.hidden = true;
      const sweep = document.createElement('span');
      sweep.className = 'touch-skill-sweep';
      sweep.hidden = true;
      const keyLabel = document.createElement('span');
      keyLabel.className = 'touch-skill-key';
      keyLabel.textContent = def.label;
      const chargeLabel = document.createElement('span');
      chargeLabel.className = 'touch-skill-charge';
      const cdLabel = document.createElement('span');
      cdLabel.className = 'touch-skill-cd';
      skill.append(icon, sweep, keyLabel, chargeLabel, cdLabel);

      const cell = {
        index: def.index, slot: def.defaultSlot, passive: false, ready: true,
        button: skill, icon, sweep, keyLabel, chargeLabel, cdLabel, iconUrl: '',
      };
      this.skillCells.push(cell);

      const overCancel = (x, y) => {
        if (cancel.hidden) return false;
        const r = cancel.getBoundingClientRect();
        return x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 12 && y <= r.bottom + 12;
      };

      skill.addEventListener('pointerdown', event => {
        if (event.button !== 0 || cell.passive || !cell.ready || this.skillDrags.has(cell.index)) return;
        event.preventDefault();
        this.skillDrags.set(cell.index, {id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false, wasCancel: false});
        skill.classList.add('is-aiming');
        try { skill.setPointerCapture(event.pointerId); } catch {}
      });
      skill.addEventListener('pointermove', event => {
        const drag = this.skillDrags.get(cell.index);
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        const len = Math.hypot(dx, dy);
        if (len >= 16) {
          drag.dragged = true;
          cancel.hidden = false;
          const canceled = overCancel(event.clientX, event.clientY);
          if (canceled && !drag.wasCancel) win?.navigator?.vibrate?.(6);
          drag.wasCancel = canceled;
          cancel.classList.toggle('is-active', canceled);
          const factor = Math.min(1, 22 / len);
          skill.style.transform = `translate(${dx * factor}px, ${dy * factor}px)`;
          if (canceled) input.cancelTouchSkill();
          else input.previewTouchSkill(cell.slot, dx, dy);
        } else if (drag.dragged) {
          drag.dragged = false;
          drag.wasCancel = false;
          cancel.hidden = true;
          cancel.classList.remove('is-active');
          skill.style.transform = '';
          input.cancelTouchSkill();
        }
      });
      const finishSkill = (event, canceled = false) => {
        const drag = this.skillDrags.get(cell.index);
        if (!drag || drag.id !== event.pointerId) return;
        this.skillDrags.delete(cell.index);
        const dropCancel = canceled || overCancel(event.clientX, event.clientY);
        skill.classList.remove('is-aiming');
        skill.style.transform = '';
        if (!this.skillDrags.size) {
          cancel.hidden = true;
          cancel.classList.remove('is-active');
        }
        if (dropCancel) {
          input.cancelTouchSkill();
          return;
        }
        win?.navigator?.vibrate?.(8);
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (drag.dragged && Math.hypot(dx, dy) >= 16) input.castTouchSkill(cell.slot, dx, dy);
        else input.castTouchSkill(cell.slot);
      };
      skill.addEventListener('pointerup', event => finishSkill(event, false));
      for (const type of ['pointercancel', 'lostpointercapture']) {
        skill.addEventListener(type, event => finishSkill(event, true));
      }
      skill.addEventListener('click', event => {
        if (event.detail === 0 && !cell.passive) input.castTouchSkill(cell.slot);
      });
      actions.append(skill);
    }

    const fire = this.fire = button('fire', '', 'Chạm hoặc giữ để bắn tự động; kéo để ngắm');
    const fireThumb = this.fireThumb = document.createElement('span');
    fireThumb.className = 'touch-battle-fire-thumb';
    fireThumb.textContent = 'Bắn';
    fire.append(fireThumb);
    actions.append(fire);

    const settings = button('settings', '☰', 'Cài đặt trận đấu');
    settings.addEventListener('click', onSettings);
    root.append(settings);
    stage.append(root);
    input.touchControls = root;
    input.onTouchReset = () => this.reset();

    const applyStickOffset = drag => {
      stick.style.transform = drag.baseDx || drag.baseDy
        ? `translate(${drag.baseDx}px, ${drag.baseDy}px)` : '';
    };
    const clampOrigin = (x, y, maxRadius) => {
      const stageRect = stage.getBoundingClientRect();
      const pad = Math.max(24, maxRadius * 0.75);
      return [
        Math.max(stageRect.left + pad, Math.min(stageRect.left + stageRect.width * 0.44 - pad, x)),
        Math.max(stageRect.top + 60, Math.min(stageRect.bottom - pad, y)),
      ];
    };
    const startMove = (event, target, floating) => {
      if (this.drag || event.button !== 0) return;
      event.preventDefault();
      const rect = stick.getBoundingClientRect();
      const maxRadius = Math.max(32, Math.round((rect.width || 100) * 0.42));
      const homeX = rect.left + rect.width / 2;
      const homeY = rect.top + rect.height / 2;
      const [ox, oy] = floating ? clampOrigin(event.clientX, event.clientY, maxRadius) : [homeX, homeY];
      this.drag = {
        id: event.pointerId, target, maxRadius,
        thumbTravel: Math.max(22, Math.round((rect.width || 100) * 0.3)),
        x: ox, y: oy, homeX, homeY, baseDx: ox - homeX, baseDy: oy - homeY,
      };
      stick.classList.add('is-held');
      applyStickOffset(this.drag);
      try { target.setPointerCapture(event.pointerId); } catch {}
    };
    const move = event => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.id) return;
      let dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      let length = Math.hypot(dx, dy);
      if (length > drag.maxRadius) {
        const excess = length - drag.maxRadius;
        const ux = dx / length, uy = dy / length;
        const [ox, oy] = clampOrigin(drag.x + ux * excess, drag.y + uy * excess, drag.maxRadius);
        drag.x = ox;
        drag.y = oy;
        drag.baseDx = drag.x - drag.homeX;
        drag.baseDy = drag.y - drag.homeY;
        applyStickOffset(drag);
        dx = event.clientX - drag.x;
        dy = event.clientY - drag.y;
        length = Math.hypot(dx, dy);
      }
      const factor = length ? Math.min(1, drag.thumbTravel / length) : 1;
      thumb.style.transform = `translate(${dx * factor}px, ${dy * factor}px)`;
      const horizontal = Math.abs(dx) > length * .4 ? dx > 0 ? 1 : 2 : 0;
      const vertical = Math.abs(dy) > length * .4 ? dy > 0 ? 4 : 8 : 0;
      const axis = length >= 7 ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y') : null;
      input.setTouchMovement(length >= 7 ? horizontal | vertical : 0, axis);
    };
    const stopMove = event => {
      if (this.drag?.id !== event.pointerId) return;
      this.drag = null;
      stick.classList.remove('is-held');
      stick.style.transform = '';
      thumb.style.transform = '';
      input.setTouchMovement(0, null);
    };

    stick.addEventListener('pointerdown', event => startMove(event, stick, false));
    moveZone.addEventListener('pointerdown', event => startMove(event, moveZone, true));
    for (const target of [stick, moveZone]) {
      target.addEventListener('pointermove', move);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        target.addEventListener(type, stopMove);
      }
    }

    fire.addEventListener('pointerdown', event => {
      if (this.fireDrag || event.button !== 0) return;
      event.preventDefault();
      this.fireDrag = {id: event.pointerId, x: event.clientX, y: event.clientY, manual: false};
      try { fire.setPointerCapture(event.pointerId); } catch {}
      const active = input.setTouchFire(true);
      if (active) win?.navigator?.vibrate?.(6);
      fire.classList.toggle('is-held', active);
    });
    fire.addEventListener('pointermove', event => {
      const drag = this.fireDrag;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      const length = Math.hypot(dx, dy);
      const manual = length >= 20;
      const factor = length ? Math.min(1, 24 / length) : 1;
      fireThumb.style.transform = length >= 8 ? `translate(${dx * factor}px, ${dy * factor}px)` : '';
      fire.classList.toggle('is-manual-aim', manual);
      if (manual) {
        drag.manual = true;
        input.setTouchAimVector(dx, dy);
      } else if (drag.manual) {
        drag.manual = false;
        input.setTouchAutoAim(true);
      }
    });
    fire.addEventListener('click', event => {
      if (event.detail === 0) input.cast(0);
    });
    const stopFire = event => {
      if (this.fireDrag?.id !== event.pointerId) return;
      this.fireDrag = null;
      fireThumb.style.transform = '';
      fire.classList.remove('is-held', 'is-manual-aim');
      input.setTouchFire(false);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      fire.addEventListener(type, stopFire);
    }

    // Reactive hybrid input detection: switch automatically between touch and mouse+keyboard.
    const notifyIfChanged = () => {
      const next = this.isTouchViewport();
      this.syncBodyFlag(next);
      if (next !== this._lastTouchActive) {
        this._lastTouchActive = next;
        this.onModeChange?.(next);
      }
    };
    this._onGlobalPointerDown = event => {
      if (event.pointerType === 'touch') {
        this._lastInputKind = 'touch';
        notifyIfChanged();
      } else if (event.pointerType === 'mouse' && !event.target?.closest?.('[data-touch-battle]')) {
        this._lastInputKind = 'mouse';
        notifyIfChanged();
      }
    };
    this._onGlobalKeyDown = event => {
      if (this._fineQuery?.matches && /^(Key[WASDER]|Space|Arrow(Up|Down|Left|Right))$/.test(event.code || '')) {
        this._lastInputKind = 'mouse';
        notifyIfChanged();
      }
    };
    this._onMediaChange = () => notifyIfChanged();
    this._win = win;
    win?.addEventListener('pointerdown', this._onGlobalPointerDown, true);
    win?.addEventListener('keydown', this._onGlobalKeyDown, true);
    this._coarseQuery?.addEventListener?.('change', this._onMediaChange);
    this._anyCoarseQuery?.addEventListener?.('change', this._onMediaChange);
    this._fineQuery?.addEventListener?.('change', this._onMediaChange);
    this._lastTouchActive = this.isTouchViewport();
    this.syncBodyFlag(this._lastTouchActive);
  }

  dispose() {
    this._win?.removeEventListener('pointerdown', this._onGlobalPointerDown, true);
    this._win?.removeEventListener('keydown', this._onGlobalKeyDown, true);
    this._coarseQuery?.removeEventListener?.('change', this._onMediaChange);
    this._anyCoarseQuery?.removeEventListener?.('change', this._onMediaChange);
    this._fineQuery?.removeEventListener?.('change', this._onMediaChange);
  }

  _detectInitialInputKind(win) {
    if (this._coarseQuery?.matches) return 'touch';
    const hasTouch = (win?.navigator?.maxTouchPoints || 0) > 0 || ('ontouchstart' in (win || {}));
    if (hasTouch && !this._fineQuery?.matches) return 'touch';
    if (this._anyCoarseQuery?.matches && (win?.innerWidth || 0) <= 1024) return 'touch';
    return 'mouse';
  }

  syncBodyFlag(active = this.isTouchViewport()) {
    const body = this.stage?.ownerDocument?.body;
    if (body) body.dataset.touchActive = active ? 'true' : 'false';
  }

  isTouchViewport() {
    const win = this.stage?.ownerDocument?.defaultView;
    const primaryCoarse = !!this._coarseQuery?.matches;
    const anyCoarse = !!this._anyCoarseQuery?.matches;
    const anyFine = !!this._fineQuery?.matches;
    const hasTouch = (win?.navigator?.maxTouchPoints || 0) > 0 || ('ontouchstart' in (win || {}));
    if (!primaryCoarse && !anyCoarse && !hasTouch) return false;
    if (primaryCoarse && !anyFine) return true;
    return this._lastInputKind === 'touch' && (anyCoarse || primaryCoarse || hasTouch);
  }

  syncSkills(rows) {
    if (this.root.hidden || !Array.isArray(rows)) return;
    for (const cell of this.skillCells) {
      const row = rows[cell.index];
      if (!row) continue;
      cell.slot = row.slot;
      cell.passive = !!row.passive;
      const {button, icon, sweep, keyLabel, chargeLabel, cdLabel} = cell;
      button.dataset.touchSkill = String(row.slot);
      // Hide Q when unequipped/locked so no empty blank circle clutters the wheel
      button.hidden = cell.index === 3 && !!row.locked;
      keyLabel.textContent = row.key === 'Space' ? 'SP' : row.key;
      const url = row.icon?.url || '';
      if (cell.iconUrl !== url) {
        cell.iconUrl = url;
        if (url) { icon.src = url; icon.hidden = false; }
        else { icon.removeAttribute('src'); icon.hidden = true; }
      }
      const ready = !!row.availability?.ready && !row.passive;
      cell.ready = ready;
      const reason = row.availability?.reason;
      const indefinite = !!row.skill?.indefinite;
      const rem = indefinite ? 0 : (Number(row.skill?.remainingMs) || 0);
      const onCooldown = !ready && !row.passive && (reason === 'cooldown' || (!row.availability?.cooldownIgnored && (indefinite || rem > 0)));
      button.classList.toggle('is-ready', ready);
      button.classList.toggle('is-passive', !!row.passive);
      button.classList.toggle('is-locked', !!row.locked);
      button.classList.toggle('is-cooldown', onCooldown);
      button.classList.toggle('is-low-mp', !ready && reason === 'mp');

      const duration = skillCooldownDuration(cell, row, rem);
      const fraction = (row.availability?.cooldownIgnored && ready) || indefinite ? 0 : Math.max(0, Math.min(1, rem / duration));
      sweep.hidden = !(fraction > 0);
      if (fraction > 0) sweep.style.setProperty('--cd-angle', `${fraction * 360}deg`);
      cdLabel.textContent = row.cooldownText || '';
      chargeLabel.textContent = row.skill?.count > 0 ? `x${row.skill.count}` : '';
    }
  }

  reset() {
    this.drag = null;
    this.fireDrag = null;
    this.skillDrags.clear();
    this.stick.classList.remove('is-held');
    this.stick.style.transform = '';
    this.thumb.style.transform = '';
    this.fireThumb.style.transform = '';
    this.fire.classList.remove('is-held', 'is-manual-aim');
    this.cancel.hidden = true;
    this.cancel.classList.remove('is-active');
    for (const {button} of this.skillCells) {
      button.classList.remove('is-aiming');
      button.style.transform = '';
    }
  }

  update(visible) {
    if (this.root.hidden === !visible) return;
    this.root.hidden = !visible;
    if (!visible) {
      this.input.setTouchMovement(0);
      this.input.setTouchFire(false);
      this.reset();
    }
  }
}
