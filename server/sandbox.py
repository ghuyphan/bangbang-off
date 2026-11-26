"""In-game sandbox & gift delivery backed by offline_mail + mail_rewards."""
from __future__ import annotations

import time
import uuid

import cosmetic_shop
import inventory
import mail_rewards
import offline_mail
import storage

ESSENTIAL_MATERIALS = (
    3000055, 3000054, 3000053, 3000052, 3000051,
    3000006, 3000005, 3000004, 3000003, 3000001,
    3000147, 3000148, 3000151,
    8000024, 4000001,
    2600002, 2600003, 2600006, 2600007, 8000002,
)
UPGRADE_GEM_MATERIALS = (
    3000055, 3000054, 3000053, 3000052, 3000051,
    3000006, 3000005, 3000004, 3000003, 3000001,
    3000147, 3000148, 3000151,
    8000024,
)


def catalog_summary(db, profile_id, world_state):
    available = mail_rewards.catalog(db)
    with storage.for_profile(profile_id):
        wallet = cosmetic_shop.snapshot(db)
        containers = inventory.load(db)
        garage = [row for row in storage.garage() if int(row.get('cont_type', 0)) == 0]
    owned_tanks = {int(r['tank_id']) for r in garage}
    owned_items = {
        int(item['template_id'])
        for bag in containers.values()
        for item in bag
        if item.get('count', 0) > 0 and not item.get('life_time')
    }

    tanks, materials, crystals, cosmetics, helpers = [], [], [], [], []
    for row in available.values():
        kind, cat, ident = row['kind'], row['category'], row['id']
        if kind == 'tank':
            tanks.append(dict(id=ident, name=row['name'], owned=ident in owned_tanks))
        elif kind == 'item':
            entry = dict(id=ident, name=row['name'], category=cat, max=row['stack_max'],
                         owned=bool(row['unique'] and ident in owned_items), unique=bool(row['unique']))
            if cat == 'crystal':
                crystals.append(entry)
            elif cat == 'material':
                materials.append(entry)
            elif cat == 'helper':
                helpers.append(entry)
            else:
                cosmetics.append(entry)

    essential_order = {item_id: idx for idx, item_id in enumerate(ESSENTIAL_MATERIALS)}
    tanks.sort(key=lambda r: (r['owned'], r['name']))
    materials.sort(key=lambda r: (0 if r['id'] in essential_order else 1, essential_order.get(r['id'], 9999), r['name']))
    crystals.sort(key=lambda r: (-int(r.get('id', 0)), r['name']))
    cosmetics.sort(key=lambda r: (r['owned'], r['category'], r['name']))
    helpers.sort(key=lambda r: r['name'])

    return dict(
        success=True,
        level=int(world_state.get('level', 36)),
        exp=int(world_state.get('classic_exp', 0)),
        classic=bool(world_state.get('classic')),
        wallet=wallet['currency'],
        unowned_tank_count=sum(1 for t in tanks if not t['owned']),
        tanks=tanks,
        materials=materials,
        crystals=crystals[:40],
        helpers=helpers[:30],
        cosmetics=cosmetics[:60],
    )


def _send_rewards_batched(db, profile_id, recipient_name, subject, body_text, rewards):
    mail_ids = []
    for index in range(0, len(rewards), mail_rewards.MAX_ROWS):
        chunk = rewards[index:index + mail_rewards.MAX_ROWS]
        payload = offline_mail.canonical(dict(
            recipient=dict(id=profile_id, name=recipient_name),
            subject=f'{subject} ({index // mail_rewards.MAX_ROWS + 1})' if len(rewards) > mail_rewards.MAX_ROWS else subject,
            body=body_text,
            rewards=chunk,
        ))
        req_id = f'sbx-{int(time.time())}-{uuid.uuid4().hex[:12]}'
        res = offline_mail.send(db, payload, req_id, proof_checked=True)
        mail_ids.append(res['mail_id'])
    return mail_ids


def _cap_currency(current, want):
    room = max(0, mail_rewards.MAX_INT - int(current))
    return min(max(0, int(want)), room)


