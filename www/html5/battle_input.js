import {nativeEventKey,nativeInputOptions,INPUT_ACTION_SLOTS} from './m81_input_options.js';
import {cooldownView, nativeControlFlags, visualPosition} from './combat_state.js';
import {selectionMode, SELECT, KNOWN_SELECT_MASK, AI_NPC_SHADOW, AI_NPC_TANK,
  nativeTemplateId, isNativeCopyTarget, canCastOnSelf, castPolicy, targetBuffsAllowed,
  cannonAngleTo, turnCannon, projectChannelAim} from './m6_control_contract.js';

// Source: EightDirectionManager.initDirEmum; opposite directions are NONE.
const DIRECTIONS = Object.freeze({1: 3, 2: 7, 4: 5, 5: 4, 6: 6, 8: 1, 9: 2, 10: 0});
const MOVEMENT = Object.freeze({KeyD: 1, ArrowRight: 1, KeyA: 2, ArrowLeft: 2,
  KeyS: 4, ArrowDown: 4, KeyW: 8, ArrowUp: 8});
const ALLOWED_SLOTS = new Set([0, 1, 2, 4, 10]);
const NPC_OBJECT_TYPE = 3; // ShareTypes.GAME_OBJECT_TYPE.ZUOBJ_NPC (turrets, bases, destructibles)
const AI_NPC_OBJECT_TYPE = 5; // GAME_OBJECT_TYPE.ZUOBJ_AINPC; not a template ID.
const DECORATION_NPC_TYPES = new Set([51, 52, 53]);
const RANGE_FEEDBACK_MS = 900;
const IMMUNE_BUFFS = new Set([511202, 330132, 303136, 386312, 312111, 320101, 326341, 338103,
  348202, 353121, 371111, 336108, 336507, 336301, 336311, 344103]);
const PROJECTILE_GUARDS = new Set([332206, 386111, 351401, 323401, 382121, 334212, 341401, 318402]);

function keyCode(event) {
  if (event.code) return event.code;
  const key = String(event.key ?? '');
  return key === ' ' ? 'Space' : /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key;
}

function editable(target) {
  return Boolean(target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')
    || target?.closest?.('[contenteditable="true"], [role="textbox"]'));
}

function validPoint(point, geometry) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.y >= 0 && point.x <= geometry.width && point.y <= geometry.height;
}

function clampPoint(point, geometry) {
  return {
    x: Math.max(0, Math.min(geometry.width, point.x)),
    y: Math.max(0, Math.min(geometry.height, point.y)),
  };
}

const AIM_ASSIST_STORAGE_KEY = 'bb_mobile_aim_assist';

function loadAimAssistPreference() {
  try { return globalThis.localStorage?.getItem(AIM_ASSIST_STORAGE_KEY) !== '0'; }
  catch { return true; }
}

function saveAimAssistPreference(enabled) {
  try { globalThis.localStorage?.setItem(AIM_ASSIST_STORAGE_KEY, enabled ? '1' : '0'); }
  catch {}
}

const DIR_VECTORS = Object.freeze({
  0: [0, -1], 1: [0, -1], 2: [Math.SQRT1_2, -Math.SQRT1_2], 3: [1, 0],
  4: [Math.SQRT1_2, Math.SQRT1_2], 5: [0, 1], 6: [-Math.SQRT1_2, Math.SQRT1_2],
  7: [-1, 0], 8: [0, 0],
});

/** Native collision point casts must start outside the tank's 72px body.
 * ActiveObjectLayer.getNeedPointFireStruct uses CMath.getRadian = atan2(dy,dx).
 * In particular a coincident pointer gives angle 0, hence an eastward 60px ray.
 * Only the wire destination changes; the user's world pointer stays unchanged.
 */
export function basicFireDestination(position, aim, skill) {
  if (!(Number(skill.fCondition) & 1) || Math.abs(aim.x - position.x) > 36
      || Math.abs(aim.y - position.y) > 36) return {...aim};
  const angle = Math.atan2(aim.y - position.y, aim.x - position.x);
  return {x: position.x + Math.cos(angle) * 60, y: position.y + Math.sin(angle) * 60};
}

/** Browser input only. It never decides damage, hits, skill replacement, cost,
 * charges or a server acceptance. Local basic-request spacing is separate from
 * the authoritative S1564 fireReadyAt and S1572/S1579 cooldown data.
 *
 * E/Space/R use the native intelligent-cast path. Source automatic selection
 * modes send target0/(0,0), leaving all target decisions to the server.
 * Actual slot metadata drives borrowed skills, forms and multistage recasts.
 */
export class BattleInput {
  constructor({canvas, client, worldPoint, getGeometry, getTarget = null,
    onMessage = () => {}, now = () => performance.now()}) {
    if (!canvas?.addEventListener || !client || typeof worldPoint !== 'function'
        || typeof getGeometry !== 'function') throw new TypeError('Battle input requires a canvas, client and geometry');
    this.canvas = canvas; this.client = client; this.worldPoint = worldPoint;
    this.getGeometry = getGeometry; this.getTarget = getTarget;
    this.onMessage = onMessage; this.now = now;
    this.document = canvas.ownerDocument ?? globalThis.document;
    this.window = this.document?.defaultView ?? globalThis.window;
    this.active = false; this.aim = null; this.pointerClient = null; this.lastMapAim = null;
    this.targetId = 0; this.heldFire = false; this.autoFire = false; this.autoKey = null;
    this.keys = new Set(); this.listeners = []; this.destroyed = false;
    this.touchMask = 0; this.touchPreferredAxis = null; this.touchFire = false; this.touchAimVector = null; this.touchAutoAim = false;
    this.touchSkillSlot = 0;
    this.aimAssist = loadAimAssistPreference(); this.assistedTarget = null;
    this.context = null; this.lastBasicRequestAt = null; this.lastAction = null;
    this.channel = null; this.selectedSlot=0; this.selectedEntry=null; this.fireKey=null; this.inputOptions=null;
    this.lastReason = null; this.pointerId = null;
    this.portraitAccountId = null;
    this.hoveredSkill = null; this.rangeFeedback = null;
    if (typeof canvas.tabIndex === 'number' && canvas.tabIndex < 0) canvas.tabIndex = 0;
    this.listen(canvas, 'pointerdown', event => {if(event.pointerType!=='mouse')this.pointerDown(event);});
    // Mouse edges must include secondary buttons while another remains held.
    // Pointer events report only the first/last transition for mouse chords.
    this.listen(canvas,'mousedown',event=>this.pointerDown(event));
    this.listen(canvas, 'pointermove', event => this.pointerMove(event));
    this.listen(canvas,'contextmenu',event=>{if(this.active&&(this.inputOptions?.byKey.get(1001)===1001||Object.hasOwn(INPUT_ACTION_SLOTS,this.inputOptions?.byKey.get(1001))))event.preventDefault?.();});
    this.listen(canvas, 'blur', () => this.releaseAll('focus'));
    this.listen(canvas, 'lostpointercapture', () => {
      if (this.heldFire) this.releaseAll('pointer');
    });
    this.listen(this.window, 'pointermove', event => {
      if (this.active && event.target !== this.canvas && !event.target?.closest?.('[data-touch-battle]')) this.pointerMove(event);
    });
    this.listen(this.window,'mouseup',event=>{
      this.finishAutoToggle(event);
      if(nativeEventKey(event)===this.fireKey){this.heldFire=false;this.fireKey=null;this.pointerId=null;}
    });
    this.listen(this.window, 'pointerup', event => {
      if(event.pointerType==='mouse')return;
      if (event.pointerId === this.pointerId) {
        this.heldFire = false; this.pointerId = null; this.fireKey=null;
      }
    });
    this.listen(this.window, 'pointercancel', event => {
      if (!event.target?.closest?.('[data-touch-battle]')) this.releaseAll('pointer');
    });
    this.listen(this.window, 'pointerdown', event => {
      if (this.active && event.target && event.target !== canvas && !canvas.contains?.(event.target)
          && !event.target?.closest?.('[data-touch-battle]')) {
        this.releaseAll('focus');
      }
    });
    this.listen(this.window, 'keydown', event => this.keyDown(event));
    this.listen(this.window, 'keyup', event => this.keyUp(event));
    this.listen(this.window, 'blur', () => this.releaseAll('focus'));
    this.listen(this.document, 'visibilitychange', () => {
      if (this.document.hidden || this.document.visibilityState === 'hidden') this.releaseAll('hidden');
    });
  }

