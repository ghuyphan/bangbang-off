"""Shared mixins and helpers for tank action classes and passive map objects."""
import struct

from combat_data import table_row
from combat_protocol import props, scene


def simplify_route(points):
    """Collapse collinear interior waypoints while keeping corners and endpoints."""
    pts = [tuple(p) for p in points]
    if len(pts) <= 2:
        return pts
    out = pts[:1]
    for i, p in enumerate(pts[1:-1], 1):
        a, b = pts[i - 1], pts[i + 1]
        if (p[0] - a[0]) * (b[1] - p[1]) != (p[1] - a[1]) * (b[0] - p[0]):
            out.append(p)
    out.append(pts[-1])
    return out


class PassiveMapObjectMixin:
    """No-op movement/stat hooks shared by stationary/escort map objectives."""

    def sync_speed(self, now):
        return []

    def update(self, now):
        return []

    def restore_hp(self, amount, now):
        return []

    def add_shield(self, *args, **kwargs):
        return []

    def cc_immune(self, now, *, slow=False):
        return True

    def cast(self, *args, **kwargs):
        return []

    def _set_motion(self, start, dest, speed, now, kind=0):
        return 0

    def move_destination(self, start, dest):
        return self.position_at(self.clock())

    def blink_destination(self, start, dest):
        return self.position_at(self.clock())


class SpeedLockMixin:
    """Zero movement speed while any attribute in `_speed_lock_attrs` is truthy."""

    _speed_lock_attrs = ('ready',)

    def _speed(self, now):
        if any(getattr(self, attr, None) for attr in self._speed_lock_attrs):
            return 0
        return super()._speed(now)


class BlockedLockMixin:
    """Block actions while any attribute in `_block_lock_attrs` is truthy."""

    _block_lock_attrs = ('ready',)

    def blocked(self, action, now):
        if any(getattr(self, attr, None) for attr in self._block_lock_attrs):
            return True
        return super().blocked(action, now)


class ActionLockMixin:
    """Block both movement and actions while `_lock_attrs` is truthy."""

    _lock_attrs = ('ready',)

    def _speed(self, now):
        if any(getattr(self, attr, None) for attr in self._lock_attrs):
            return 0
        return super()._speed(now)

    def blocked(self, action, now):
        if any(getattr(self, attr, None) for attr in self._lock_attrs):
            return True
        return super().blocked(action, now)


class SlotCooldownMixin:
    """Emit S1572/S1579 cooldown packets for a tank's `_slots` map."""

    _slots = None
    _charge_slot = None
    _charge_attrs = ('e_count', 'e_next_charge')

    def _skill_id_for_slot(self, slot):
        return self._slots[slot]

    def _cooldown(self, slot, changed=False):
        skill_id = self._skill_id_for_slot(slot)
        if self._charge_slot is not None and slot == self._charge_slot:
            count = getattr(self, self._charge_attrs[0])
            next_charge = getattr(self, self._charge_attrs[1])
            body = props(skill_id, slot, count, self.cooldowns[slot], next_charge)
        else:
            body = props(skill_id, slot, -1, self.cooldowns[slot])
        if changed and self.id == 1:
            return 1579, body
        return 1572, body + struct.pack('<I', self.id)


class MpResourceMixin:
    """Bounded secondary resource pool (`iMp` or fixed `_mp_cap`)."""

    _mp_cap = None

    def _resource(self, delta):
        if getattr(self, 'noel_box', None):
            return []
        cap = int(self.stats['iMp']) if self._mp_cap is None else self._mp_cap
        old, self.mp = self.mp, max(0, min(cap, self.mp + delta))
        return [scene(mp=(struct.pack('<Ii', self.id, self.mp),))] if old != self.mp else []


class VanishCcMixin:
    """Untargetable vanish state grants CC immunity."""

    def cc_immune(self, now, *, slow=False):
        return bool(self.vanish) or super().cc_immune(now, slow=slow)


class VanishRejectMixin:
    """Untargetable vanish state rejects enemy buffs."""

    def reject_buff(self, row, source, now):
        return bool(self.vanish and source.camp != self.camp)


class VanishImmunityMixin(VanishCcMixin, VanishRejectMixin):
    """Untargetable vanish state blocks enemy buffs and CC."""


class AreaEnemiesMixin:
    """Find live area-targetable enemies within `radius` of `center`."""

    def _enemies(self, center, radius, now):
        import math
        return [a for a in self.arena.actors.values() if a.alive and a.camp != self.camp
                and a.is_area_targetable() and math.dist(center, a.position_at(now)) <= radius]


class MarksCleanupMixin:
    """Clear per-target mark state when a target dies."""

    def on_target_death(self, target, now):
        self.marks.pop(target.id, None)
        return []


class ControlInterruptMixin:
    """Interrupt channel/ready state when hit by stun/silence/ban."""

    _require_ready_on_control = True

    def on_control(self, source, template, now):
        if self._require_ready_on_control and not getattr(self, 'ready', None):
            return []
        if int(table_row('BuffTemplate_table.xml', nBuffId=template)['nEffectType']) in (30, 35, 66):
            return self.interrupt(now)
        return []


class ReadySealUpdateMixin:
    """Cancel a held ready state if slot 1 becomes sealed before release."""

    def update(self, now):
        packets = self.interrupt(now) if self.ready and self.skill_sealed(1, now) else []
        return packets + super().update(now)
