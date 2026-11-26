"""Account-local rules for the optional level-one progression."""
import json

import cosmetic_shop
import inventory
import mail_rewards
import storage
import tank_upgrade
from combat_data import table_row

VOUCHER_SLOT = 5
TOPUP_PACKS = {1: 60, 3: 210, 5: 400}


def _needed_exp(db, level):
    row = db.execute('SELECT iNeedExp FROM client_CharLevelTemplate_table '
                     'WHERE CAST(nLevel AS INTEGER)=?', (level,)).fetchone()
    if row is not None and int(row[0]) > 0:
        return int(row[0])
    if level >= 40:
        return 0
    return 0


def reward_match(db, state, arena, outcome):
    room = state.get('room') or {}
    if room.get('tank_test') or arena.pk.get('elapsed', 0) < 15:
        return
    if state.get('multiplayer_left'):
        return
    won = outcome == 'win'
    with storage.for_profile(state['char_id']):
        wallet = cosmetic_shop.snapshot(db)
        for slot, amount in ((1, 50), (2, 140 if won else 90), (VOUCHER_SLOT, 1)):
            wallet['currency'][slot] = min(0x7fffffff, wallet['currency'][slot] + amount)
        cosmetic_shop._set(db, cosmetic_shop.PROFILE, wallet)
        grant_upgrade_materials(db, state)

    level = max(1, min(40, int(state.get('level', 1))))
    if level >= 40:
        state.update(level=40, classic_exp=0)
        return
    needed_now = _needed_exp(db, level)
    gain = max(120 if won else 75, round(max(1, needed_now) * (0.25 if won else 0.14)))
    exp = int(state.get('classic_exp', 0)) + gain
    while level < 40:
        needed = _needed_exp(db, level)
        if needed <= 0 or exp < needed:
            break
        exp -= needed
        level += 1
    if level >= 40:
        level, exp = 40, 0
    state.update(level=level, classic_exp=exp)


def grant_upgrade_materials(db, state):
    tank_uuid = state.get('match_tank_uuid') or state.get('selected_tank_uuid')
    row = db.execute('SELECT data FROM garage WHERE profile_id=? AND uuid=?',
                     (state['char_id'], tank_uuid)).fetchone()
    if not row:
        return
    tank = json.loads(row[0])
    if tank['level'] >= 6:
        return
    recipe = tank_upgrade.next_strength(tank)
    if recipe is None:
        try:
            recipe = table_row('TankUpTemplate_table.xml', nTankId=tank['tank_id'], nLevel=tank['level'])
        except ValueError:
            return
    rewards = [dict(kind='item', id=ident, quantity=(count + 2) // 3)
               for ident, count in tank_upgrade.costs(recipe).items()]
    if rewards:
        try:
            value = mail_rewards.plan(db, state['char_id'], rewards)
        except mail_rewards.RewardError:
            return  # A full bag or an unsupported material does not block other rewards.
        inventory.save(value['containers'], db)