  listen(target, type, listener) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener);
    this.listeners.push([target, type, listener]);
  }

  current(now) {
    if (this.destroyed || !Number.isFinite(now)) return null;
    const options=nativeInputOptions(this.client.state?.meta?.settings);
    if(this.inputOptions&&this.inputOptions.signature!==options.signature)this.releaseAll('settings');
    this.inputOptions=options;
    const state = this.client.combat;
    const self = state?.actors?.[String(state.selfObjectId)];
    const identity = {state, generation: this.client.generation, objectId: self?.objectId,
      lifeEpoch: self?.lifeEpoch};
    if (!this.context || Object.keys(identity).some(key => identity[key] !== this.context[key])) {
      this.releaseAll('session');
      this.aim = null; this.pointerClient = null; this.lastMapAim = null;
      this.lastBasicRequestAt = null; this.lastAction = null;
      this.channel = null;
      this.context = identity;
    }
    if (!this.client.canControl() || !self || self.dead || self.removed || self.hp <= 0 || state.result) {
      this.releaseAll('unavailable');
      return null;
    }
    const geometry = this.getGeometry();
    if (!geometry || !(geometry.width > 0) || !(geometry.height > 0)
        || typeof geometry.visibleToSelf !== 'function') {
      this.hoveredSkill = null; this.rangeFeedback = null; return null;
    }
    // Presentation follows the accepted slot, including copies and recasts.
    // It cannot survive another skill, actor life, session or expired warning.
    for (const name of ['hoveredSkill', 'rangeFeedback']) {
      const preview = this[name];
      const entry = preview && state.skills?.[String(self.objectId)]?.[String(preview.slot)];
      if (preview && (!entry || entry.skillId !== preview.skillId
          || !geometry.skillCatalog?.[String(entry.skillId)])) this[name] = null;
    }
    if (this.rangeFeedback && now >= this.rangeFeedback.expiresAt) this.rangeFeedback = null;
    if(this.selectedSlot) {
      const entry=state.skills?.[String(self.objectId)]?.[String(this.selectedSlot)];
      const cooldown=cooldownView(state,self.objectId,this.selectedSlot,now);
      if(!entry||entry.skillId!==this.selectedEntry?.skillId||cooldown?.remainingMs>0){this.selectedSlot=0;this.selectedEntry=null;}
    }
    return {state, self, geometry};
  }

  activate(now = this.now()) {
    if (!this.current(now)) return false;
    this.active = true; this.lastReason = null;
    this.canvas.focus?.({preventScroll: true});
    return true;
  }

  releaseAll(reason = 'released') {
    this.keys.clear(); this.heldFire = false; this.pointerId = null; this.fireKey=null;
    if (this.touchMask || this.touchFire || this.touchAimVector || this.touchAutoAim) this.onTouchReset?.();
    this.touchMask = 0; this.touchPreferredAxis = null; this.touchFire = false; this.touchAimVector = null; this.touchAutoAim = false;
    this.touchSkillSlot = 0;
    this.assistedTarget = null;
    this.stickyTargetId = 0; this.stickyTargetUntil = 0;
    this.selectedSlot=0;this.selectedEntry=null;
    this.targetId = 0; this.active = false; this.lastReason = reason;
    this.portraitAccountId = null;
    this.hoveredSkill = null; this.rangeFeedback = null;
    this.autoKey=null;
    if(['session','destroyed','escape','settings'].includes(reason))this.autoFire=false;
    if (this.channel) this.channel.suspended = true;
  }

  pointerMove(event) {
    const now = this.now(), current = this.current(now);
    if (!current) { this.aim = null; return; }
    this.pointerClient = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      ? {x: event.clientX, y: event.clientY} : null;
    this.projectAim(current);
    this.refreshTarget(current, now);
  }

  projectAim(current) {
    // Native BattleTool.getBattleMapMousePoint is sampled for each held fire.
    // The screen pointer may be stationary while camera movement/zoom changes
    // its world coordinate. BattleView updates camera before tick().
    const now = this.now();
    if (this.touchAimVector && current) {
      const slot = this.touchSkillSlot || 0;
      const ballistics = this.skillBallistics(current, slot);
      const from = visualPosition(current.self, now);
      const range = this.touchAimVector.range || ballistics.range || 480;
      const searchRange = ballistics.rangeLimit ? ballistics.range + 24 : Math.min(920, Math.max(range + 100, ballistics.range + 80));
      const coneDeg = ballistics.range >= 600 ? 20 : 18;
      const assist = this.aimAssist
        ? this.assistedConeTarget(current, now, this.touchAimVector.dx, this.touchAimVector.dy, searchRange, coneDeg, slot, from, ballistics)
        : null;
      let aim = assist
        ? this.predictTargetPoint(assist.target, from, current, slot, now, ballistics)
        : clampPoint({x: from.x + this.touchAimVector.dx * range, y: from.y + this.touchAimVector.dy * range}, current.geometry);
      if (ballistics.rangeLimit && ballistics.range > 12) {
        aim = this.clampToRange(from, aim, ballistics.range - 4, current.geometry);
      }
      this.aim = aim; this.lastMapAim = {...aim};
      this.assistedTarget = assist
        ? {objectId: assist.target.objectId, x: aim.x, y: aim.y, locked: true, passive: false,
           rawX: assist.pos.x, rawY: assist.pos.y}
        : {objectId: 0, x: aim.x, y: aim.y, locked: false, passive: false};
      return;
    }
    if ((this.touchAutoAim || (this.channel && this.touchControls && !this.touchControls.hidden && !this.pointerClient)) && current) {
      const ballistics = this.skillBallistics(current, 0);
      const from = visualPosition(current.self, now);
      const searchRange = Math.min(950, Math.max(ballistics.range + 160, 520));
      const hit = this.aimAssist
        ? this.bestTouchEnemyTarget(current, now, searchRange, 0, from, ballistics)
        : null;
      const aim = hit
        ? this.predictTargetPoint(hit.target, from, current, 0, now, ballistics)
        : this.nearestAutoAim(current, now, searchRange, 0, true, from, ballistics);
      if (aim) {
        this.aim = aim; this.lastMapAim = {...aim};
        this.assistedTarget = hit
          ? {objectId: hit.target.objectId, x: aim.x, y: aim.y, locked: true, passive: false,
             rawX: hit.pos.x, rawY: hit.pos.y}
          : null;
        return;
      }
    }
    const pointer = this.pointerClient;
    const rect = this.canvas.getBoundingClientRect?.();
    if (this.portraitAccountId != null || !pointer || (rect && (pointer.x < rect.left || pointer.y < rect.top
          || pointer.x > rect.right || pointer.y > rect.bottom))) {
      this.aim = null; this.targetId = 0;
      this.refreshPassiveTouchTarget(current, now);
      return;
    }
    const rawAim = this.worldPoint(pointer.x, pointer.y);
    if (!validPoint(rawAim, current.geometry)) {
      this.aim = null;
      this.refreshPassiveTouchTarget(current, now);
      return;
    }
    if (this.touchPointerSnap && this.aimAssist) {
      const snapped = this.nearestPointTarget(current, now, rawAim, 85);
      if (snapped) {
        const from = visualPosition(current.self, now);
        this.aim = this.predictTargetPoint(snapped.target, from, current, 0, now);
        this.lastMapAim = {...this.aim};
        this.assistedTarget = {objectId: snapped.target.objectId, x: this.aim.x, y: this.aim.y,
          locked: true, passive: false, rawX: snapped.pos.x, rawY: snapped.pos.y};
        return;
      }
    }
    this.aim = {x: rawAim.x, y: rawAim.y};
    this.lastMapAim = {...this.aim};
    this.refreshPassiveTouchTarget(current, now);
  }

  pointerDown(event) {
    if (![0,2].includes(event.button) || event.ctrlKey || event.metaKey || event.altKey) return;
    const now = this.now();
    if (!this.activate(now)) return;
    if (event.pointerType === 'touch') {
      this.touchAimVector = null; this.touchAutoAim = false; this.touchPointerSnap = true;
    } else {
      this.touchPointerSnap = false;
    }
    this.pointerMove(event);
    if (event.pointerType === 'touch' && this.touchControls && !this.touchControls.hidden) {
      event.preventDefault();
      if (this.selectedSlot) this.primaryCast(now);
      return;
    }
    const key=nativeEventKey(event),action=this.inputOptions.byKey.get(key);
    if(action===1001){event.preventDefault?.();this.autoKey=key;return;}
    if(!Object.hasOwn(INPUT_ACTION_SLOTS,action))return;
    event.preventDefault?.();
    if(action!==1000){this.selectOrCast(INPUT_ACTION_SLOTS[action],now,!!event.shiftKey);return;}
    if (!this.aim) return;
    this.heldFire = true; this.fireKey=key; this.pointerId = event.pointerId ?? null;
    try { if (this.pointerId != null) this.canvas.setPointerCapture?.(this.pointerId); } catch { /* Detached pointer. */ }
    this.primaryCast(now);
  }

  primaryCast(now, project = true) {
    const selected=this.selectedSlot;
    if(this.sendCast(selected,now,true,null,false,project))return true;
    // ActiveObjectLayer.needTgttFireFail: normal selection falls back to
    // ordinary point fire on missing target/out-of-range. Smartcast never does.
    if(selected&&!this.inputOptions.quickcast.has(selected)&&['target','range'].includes(this.lastReason)) {
      const current=this.current(now),entry=current?.state.skills?.[String(current.self.objectId)]?.['0'];
      const skill=current?.geometry.skillCatalog?.[String(entry?.skillId)];
      if(skill&&selectionMode(skill,entry.skillId)!=='selected')return this.sendCast(0,now,true,null,false,project);
    }
    return false;
  }

  selectOrCast(slot,now,selfCast=false,buttonAim=null) {
    const current=this.current(now),result=this.resolveCast(slot,now,current);
    if(!result.ready)return this.reject(result.reason,result.message,false);
    if(selfCast&&result.mode==='selected'&&canCastOnSelf(result.skill)
        || !['point','selected'].includes(result.mode))return this.sendCast(slot,now,false,buttonAim,selfCast);
    if(this.inputOptions.quickcast.has(slot)) {
      const portrait = !selfCast && slot === 1 && this.portraitAccountId != null
        && this.portraitCopyAvailability(this.portraitAccountId, now).copy;
      const sent=portrait ? this.sendPortraitCopy(this.portraitAccountId, now)
        : this.sendCast(slot,now,false,buttonAim,selfCast);
      this.selectedSlot=0;this.selectedEntry=null;return sent;
    }
    this.selectedSlot=this.selectedSlot===slot?0:slot;
    this.selectedEntry=this.selectedSlot?result.entry:null;
    return true;
  }

  keyDown(event) {
    const code = keyCode(event);
    if (code === 'Escape') { this.hoveredSkill = null; this.rangeFeedback = null; }
    if (code === 'Escape' && this.active) {
      event.preventDefault?.(); this.releaseAll('escape'); return;
    }
    const current = this.current(this.now());
    if (!this.active || !current || editable(event.target)
        || event.ctrlKey || event.metaKey || event.altKey) return;
    const nativeKey=nativeEventKey(event),action=this.inputOptions.byKey.get(nativeKey);
    if (!(code in MOVEMENT) && action!==1001 && !Object.hasOwn(INPUT_ACTION_SLOTS,action)) return;
    event.preventDefault?.();
    if (event.repeat || this.keys.has(code)) return;
    this.keys.add(code);
    if(action===1001)this.autoKey=nativeKey;
    else if(action===1000){this.heldFire=true;this.fireKey=nativeKey;this.primaryCast(this.now());}
    else if(Object.hasOwn(INPUT_ACTION_SLOTS,action))this.selectOrCast(INPUT_ACTION_SLOTS[action],this.now(),!!event.shiftKey);
  }

  keyUp(event) {
    const code = keyCode(event);
    this.finishAutoToggle(event);
    if(nativeEventKey(event)===this.fireKey){this.heldFire=false;this.fireKey=null;}
    if (this.keys.delete(code) && this.active) event.preventDefault?.();
  }

  finishAutoToggle(event) {
    if(this.autoKey==null||nativeEventKey(event)!==this.autoKey)return;
    this.autoKey=null;
    if(!this.active||!this.current(this.now()))return;
    this.autoFire=!this.autoFire;
    event.preventDefault?.();
    this.onMessage(this.autoFire?'Đã bật bắn thường tự động.':'Đã tắt bắn thường tự động.');
  }

  setTouchMovement(mask, preferredAxis = null) {
    const active = Boolean(mask && this.activate());
    this.touchMask = active ? mask : 0;
    this.touchPreferredAxis = active ? preferredAxis : null;
  }

  setAimAssist(enabled) {
    this.aimAssist = !!enabled;
    saveAimAssistPreference(this.aimAssist);
    if (!this.aimAssist) this.assistedTarget = null;
    return this.aimAssist;
  }

  npcTargetMetadata(object, current) {
    const objType = object.objectId >>> 26;
    if (objType === AI_NPC_OBJECT_TYPE) {
      return {objType, isTank: false, isTurret: false, isStructure: false, isNeutralObstacle: false, halfExtent: 26};
    }
    if (objType !== NPC_OBJECT_TYPE) return null;
    const raw = this.client.sceneAssets?.catalog?.mapNPCs?.[String(object.templateId)]?.raw;
    const type = Number(current.geometry.npcType?.(object) ?? raw?.iType ?? 0);
    if (DECORATION_NPC_TYPES.has(type) || !(Number(object.maxHp) > 0)) return null;
    const rect = current.geometry.npcRectangle?.(object);
    const halfExtent = rect ? Math.max(16, Math.min(72, Math.min(rect.width, rect.height) * 0.45)) : 28;
    const isNeutralObstacle = Number(object.camp) === 0;
    const isTurret = !isNeutralObstacle && type === 4;
    return {objType, isTank: false, isTurret, isStructure: !isNeutralObstacle, isNeutralObstacle, halfExtent};
  }

  touchEnemyCandidates(current, now, maxRange = 950, from = visualPosition(current.self, now)) {
    const {state} = current;
    const maxSq = maxRange * maxRange;
    const out = [];
    for (const actor of this.orderedEntities(state, 'actors')) {
      if (!this.targetAllowed(actor, current, now, SELECT.ENEMY)) continue;
      const pos = visualPosition(actor, now);
      const dx = pos.x - from.x, dy = pos.y - from.y, distSq = dx * dx + dy * dy;
      if (distSq <= maxSq) {
        const dist = Math.sqrt(distSq);
        out.push({target: actor, pos, dx, dy, dist, edgeDist: Math.max(0, dist - 28),
          objType: 0, isTank: true, isTurret: false, isStructure: false, isNeutralObstacle: false, halfExtent: 28});
      }
    }
    for (const object of this.orderedEntities(state, 'objects')) {
      const meta = this.npcTargetMetadata(object, current);
      if (!meta || !this.targetAllowed(object, current, now, SELECT.ENEMY)) continue;
      const pos = visualPosition(object, now);
      const dx = pos.x - from.x, dy = pos.y - from.y, distSq = dx * dx + dy * dy;
      const edgeDist = Math.max(0, Math.sqrt(distSq) - meta.halfExtent);
      if (distSq <= maxSq || edgeDist <= maxRange) {
        const dist = Math.sqrt(distSq);
        out.push({target: object, pos, dx, dy, dist, edgeDist, ...meta});
      }
    }
    return out;
  }

  skillBallistics(current, slot = 0) {
    const entry = current?.state?.skills?.[String(current.self?.objectId)]?.[String(slot)];
    const skill = current?.geometry?.skillCatalog?.[String(entry?.skillId)];
    const tankId = String(current?.self?.tankId ?? '');
    const tankRange = Number(current?.geometry?.tankFireRanges?.[tankId])
      || Number(current?.geometry?.tankCatalog?.[tankId]?.nFireRange)
      || Number(current?.geometry?.tankCatalog?.[tankId]?.base?.nFireRange)
      || 0;
    const skillRange = Number(skill?.iRange) || Number(skill?.iSelectRange) || Number(skill?.iFlyRange) || 0;
    const range = slot === 0 ? (tankRange || skillRange || 480) : (skillRange || tankRange || 580);
    const rangeLimit = Boolean(Number(skill?.iRangeLimit));
    const selectedMode = skill ? selectionMode(skill, entry?.skillId) === 'selected' : false;
    const windupSec = (Number(skill?.iReadyTime) || 0) / 1000 + 0.04;
    let projectileSpeed = Infinity;
    if (Number(skill?.iFlyRange) > 0 && Number(skill?.iLifeTime) > 0) {
      projectileSpeed = Math.max(240, Math.min(2600, (Number(skill.iFlyRange) * 1000) / Number(skill.iLifeTime)));
    } else if (Number(skill?.iBulletEffectId) > 0) {
      projectileSpeed = 900;
    }
    return {entry, skill, range, tankRange, skillRange, rangeLimit, selectedMode, windupSec, projectileSpeed};
  }

  estimateTargetVelocity(target, now = this.now()) {
    const seg = target?.motion && now < target.motion.endsAt
      ? target.motion
      : target?.moveQueue?.find(m => now < m.endsAt);
    if (seg && seg.durationMs > 0) {
      const sec = seg.durationMs / 1000;
      return {vx: (seg.to.x - seg.from.x) / sec, vy: (seg.to.y - seg.from.y) / sec};
    }
    return {vx: 0, vy: 0};
  }

  clampToRange(from, target, maxDist, geometry) {
    const dx = target.x - from.x, dy = target.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (!(dist > maxDist) || !(maxDist > 0)) return clampPoint(target, geometry);
    const s = maxDist / dist;
    return clampPoint({x: from.x + dx * s, y: from.y + dy * s}, geometry);
  }

  interceptTime(dx, dy, vx, vy, speed) {
    if (!Number.isFinite(speed) || speed <= 0) return 0;
    const a = vx * vx + vy * vy - speed * speed;
    const b = 2 * (dx * vx + dy * vy);
    const c = dx * dx + dy * dy;
    const direct = Math.sqrt(c) / Math.max(1, speed);
    if (Math.abs(a) < 1e-6) {
      return b < -1e-6 ? Math.min(0.55, Math.max(0, -c / b)) : Math.min(0.55, direct);
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) return Math.min(0.55, direct);
    const root = Math.sqrt(disc);
    const t1 = (-b - root) / (2 * a), t2 = (-b + root) / (2 * a);
    const pos = [t1, t2].filter(v => v >= 0);
    return Math.min(0.55, pos.length ? Math.min(...pos) : direct);
  }

  predictTargetPoint(target, from, current, slot = 0, now = this.now(), ballistics = this.skillBallistics(current, slot)) {
    const pos = visualPosition(target, now);
    if (!pos) return null;
    const {vx, vy} = (target.objectId >>> 26) === NPC_OBJECT_TYPE ? {vx: 0, vy: 0} : this.estimateTargetVelocity(target, now);
    const {range, rangeLimit, windupSec, projectileSpeed} = ballistics;
    if (vx === 0 && vy === 0) {
      return rangeLimit && range > 12
        ? this.clampToRange(from, pos, range - 4, current.geometry)
        : clampPoint(pos, current.geometry);
    }
    const flags = nativeControlFlags(target, current.geometry.buffCatalog ?? {}, now, current.geometry.skillCatalog ?? {});
    const travel = this.interceptTime(pos.x - from.x, pos.y - from.y, vx, vy, projectileSpeed);
    let horizon = Math.min(0.58, windupSec + travel);
    if (flags.movementBlocked) horizon *= 0.15;
    const maxLead = Math.max(48, Math.min(115, range * 0.35));
    let leadX = Math.max(-maxLead, Math.min(maxLead, vx * horizon));
    let leadY = Math.max(-maxLead, Math.min(maxLead, vy * horizon));
    let dest = {x: pos.x + leadX, y: pos.y + leadY};
    const wallAt = current.geometry.bulletWallContact;
    if (wallAt) {
      // Pull predicted lead back before any wall impact along the target's stride or our shot line.
      const moveHit = wallAt(pos, dest);
      if (moveHit != null) {
        const safeT = Math.max(0, moveHit * 0.85);
        dest = {x: pos.x + leadX * safeT, y: pos.y + leadY * safeT};
      }
      if (wallAt(from, pos) == null && wallAt(from, dest) != null) {
        dest = {x: pos.x + (dest.x - pos.x) * 0.3, y: pos.y + (dest.y - pos.y) * 0.3};
      }
    }
    return rangeLimit && range > 12
      ? this.clampToRange(from, dest, range - 4, current.geometry)
      : clampPoint(dest, current.geometry);
  }

  targetCombatProfile(entity, current, now) {
    const maxHp = Number(entity.maxHp) || 0, hp = Number(entity.hp) || 0;
    const hpRatio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
    const shieldRatio = maxHp > 0 && Number(entity.shield) > 0
      ? Math.min(2.0, Number(entity.shield) / maxHp) : 0;
    const buffCatalog = current.geometry.buffCatalog ?? {};
    const flags = nativeControlFlags(entity, buffCatalog, now, current.geometry.skillCatalog ?? {});
    let guarded = flags.disappeared || flags.staticState;
    let projectileGuard = false;
    for (const buff of Object.values(entity.buffs ?? {})) {
      const row = buffCatalog[String(buff.templateId)];
      const nativeIds = [Number(buff.templateId), ...(row?.canonicalNativeBuffIds || []).map(Number)];
      if (nativeIds.some(id => IMMUNE_BUFFS.has(id))) guarded = true;
      if (nativeIds.some(id => PROJECTILE_GUARDS.has(id)
          && (id !== 386111 || [10000111, 10000055].includes(entity.tankId)))) {
        projectileGuard = true;
      }
    }
    return {hpRatio, shieldRatio, guarded, projectileGuard, controlled: flags.movementBlocked};
  }

  touchTargetScore(current, item, ballistics, slot, now, stickyId = 0, from = visualPosition(current.self, now)) {
    const effectiveRange = Math.max(140, ballistics.range);
    const rangeDist = item.edgeDist ?? item.dist;
    const inRange = rangeDist <= effectiveRange + 18;
    const outPenalty = inRange ? 0 : 1400 + (rangeDist - effectiveRange) * 2.2;
    const profile = this.targetCombatProfile(item.target, current, now);
    let score = outPenalty + rangeDist * 0.72 + profile.hpRatio * 240 + profile.shieldRatio * 150;
    if (item.isNeutralObstacle) score += 820;
    else if (item.isTurret || item.isStructure) score += 230;
    else if (!item.isTank) score += 320;
    if (profile.guarded) score += 560;
    if (profile.projectileGuard && (slot === 0 || Number.isFinite(ballistics.projectileSpeed))) score += 360;
    if (profile.hpRatio <= 0.25) score -= item.isTank ? 160 : item.isNeutralObstacle ? 30 : 115;
    if (profile.controlled && item.isTank) score -= 90;
    if (stickyId && item.target.objectId === stickyId && inRange) score -= 120;
    const pierceWalls = Boolean(Number(ballistics.skill?.fCondition) & 8);
    const losSkill = !pierceWalls && (slot === 0 || Boolean(Number(ballistics.skill?.fCondition) & 1) || Number.isFinite(ballistics.projectileSpeed));
    if (losSkill && current.geometry.lineBlocked?.(from, item.pos, current.state, {excludeObjectId: item.target.objectId})) {
      score += 1850;
    }
    return score;
  }

  bestTouchEnemyTarget(current, now = this.now(), maxRange = 950, slot = 0,
    from = visualPosition(current.self, now), ballistics = this.skillBallistics(current, slot)) {
    if (!current) return null;
    const stickyId = this.stickyTargetUntil > now ? this.stickyTargetId : 0;
    let best = null, bestScore = Infinity;
    for (const item of this.touchEnemyCandidates(current, now, maxRange, from)) {
      if (ballistics.selectedMode && item.objType === NPC_OBJECT_TYPE) continue;
      const score = this.touchTargetScore(current, item, ballistics, slot, now, stickyId, from);
      if (score < bestScore) { bestScore = score; best = item; }
    }
    if (best && slot === 0) {
      this.stickyTargetId = best.target.objectId;
      this.stickyTargetUntil = now + 500;
    }
    return best;
  }

  nearestEnemyTarget(current, now = this.now(), maxRange = 950) {
    return this.bestTouchEnemyTarget(current, now, maxRange, 0);
  }

  assistedConeTarget(current, now, dirX, dirY, maxRange = 850, maxAngleDeg = 22, slot = 0,
    from = visualPosition(current.self, now), ballistics = this.skillBallistics(current, slot)) {
    if (!current) return null;
    const minCos = Math.cos((maxAngleDeg * Math.PI) / 180);
    const stickyId = this.stickyTargetUntil > now ? this.stickyTargetId : 0;
    let best = null, bestScore = Infinity;
    for (const item of this.touchEnemyCandidates(current, now, maxRange, from)) {
      if (ballistics.selectedMode && item.objType === NPC_OBJECT_TYPE) continue;
      if (!(item.dist > 1)) {
        if (item.isTank) return item;
        continue;
      }
      const cos = (item.dx * dirX + item.dy * dirY) / item.dist;
      if (cos < minCos) continue;
      const alignPenalty = (1 - cos) * 2200;
      const combatScore = this.touchTargetScore(current, item, ballistics, slot, now, stickyId, from);
      const score = alignPenalty + combatScore * 0.42;
      if (score < bestScore) { bestScore = score; best = item; }
    }
    if (best && slot === 0) {
      this.stickyTargetId = best.target.objectId;
      this.stickyTargetUntil = now + 450;
    }
    return best;
  }

  nearestPointTarget(current, now, point, maxRadius = 85) {
    if (!current || !point) return null;
    let best = null, bestWeight = Infinity;
    for (const item of this.touchEnemyCandidates(current, now, 1400)) {
      const d = Math.hypot(item.pos.x - point.x, item.pos.y - point.y);
      const hitRadius = maxRadius + (item.isTank ? 0 : Math.max(0, (item.halfExtent || 0) - 24));
      const weight = d + (item.isTank ? 0 : item.isNeutralObstacle ? 26 : 10);
      if (d <= hitRadius && weight < bestWeight) { bestWeight = weight; best = item; }
    }
    return best;
  }

  refreshPassiveTouchTarget(current, now) {
    if (!current || !this.aimAssist || !this.touchControls || this.touchControls.hidden) {
      if (!this.touchAimVector && !this.touchAutoAim) this.assistedTarget = null;
      return;
    }
    const from = visualPosition(current.self, now);
    const {range} = this.skillBallistics(current, 0);
    const hit = this.bestTouchEnemyTarget(current, now, Math.min(950, Math.max(range + 160, 520)), 0);
    if (!hit) { this.assistedTarget = null; return; }
    const lead = this.predictTargetPoint(hit.target, from, current, 0, now);
    this.assistedTarget = {objectId: hit.target.objectId, x: lead.x, y: lead.y,
      locked: true, passive: true, rawX: hit.pos.x, rawY: hit.pos.y};
  }

  nearestAutoAim(current, now = this.now(), maxRange = 950, slot = 0, predict = true,
    from = visualPosition(current.self, now), ballistics = this.skillBallistics(current, slot)) {
    if (!current) return null;
    const {self, geometry} = current;
    const hit = this.aimAssist ? this.bestTouchEnemyTarget(current, now, maxRange, slot, from, ballistics) : null;
    if (hit) {
      return predict
        ? this.predictTargetPoint(hit.target, from, current, slot, now, ballistics)
        : clampPoint(hit.pos, geometry);
    }
    const {range, rangeLimit} = ballistics;
    const fallbackDist = rangeLimit ? Math.min(360, Math.max(80, range - 12)) : Math.min(360, Math.max(120, range * 0.8));
    const dir = this.direction();
    const vec = dir !== 8 ? DIR_VECTORS[dir] : null;
    if (vec && (vec[0] || vec[1])) {
      const norm = Math.hypot(vec[0], vec[1]) || 1;
      return clampPoint({x: from.x + (vec[0] / norm) * fallbackDist, y: from.y + (vec[1] / norm) * fallbackDist}, geometry);
    }
    if (Number.isFinite(self.cannonAngle)) {
      const rad = (self.cannonAngle * Math.PI) / 180;
      return clampPoint({x: from.x + Math.sin(rad) * fallbackDist, y: from.y - Math.cos(rad) * fallbackDist}, geometry);
    }
    return clampPoint({x: from.x + (self.camp === 2 ? -fallbackDist : fallbackDist), y: from.y}, geometry);
  }

  setTouchAimVector(dx, dy, range = 420, slot = 0) {
    const len = Math.hypot(dx, dy);
    if (!(len > 0) || !this.activate()) return false;
    this.touchSkillSlot = Number(slot) || 0;
    this.touchAimVector = {dx: dx / len, dy: dy / len, range};
    this.touchAutoAim = false;
    const current = this.current(this.now());
    if (current) {
      this.projectAim(current);
      this.refreshTarget(current, this.now());
    }
    return true;
  }

  setTouchAutoAim(enabled = true) {
    if (!this.activate()) return false;
    this.touchAimVector = null;
    this.touchAutoAim = !!enabled;
    const current = this.current(this.now());
    if (current) {
      this.projectAim(current);
      this.refreshTarget(current, this.now());
    }
    return true;
  }

  clearTouchAim() {
    this.touchAimVector = null;
    this.touchAutoAim = false;
    this.touchSkillSlot = 0;
  }

  setTouchFire(held) {
    this.touchFire = held && this.activate();
    if (this.touchFire) {
      this.touchSkillSlot = 0;
      if (!this.touchAimVector) this.touchAutoAim = true;
      const now = this.now(), current = this.current(now);
      if (current) { this.projectAim(current); this.refreshTarget(current, now); }
      this.primaryCast(now);
    } else {
      this.clearTouchAim();
    }
    return this.touchFire;
  }

  previewTouchSkill(slot, dx, dy) {
    const now = this.now(), current = this.current(now);
    if (!current) return false;
    const ballistics = this.skillBallistics(current, slot);
    const range = Math.max(180, Math.min(820, ballistics.range || 480));
    this.hoverSkill(slot, now);
    return this.setTouchAimVector(dx, dy, range, slot);
  }

  castTouchSkill(slot, dx = null, dy = null) {
    const now = this.now();
    this.hoverSkill(null, now);
    if (!this.activate(now)) return false;
    const current = this.current(now);
    if (!current) return false;
    slot = Number(slot);
    if (dx != null && dy != null && Math.hypot(dx, dy) > 0) {
      const result = this.resolveCast(slot, now, current);
      const ballistics = this.skillBallistics(current, slot);
      const range = Math.max(180, Math.min(820, ballistics.range || 480));
      const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      let aim = null;
      if (result.ready && ['selected', 'point'].includes(result.mode)) {
        const searchRange = ballistics.rangeLimit ? ballistics.range + 24 : Math.max(range + 60, 520);
        const coneDeg = ballistics.range >= 600 ? 20 : 18;
        const assist = this.aimAssist ? this.assistedConeTarget(current, now, ux, uy, searchRange, coneDeg, slot) : null;
        if (assist) {
          const from = visualPosition(current.self, now);
          aim = result.mode === 'selected'
            ? clampPoint(assist.pos, current.geometry)
            : this.predictTargetPoint(assist.target, from, current, slot, now);
        }
      }
      if (!aim) {
        this.setTouchAimVector(dx, dy, range, slot);
        aim = this.aim ? {...this.aim} : null;
      }
      const sent = this.sendCast(slot, now, false, aim);
      this.clearTouchAim();
      return sent;
    }
    return this.castFromButton(slot, now);
  }

  cancelTouchSkill() {
    this.hoverSkill(null, this.now());
    this.clearTouchAim();
  }

  direction() {
    let mask = this.touchMask;
    for (const code of this.keys) mask |= MOVEMENT[code] ?? 0;
    return DIRECTIONS[mask] ?? 8;
  }

  targetAllowed(entity, current, now, limit = SELECT.ENEMY) {
    if (!entity || entity.dead || entity.removed || entity.hp <= 0) return false;
    if (entity.objectId === current.self.objectId && limit & SELECT.NOT_SELF) return false;
    const ally = entity.camp === current.self.camp;
    return !!(limit & (ally ? SELECT.TEAMMATE : SELECT.ENEMY))
      && current.geometry.visibleToSelf(entity, current.state, now)
      && validPoint(visualPosition(entity, now), current.geometry);
  }

  orderedEntities(state, kind) {
    const values = state[kind] ?? {}, order = state[kind === 'actors' ? 'actorOrder' : 'objectOrder'];
    // Native HashMap.values preserves insertion order, including remove/readd.
    // Legacy unit fixtures without ordering retain their original behavior.
    return Array.isArray(order) ? order.map(id => values[String(id)]).filter(Boolean) : Object.values(values);
  }

  pickTarget(skill, current, now, aim = this.aim) {
    if (!aim) return null;
    const limit = Number(skill.iSelectLimit) || 0;
    if (!(limit & (SELECT.TEAMMATE | SELECT.ENEMY)) || limit & ~KNOWN_SELECT_MASK) return null;
    const catalog = this.client.sceneAssets?.catalog;
    const copy = nativeTemplateId('skill', skill.nId, current.self, catalog) === 330201;
    const radius = (Number(skill.iSelectRange) || 0) + 36;
    const objects = this.orderedEntities(current.state, 'objects');
    const shadows = objects.filter(object => (object.objectId >>> 26) === AI_NPC_OBJECT_TYPE
      && Number(catalog?.aiNPCs?.[String(object.templateId)]?.nType) === AI_NPC_SHADOW);
    // Flash concatenates normal tanks then TankShadow and compares circle
    // distances in that order. A shadow must never fall through to an AI rect.
    let target = null, distance = radius ** 2;
    for (const actor of [...this.orderedEntities(current.state, 'actors'), ...shadows]) {
      if (!this.targetAllowed(actor, current, now, limit) || copy && !isNativeCopyTarget(actor)) continue;
      const position = visualPosition(actor, now);
      // ActiveObjectLayer stores the square distance in an AS3 int.
      const squared = Math.trunc((position.x - aim.x) ** 2 + (position.y - aim.y) ** 2);
      if (squared < distance) { target = actor; distance = squared; }
    }
    if (target) return target;
    if (copy) return null; // Native copying never accepts npc_template actors.
    const camps = limit & SELECT.TEAMMATE ? [current.self.camp] : [];
    if (limit & SELECT.ENEMY) for (const camp of [0, 1, 2]) {
      if (camp !== current.self.camp && !camps.includes(camp)) camps.push(camp);
    }
    // getCampAINpcList groups by team/enemy camp order, then native insertion.
    for (const camp of camps) {
      for (const object of objects) {
        if (object.camp !== camp || (object.objectId >>> 26) !== AI_NPC_OBJECT_TYPE
            || !this.targetAllowed(object, current, now, limit)) continue;
        const npc = catalog?.aiNPCs?.[String(object.templateId)];
        if (!npc || Number(npc.nType) === AI_NPC_SHADOW) continue;
        const armsId = current.self.camp === 1 && Number(npc.nOpCampArmsId) ? npc.nOpCampArmsId : npc.nArmsId;
        const arms = catalog.aiArms?.[String(armsId)], position = visualPosition(object, now);
        const halfWidth = Math.trunc(Number(arms?.iWidth) / 2), halfHeight = Math.trunc(Number(arms?.iHeight) / 2);
        if (halfWidth > 0 && halfHeight > 0 && Math.abs(aim.x - position.x) < halfWidth
            && Math.abs(aim.y - position.y) < halfHeight) {
          // Source checks the first rectangle hit's TANK restriction after
          // picking; it does not repick a later valid AI NPC under that one.
          return limit & SELECT.TANK && Number(npc.nType) !== AI_NPC_TANK ? null : object;
        }
      }
    }
    return null;
  }

  refreshTarget(current, now) {
    const slots = current.state.skills[String(current.self.objectId)] ?? {};
    const entry = [slots['1'], slots['2'], slots['10'], slots['4'], slots['0']].find(value => value
      && Number(current.geometry.skillCatalog?.[String(value.skillId)]?.iSType) === 3);
    const skill = entry && current.geometry.skillCatalog[String(entry.skillId)];
    this.targetId = skill ? this.pickTarget(skill, current, now)?.objectId ?? 0 : 0;
  }

  reject(reason, message, quiet) {
    this.lastReason = reason;
    if (!quiet && message) this.onMessage(message);
    return false;
  }

  resolveCast(slot, now, current) {
    const reject = (reason, message, extra = {}) => ({ready: false, reason, message, ...extra});
    if (!current || !ALLOWED_SLOTS.has(slot)) return reject('unavailable', null);
    const {state, self, geometry} = current;
    const entry = state.skills[String(self.objectId)]?.[String(slot)];
    const skill = geometry.skillCatalog?.[String(entry?.skillId)];
    if (!entry || !skill) return reject('metadata', 'Chưa có dữ liệu chiêu từ server.');
    const mode = selectionMode(skill, entry.skillId);
    if (!mode) return reject('selection', 'Kiểu chọn đích không khớp source hiện hành.', {entry});
    const catalog = this.client.sceneAssets?.catalog;
    const policy = castPolicy(skill, slot, self, catalog);
    const originalFlags = nativeControlFlags(self, geometry.buffCatalog ?? {}, now, geometry.skillCatalog ?? {});
    if (originalFlags.hardBlocked) return reject('control', 'Xe đang trong trạng thái khóa của server.', {entry});
    // Evaluate a presentation-only copy. The actor, native buffs, MP and CD
    // remain untouched. Only the explicit Guild recovery path may pass ordinary
    // control/seal locks; unknown buffs, suppression and vanished states cannot.
    const controlSelf = {...self, readyCast: policy.ignoreReady ? null : self.readyCast,
      buffs: Object.fromEntries(Object.entries(self.buffs ?? {}).filter(([, buff]) =>
        !(policy.ignoreCC && [30, 62].includes(Number(geometry.buffCatalog?.[String(buff.templateId)]?.nEffectType))))) };
    const flags = nativeControlFlags(controlSelf, geometry.buffCatalog ?? {}, now, geometry.skillCatalog ?? {});
    if (flags.unknownTemplates.length || flags.disappeared
        || !policy.ignoreGuildControl && (flags.attackBlocked || flags.blockedSlots.includes(slot))) {
      return reject('control', 'Xe đang bị khống chế hoặc chưa đủ dữ liệu điều khiển.', {entry});
    }
    const cooldown = cooldownView(state, self.objectId, slot, now);
    if (!cooldown?.ready && !(policy.ignoreCooldown && cooldown && cooldown.count !== 0)) return reject('cooldown', cooldown?.count === 0
      ? 'Chiêu chưa có lượt dùng.' : cooldown?.remainingMs == null
        ? 'Đang chờ đồng hồ server.' : 'Chiêu đang hồi.', {entry, cooldown});
    if (Math.max(0, Number(skill.iMpCost) || 0) > self.mp) {
      return reject('mp', 'Không đủ năng lượng.', {entry, cooldown});
    }
    return {ready: true, reason: null, message: null, entry, skill, mode, policy, catalog, cooldown};
  }

  /** Button readiness uses exactly the cast policy, excluding pointer/target
   * checks that must be resolved again at click time. Does not send anything.
   */
  castAvailability(slot, now = this.now()) {
    const result = this.resolveCast(Number(slot), now, this.current(now));
    return Object.freeze({ready: result.ready, reason: result.reason,
      skillId: result.entry?.skillId ?? null, remainingMs: result.cooldown?.remainingMs ?? null,
      cooldownIgnored: !!result.policy?.ignoreCooldown});
  }

  /** Inspect a HUD skill without selecting, aiming, activating or firing it.
   * Cooldown and MP do not hide its range; the accepted slot is authoritative.
   */
  hoverSkill(slot, now = this.now()) {
    this.hoveredSkill = null;
    if (slot == null) return false;
    slot = Number(slot);
    const current = this.current(now);
    const entry = current?.state.skills?.[String(current.self.objectId)]?.[String(slot)];
    if (!slot || !ALLOWED_SLOTS.has(slot) || !entry
        || !current.geometry.skillCatalog?.[String(entry.skillId)]) return false;
    this.hoveredSkill = {slot, skillId: entry.skillId};
    return true;
  }

  showRangeFeedback(slot, entry, now) {
    const skill = this.getGeometry()?.skillCatalog?.[String(entry?.skillId)];
    if (slot && ALLOWED_SLOTS.has(slot) && entry && Number(skill?.iRange) > 0 && Number.isFinite(now)) {
      this.rangeFeedback = {slot, skillId: entry.skillId, expiresAt: now + RANGE_FEEDBACK_MS};
    }
  }

  /** Only Kakashi's original copy E accepts the side portraits. The copied
   * kit keeps its own normal aiming path. A portrait is an explicit actor ID,
   * not a camera move or an auto-pick of a different nearby tank. */
  portraitCopyAvailability(accountId, now = this.now()) {
    const current = this.current(now);
    if (!current) return {copy: false, ready: false};
    const {state, self, geometry} = current;
    const entry = state.skills?.[String(self.objectId)]?.['1'];
    const skill = geometry.skillCatalog?.[String(entry?.skillId)];
    const catalog = this.client.sceneAssets?.catalog;
    if (!skill || nativeTemplateId('skill', skill.nId, self, catalog) !== 330201)
      return {copy: false, ready: false};
    const result = this.resolveCast(1, now, current);
    const reject = (reason, message) => ({copy: true, ready: false, reason, message});
    if (!result.ready) return reject(result.reason, result.message);
    const objectId = state.accountObjects?.[String(accountId)];
    const target = state.actors?.[String(objectId)];
    if (!Number.isInteger(accountId) || target?.accountId !== accountId || !isNativeCopyTarget(target)
        || target.objectId === self.objectId || !this.targetAllowed(target, current, now, Number(skill.iSelectLimit) || 0))
      return reject('target', 'Chỉ sao chép tank còn sống, đang trong tầm nhìn của đội; không sao chép Kakashi.');
    if (!targetBuffsAllowed(skill, target, self, state, catalog))
      return reject('target-buff', 'Mục tiêu chưa đáp ứng điều kiện của chiêu sao chép.');
    const destination = visualPosition(target, now), from = visualPosition(self, now);
    if (!(Number(skill.iRange) > 0) || Math.hypot(destination.x - from.x, destination.y - from.y) > Number(skill.iRange))
      return {...reject('range', 'Tank đã chọn nằm ngoài tầm sao chép.'), entry};
    return {copy: true, ready: true, entry, targetId: target.objectId, destination};
  }

  hoverPortrait(accountId) {
    this.portraitAccountId = Number.isInteger(accountId) ? accountId : null;
    if (this.portraitAccountId != null) { this.aim = null; this.targetId = 0; }
  }

  sendPortraitCopy(accountId, now = this.now()) {
    const result = this.portraitCopyAvailability(accountId, now);
    if (!result.copy) return false;
    if (!result.ready) {
      if (result.reason === 'range') this.showRangeFeedback(1, result.entry, now);
      return this.reject(result.reason, result.message, false);
    }
    if (!this.activate(now)) return false;
    const {entry, targetId, destination} = result;
    const x = Math.trunc(destination.x), y = Math.trunc(destination.y);
    if (!this.client.useSkill(1, targetId, x, y)) return false;
    this.selectedSlot = 0; this.selectedEntry = null;
    this.lastAction = {slot: 1, skillId: entry.skillId, targetId, x, y, at: now, source: 'portrait'};
    this.rangeFeedback = null;
    this.lastReason = null;
    return true;
  }

  castFromPortrait(accountId, now = this.now()) {
    // In normal-cast mode E must first be selected. Bare portrait clicks keep
    // their spectator meaning and cannot accidentally fire the borrowed E.
    if (this.selectedSlot !== 1) return false;
    return this.sendPortraitCopy(accountId, now);
  }

  sendCast(slot, now, quiet, buttonAim = null, selfCast = false, project = true) {
    const current = this.current(now);
    if (!this.active || !current || !ALLOWED_SLOTS.has(slot)) return false;
    if (project && buttonAim == null) this.projectAim(current);
    const aim = buttonAim ?? this.aim;
    const {state, self, geometry} = current;
    const result = this.resolveCast(slot, now, current);
    if (!result.ready) return this.reject(result.reason, result.message, quiet);
    const {entry, skill, mode, catalog} = result;
    if (slot === 0 && (!(state.selfFireRate > 0) || now < (state.fireReadyAt ?? -Infinity)
        || (this.lastBasicRequestAt != null && now < this.lastBasicRequestAt + state.selfFireRate))) {
      return this.reject('fire-spacing', null, true);
    }
    let destination = {x: 0, y: 0}, targetId = 0, outsideRange = false;
    if (mode === 'point' || mode === 'selected') {
      const useSelf = selfCast && mode === 'selected' && canCastOnSelf(skill);
      if (!useSelf && !validPoint(aim, geometry)) return this.reject('aim', 'Đưa chuột vào bản đồ để chọn hướng.', quiet);
      const from = visualPosition(self, now);
      if (mode === 'selected') {
        const target = useSelf ? self : this.pickTarget(skill, current, now, aim);
        if (!target || !this.targetAllowed(target, current, now, Number(skill.iSelectLimit) || 0)) {
          // Even empty ground can be outside the inspected cast distance.
          // Use only the pointer, never a hidden or otherwise invalid target.
          if (!useSelf && Number(skill.iRange) > 0
              && Math.hypot(aim.x - from.x, aim.y - from.y) > Number(skill.iRange))
            this.showRangeFeedback(slot, entry, now);
          return this.reject('target', 'Chọn một mục tiêu hợp lệ còn sống và đang nhìn thấy.', quiet);
        }
        if (!targetBuffsAllowed(skill, target, self, state, catalog)) {
          return this.reject('target-buff', 'Mục tiêu chưa đáp ứng điều kiện hiệu ứng của chiêu.', quiet);
        }
        targetId = target.objectId; destination = visualPosition(target, now);
        outsideRange = !useSelf && Number(skill.iRange) > 0
          && Math.hypot(destination.x - from.x, destination.y - from.y) > Number(skill.iRange);
        // Native mouse tank picking leaves successful selected-target range
        // validation to the server. Do not select a different target to fake it.
        // Shift+self sends self XY directly; the map mouse path uses the
        // native 60px ray when its pointer falls inside the 72px self body.
        if (!useSelf && Math.abs(aim.x - from.x) <= 36 && Math.abs(aim.y - from.y) <= 36) {
          destination = basicFireDestination(from, aim, {fCondition: 1});
        }
      } else {
        const distance = Math.hypot(aim.x - from.x, aim.y - from.y);
        outsideRange = Number(skill.iRange) > 0 && distance > Number(skill.iRange);
        if (Number(skill.iRangeLimit) && distance > Number(skill.iRange)) {
          this.showRangeFeedback(slot, entry, now);
          return this.reject('range', 'Điểm chọn nằm ngoài tầm chiêu.', quiet);
        }
        destination = basicFireDestination(from, aim, skill);
      }
      if (!validPoint(destination, geometry)) return this.reject('bounds', 'Điểm chọn nằm ngoài bản đồ.', quiet);
    }
    const x = Math.trunc(destination.x), y = Math.trunc(destination.y);
    if (!this.client.useSkill(slot, targetId, x, y)) return false;
    // A distant aim may remain a legal direction-only cast. The visual hint
    // never suppresses that request or turns it into a new local rejection.
    if (outsideRange) this.showRangeFeedback(slot, entry, now);
    else if (slot) this.rangeFeedback = null;
    if (slot === 0) this.lastBasicRequestAt = now;
    this.lastAction = {slot, skillId: entry.skillId, targetId, x, y, at: now};
    this.lastReason = null;
    return true;
  }

  // Public strict-pointer cast, also useful for explicit canvas actions.
  cast(slot, now = this.now()) {
    if (!this.activate(now)) return false;
    return this.sendCast(Number(slot), now, false);
  }

  // A DOM button necessarily takes the pointer outside the canvas. Its
  // explicit quickcast uses the last valid WORLD point, but resolves target,
  // cooldown and controls again now. It never reuses a cached target ID.
  // Keyboard/held-fire paths do not call this method and stay pointer-strict.
  castFromButton(slot, now = this.now()) {
    if (!this.activate(now)) return false;
    if (this.touchControls && !this.touchControls.hidden) {
      slot = Number(slot);
      const current = this.current(now), result = this.resolveCast(slot, now, current);
      if (result.ready && ['point', 'selected'].includes(result.mode)) {
        const limit = Number(result.skill?.iSelectLimit) || 0;
        const selfOnly = result.mode === 'selected' && canCastOnSelf(result.skill) && !(limit & SELECT.ENEMY);
        if (selfOnly) return this.sendCast(slot, now, false, null, true);
        const ballistics = this.skillBallistics(current, slot);
        const searchRange = ballistics.rangeLimit ? ballistics.range + 24 : Math.max(ballistics.range + 120, 620);
        if (result.mode === 'selected') {
          if ((limit & SELECT.TEAMMATE) && !(limit & SELECT.ENEMY)) {
            const from = visualPosition(current.self, now);
            let bestAlly = null, bestDist = searchRange;
            for (const actor of this.orderedEntities(current.state, 'actors')) {
              if (!this.targetAllowed(actor, current, now, limit)) continue;
              const pos = visualPosition(actor, now);
              const d = Math.hypot(pos.x - from.x, pos.y - from.y);
              if (d <= bestDist) { bestDist = d; bestAlly = pos; }
            }
            if (bestAlly) return this.sendCast(slot, now, false, bestAlly);
          }
          const hit = this.bestTouchEnemyTarget(current, now, searchRange, slot);
          if (hit) return this.sendCast(slot, now, false, clampPoint(hit.pos, current.geometry));
          return this.sendCast(slot, now, false, this.nearestAutoAim(current, now, searchRange, slot, false));
        }
        const aim = this.touchAimVector && this.aim
          ? (ballistics.rangeLimit ? this.clampToRange(visualPosition(current.self, now), this.aim, ballistics.range - 4, current.geometry) : {...this.aim})
          : this.nearestAutoAim(current, now, searchRange, slot, true);
        return this.sendCast(slot, now, false, aim);
      }
      return this.selectOrCast(slot, now, false, this.lastMapAim ? {...this.lastMapAim} : null);
    }
    return this.selectOrCast(Number(slot),now,false,this.lastMapAim ? {...this.lastMapAim} : null);
  }

  /** Explicit accessibility/DOM equivalent of Shift+E/Space/R. */
  castOnSelf(slot, now = this.now()) {
    if (!this.activate(now)) return false;
    return this.sendCast(Number(slot), now, false, null, true);
  }

  updateChannel(current, now, send = false) {
    const {self, state, geometry} = current;
    const timing = Object.values(self.buffs ?? {}).filter(buff =>
      Number(geometry.buffCatalog?.[String(buff.templateId)]?.nEffectType) === 81)
      .sort((a, b) => (self.buffPresentation?.changes?.[String(a.templateId)]?.sequence ?? 0)
        - (self.buffPresentation?.changes?.[String(b.templateId)]?.sequence ?? 0)).at(-1);
    if (!timing) { this.channel = null; return null; }
    const row = geometry.buffCatalog[String(timing.templateId)], position = visualPosition(self, now);
    const identity = `${timing.instanceId}:${timing.templateId}:${timing.receivedAt}`;
    if (!this.channel || this.channel.identity !== identity) {
      const accepted = self.lastSkillAim;
      const initial = accepted && (accepted.x !== accepted.startX || accepted.y !== accepted.startY)
        ? cannonAngleTo({x: accepted.startX, y: accepted.startY}, accepted)
        : Number(self.cannonAngle) || 0;
      this.channel = {identity, angle: initial, lastAt: now, lastSampleAt: null,
        lastWire: null, serverAim: null, suspended: !this.active};
    }
    const channel = this.channel;
    if (self.lastServerAim && self.lastServerAim.receivedAt >= (timing.receivedAt ?? 0)
        && self.lastServerAim !== channel.serverAim) {
      channel.angle = cannonAngleTo(position, self.lastServerAim);
      channel.serverAim = self.lastServerAim;
      channel.lastAt = now;
    }
    const flags = nativeControlFlags(self, geometry.buffCatalog ?? {}, now, geometry.skillCatalog ?? {});
    const elapsed = channel.suspended || !this.active ? 0 : Math.max(0, now - channel.lastAt);
    if (this.aim && !flags.cannonLocked && !flags.staticState && this.active) {
      const goal = cannonAngleTo(position, this.aim), speed = Number(row.fEffectValB) || 0;
      channel.angle = speed > 0 ? turnCannon(channel.angle, goal, speed, elapsed) : goal;
    }
    channel.lastAt = now; channel.suspended = !this.active;
    channel.aim = projectChannelAim(position, channel.angle);
    if (send && this.active && this.aim && !flags.unknownTemplates.length
        && (channel.lastSampleAt == null || now - channel.lastSampleAt >= 60)) {
      channel.lastSampleAt = now;
      const {x, y} = channel.aim;
      const changed = !channel.lastWire || x !== channel.lastWire.x || y !== channel.lastWire.y;
      if (changed && [x, y].every(value => Number.isInteger(value) && value >= -32768 && value <= 32767)
          && this.client.cacheSkillDestination?.(x, y)) channel.lastWire = {x, y};
    }
    return {...channel.aim};
  }

  channelAim(now = this.now()) {
    const current = this.current(now);
    return current ? this.updateChannel(current, now) : null;
  }

  tick(now = this.now()) {
    const current = this.current(now);
    if (!current) return;
    if (!this.active) { this.updateChannel(current, now); return; }
    this.projectAim(current);
    this.refreshTarget(current, now);
    this.updateChannel(current, now, true);
    const direction = this.direction();
    if (direction !== 8) this.client.move(direction, current.geometry, now, this.keys.size ? null : this.touchPreferredAxis);
    if (this.heldFire || this.touchFire) this.primaryCast(now, false);
    else if(this.autoFire&&!this.selectedSlot)this.sendCast(0,now,true,null,false,false);
  }

  snapshot() {
    return Object.freeze({active: this.active, selectedSlot:this.selectedSlot,
      aim: this.aim ? Object.freeze({...this.aim}) : null, targetId: this.targetId,
      lastMapAim: this.lastMapAim ? Object.freeze({...this.lastMapAim}) : null,
      hoveredSkill: this.hoveredSkill ? Object.freeze({...this.hoveredSkill}) : null,
      rangeFeedback: this.rangeFeedback ? Object.freeze({...this.rangeFeedback}) : null,
      keys: Object.freeze([...this.keys]), direction: this.direction(), heldFire: this.heldFire, autoFire:this.autoFire,
      touchAiming: !!this.touchAimVector, aimAssist: this.aimAssist,
      assistedTarget: this.assistedTarget ? Object.freeze({...this.assistedTarget}) : null,
      channelActive: !!this.channel,
      channelAim: this.channel?.aim ? Object.freeze({...this.channel.aim}) : null,
      cannonAngle: this.channel?.angle ?? null, // degrees; north=0, clockwise positive
      lastReason: this.lastReason, lastAction: this.lastAction ? Object.freeze({...this.lastAction}) : null});
  }

  destroy() {
    this.releaseAll('destroyed'); this.destroyed = true;
    for (const [target, type, listener] of this.listeners) target.removeEventListener(type, listener);
    this.listeners.length = 0;
  }
}