def grant_preset(db, profile_id, world_state, request):
    preset = str(request.get('preset') or '').strip()
    available = mail_rewards.catalog(db)
    with storage.for_profile(profile_id):
        wallet = cosmetic_shop.snapshot(db)['currency']
        containers = inventory.load(db)
        garage = [row for row in storage.garage() if int(row.get('cont_type', 0)) == 0]
    owned_tanks = {int(r['tank_id']) for r in garage}
    owned_items = {
        int(item['template_id'])
        for bag in containers.values()
        for item in bag
        if item.get('count', 0) > 0 and not item.get('life_time')
    }
    name = world_state.get('name') or 'Người chơi'
    rewards = []
    subject = 'Quà Sandbox'

    if preset == 'starter':
        subject = 'Gói Khởi Đầu & Tài Nguyên'
        for cur_id, idx, want in (('cash', 0, 500_000), ('golden', 1, 5_000_000), ('gift', 2, 500_000)):
            amt = _cap_currency(wallet[idx], want)
            if amt > 0:
                rewards.append(dict(kind='currency', id=cur_id, quantity=amt))
        for mat_id in ESSENTIAL_MATERIALS:
            row = available.get(f'item:{mat_id}')
            if row:
                rewards.append(dict(kind='item', id=mat_id, quantity=min(500, row['max_quantity'])))
    elif preset == 'currency':
        subject = 'Gói Tiền Sandbox'
        for cur_id, idx in (('cash', 0), ('golden', 1), ('gift', 2)):
            want = int(request.get(cur_id) or 0)
            amt = _cap_currency(wallet[idx], want)
            if amt > 0:
                rewards.append(dict(kind='currency', id=cur_id, quantity=amt))
    elif preset == 'upgrade_gems':
        subject = 'Bộ Ngọc Saphire & Mảnh Cường Hóa'
        for mat_id in UPGRADE_GEM_MATERIALS:
            row = available.get(f'item:{mat_id}')
            if row:
                rewards.append(dict(kind='item', id=mat_id, quantity=min(500, row['max_quantity'])))
    elif preset == 'materials':
        subject = 'Nguyên liệu Nâng Tank & Trợ thủ'
        ids = [r['id'] for r in available.values() if r['kind'] == 'item' and r['category'] == 'material']
        prioritized = [i for i in ESSENTIAL_MATERIALS if i in ids] + [i for i in ids if i not in ESSENTIAL_MATERIALS]
        for ident in prioritized[:24]:
            row = available[f'item:{ident}']
            rewards.append(dict(kind='item', id=ident, quantity=min(200, row['max_quantity'])))
    elif preset == 'crystals':
        subject = 'Bộ Tinh Thể Cấp 5'
        lv5 = [r['id'] for r in available.values()
               if r['kind'] == 'item' and r['category'] == 'crystal' and r.get('level', 0) == 5]
        pool = lv5 or [r['id'] for r in available.values() if r['kind'] == 'item' and r['category'] == 'crystal']
        for ident in pool[:16]:
            row = available[f'item:{ident}']
            rewards.append(dict(kind='item', id=ident, quantity=min(6, row['max_quantity'])))
    elif preset == 'tanks':
        subject = 'Mở Khóa Tank Vĩnh Viễn'
        wanted = request.get('tank_ids')
        pool = [int(t) for t in wanted] if isinstance(wanted, list) and wanted else [
            r['id'] for r in available.values() if r['kind'] == 'tank'
        ]
        for ident in pool:
            if ident in owned_tanks or f'tank:{ident}' not in available:
                continue
            rewards.append(dict(kind='tank', id=ident, quantity=1))
            if len(rewards) >= 32:
                break
    elif preset == 'item':
        ident = int(request.get('id') or 0)
        qty = max(1, int(request.get('quantity') or 1))
        row = available.get(f'item:{ident}')
        if not row:
            raise ValueError('Vật phẩm này không có trong danh mục quà hỗ trợ.')
        if row['unique'] and ident in owned_items:
            raise ValueError(f'Bạn đã sở hữu vĩnh viễn {row["name"]}.')
        rewards.append(dict(kind='item', id=ident, quantity=min(qty, row['max_quantity'])))
        subject = f'Quà: {row["name"]}'
    elif preset == 'custom':
        for raw in (request.get('rewards') or []):
            rewards.append(dict(kind=str(raw['kind']), id=raw['id'], quantity=int(raw['quantity'])))
    else:
        raise ValueError('Gói quà sandbox không hợp lệ.')

    if not rewards:
        raise ValueError('Tài khoản đã đạt tối đa hoặc đã sở hữu toàn bộ phần thưởng trong gói này.')

    mail_ids = _send_rewards_batched(db, profile_id, name, subject, 'Quà tiếp tế từ Bảng Quà Sandbox.', rewards)
    return dict(success=True, mail_ids=mail_ids, reward_count=len(rewards),
                message=f'Đã gửi {len(rewards)} phần quà qua hòm thư.')
