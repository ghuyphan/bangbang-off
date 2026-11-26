"""Durable per-character and per-tank battle statistics for PvP and bot matches."""
from fractions import Fraction
import json

import pk_rules
from pve_catalog import MAPS as PVE_MAPS
import storage

BACKFILL_SETTING = 'battle_stats_backfilled_v1'
TECH_KINDS = ('total', 'pvp', 'league', 'ladderpvp')
STORED_MODES = ('pvp', 'league', 'ladderpvp')
EXCLUDED_MAPS = frozenset((*PVE_MAPS, 101, 40002))

DDL = (
    'CREATE TABLE IF NOT EXISTS battle_stat_receipts ('
    'profile_id INTEGER NOT NULL, match_uuid TEXT NOT NULL, '
    'PRIMARY KEY(profile_id, match_uuid))',
    'CREATE TABLE IF NOT EXISTS character_battle_stats ('
    'profile_id INTEGER NOT NULL, mode TEXT NOT NULL, '
    'matches INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, '
    'losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, '
    'escapes INTEGER NOT NULL DEFAULT 0, killer_king INTEGER NOT NULL DEFAULT 0, '
    'assist_king INTEGER NOT NULL DEFAULT 0, mvp INTEGER NOT NULL DEFAULT 0, '
    'destroyer INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(profile_id, mode))',
    'CREATE TABLE IF NOT EXISTS tank_battle_stats ('
    'profile_id INTEGER NOT NULL, tank_id INTEGER NOT NULL, '
    'matches INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, '
    'kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, '
    'assists INTEGER NOT NULL DEFAULT 0, fight_score INTEGER NOT NULL DEFAULT 0, '
    'PRIMARY KEY(profile_id, tank_id))',
)


def ensure_tables(db):
    for statement in DDL:
        db.execute(statement)


def initialize():
    with storage.connection(write=True) as db:
        ensure_tables(db)
        backfill_from_history(db)


def fight_score_for_match(outcome, kills, assists, mvp, escaped):
    """Per-match tank battle score ('Chiến tích') delta."""
    if escaped:
        base = 0
    elif outcome == 'win':
        base = 30
    elif outcome == 'draw':
        base = 15
    else:
        base = 10
    return base + max(0, int(kills)) * 5 + max(0, int(assists)) * 3 + (15 if mvp and not escaped else 0)


def _apply_match_stats(db, profile_id, match_uuid, mode, tank_id, *,
                       won, lost, draw, escaped, kills, deaths, assists,
                       killer, assister, mvp, destroyer, fight_score):
    ensure_tables(db)
    inserted = db.execute(
        'INSERT OR IGNORE INTO battle_stat_receipts(profile_id, match_uuid) VALUES(?, ?)',
        (int(profile_id), str(match_uuid)),
    ).rowcount
    if not inserted:
        return False
    db.execute(
        'INSERT INTO character_battle_stats('
        'profile_id, mode, matches, wins, losses, draws, escapes, '
        'killer_king, assist_king, mvp, destroyer) '
        'VALUES(?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?) '
        'ON CONFLICT(profile_id, mode) DO UPDATE SET '
        'matches = matches + 1, wins = wins + excluded.wins, '
        'losses = losses + excluded.losses, draws = draws + excluded.draws, '
        'escapes = escapes + excluded.escapes, '
        'killer_king = killer_king + excluded.killer_king, '
        'assist_king = assist_king + excluded.assist_king, '
        'mvp = mvp + excluded.mvp, destroyer = destroyer + excluded.destroyer',
        (int(profile_id), mode, int(won), int(lost), int(draw), int(escaped),
         int(killer), int(assister), int(mvp), int(destroyer)),
    )
    if tank_id:
        db.execute(
            'INSERT INTO tank_battle_stats('
            'profile_id, tank_id, matches, wins, kills, deaths, assists, fight_score) '
            'VALUES(?, ?, 1, ?, ?, ?, ?, ?) '
            'ON CONFLICT(profile_id, tank_id) DO UPDATE SET '
            'matches = matches + 1, wins = wins + excluded.wins, '
            'kills = kills + excluded.kills, deaths = deaths + excluded.deaths, '
            'assists = assists + excluded.assists, '
            'fight_score = fight_score + excluded.fight_score',
            (int(profile_id), int(tank_id), int(won), int(kills), int(deaths),
             int(assists), int(fight_score)),
        )
    return True


def record_match(db, state, arena, outcome, *, player=None):
    """Record a completed non-test match into character and tank battle stats."""
    room = state.get('room') or {}
    battle = state.get('battle') or {}
    map_id = arena.geometry.id
    if room.get('tank_test') or map_id in EXCLUDED_MAPS:
        return False
    match_uuid = battle.get('match_uuid')
    if not match_uuid or not arena.pk or not arena.pk.get('finished'):
        return False
    actor = player or arena.player
    if actor is None or actor.id not in arena.pk['stats']:
        return False
    ident = int(state['char_id'])
    mode = 'ladderpvp' if room.get('ranked') else 'pvp'
    escaped = bool(battle.get('forfeit') or state.get('multiplayer_left'))
    effective_outcome = 'loss' if escaped else outcome
    stats = arena.pk['stats'][actor.id]
    kills, deaths, assists = int(stats[1]), int(stats[0]), int(stats[3])
    award = pk_rules.awards(arena)
    mvp = int(award['mvp'] == actor.id and not escaped)
    return _apply_match_stats(
        db, ident, match_uuid, mode, int(actor.info['tank_id']),
        won=(effective_outcome == 'win'),
        lost=(effective_outcome == 'loss'),
        draw=(effective_outcome == 'draw'),
        escaped=escaped,
        kills=kills,
        deaths=deaths,
        assists=assists,
        killer=int(award['killer'] == actor.id),
        assister=int(award['assister'] == actor.id),
        mvp=mvp,
        destroyer=int(award['destroyer'] == actor.id),
        fight_score=fight_score_for_match(effective_outcome, kills, assists, mvp, escaped),
    )


def backfill_from_history(db):
    """One-time idempotent import of already-settled matches in match_history."""
    ensure_tables(db)
    if db.execute('SELECT 1 FROM settings WHERE name=?', (BACKFILL_SETTING,)).fetchone():
        return 0
    has_history = db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_history'"
    ).fetchone()
    if not has_history:
        return 0
    count = 0
    for row in db.execute('SELECT profile_id, match_uuid, ranked, summary FROM match_history ORDER BY ended_ms, match_uuid'):
        summary = json.loads(row[3])
        if summary.get('map_id') in EXCLUDED_MAPS:
            continue
        profile_id = int(row[0])
        roster = summary.get('roster') or []
        player_row = next((r for r in roster if int(r.get('account_id', 0)) == profile_id), None)
        if not player_row:
            continue
        forfeit = bool(summary.get('forfeit'))
        outcome = 'loss' if forfeit else summary.get('outcome', 'loss')
        kills = int(player_row.get('kills', 0))
        deaths = int(player_row.get('deaths', 0))
        assists = int(player_row.get('assists', 0))
        max_kills = max((int(r.get('kills', 0)) for r in roster), default=0)
        max_assists = max((int(r.get('assists', 0)) for r in roster), default=0)
        killer_winner = next((r for r in roster if int(r.get('kills', 0)) == max_kills and max_kills > 0), None)
        assist_winner = next((r for r in roster if int(r.get('assists', 0)) == max_assists and max_assists > 0), None)
        mvp = 0
        if outcome == 'win' and not forfeit:
            same_camp = [r for r in roster if r.get('camp') == player_row.get('camp')]
            if same_camp:
                mvp_row = max(
                    same_camp,
                    key=lambda r: Fraction(int(r.get('kills', 0)) + int(r.get('assists', 0)),
                                           max(1, int(r.get('deaths', 0)))),
                )
                mvp = int(int(mvp_row.get('account_id', 0)) == profile_id)
        mode = 'ladderpvp' if row[2] else 'pvp'
        if _apply_match_stats(
            db, profile_id, row[1], mode, int(player_row.get('tank_id', 0)),
            won=(outcome == 'win'),
            lost=(outcome == 'loss'),
            draw=(outcome == 'draw'),
            escaped=forfeit,
            kills=kills,
            deaths=deaths,
            assists=assists,
            killer=int(bool(killer_winner and int(killer_winner.get('account_id', 0)) == profile_id)),
            assister=int(bool(assist_winner and int(assist_winner.get('account_id', 0)) == profile_id)),
            mvp=mvp,
            destroyer=0,
            fight_score=fight_score_for_match(outcome, kills, assists, mvp, forfeit),
        ):
            count += 1
    db.execute('INSERT OR REPLACE INTO settings(name, value) VALUES(?, ?)', (BACKFILL_SETTING, '1'))
    return count


def _tech_entry(matches, wins, escapes, killer, assister, mvp, destroyer):
    return dict(
        totalmatchs=matches,
        winmatchs=wins,
        winpercent=round(wins * 100 / matches) if matches else 0,
        escapeprecent=round(escapes * 100 / matches) if matches else 0,
        killerkingmatchs=killer,
        assistkingmatchs=assister,
        kda_count=mvp,
        destroyer_count=destroyer,
    )


def _has_table(db, name):
    return db.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone() is not None


def read_profile_stats(db, profile_id):
    """Read-only lookup of char_tech and per-tank stats for observechar.php."""
    empty_row = (0, 0, 0, 0, 0, 0, 0)
    by_mode = {mode: empty_row for mode in STORED_MODES}
    if _has_table(db, 'character_battle_stats'):
        for row in db.execute(
            'SELECT mode, matches, wins, escapes, killer_king, assist_king, mvp, destroyer '
            'FROM character_battle_stats WHERE profile_id=?',
            (int(profile_id),),
        ):
            if row[0] in by_mode:
                by_mode[row[0]] = tuple(int(v) for v in row[1:])

    char_tech = {mode: _tech_entry(*by_mode[mode]) for mode in STORED_MODES}
    totals = tuple(sum(by_mode[mode][i] for mode in STORED_MODES) for i in range(7))
    char_tech['total'] = _tech_entry(*totals)

    tank_stats = {}
    if _has_table(db, 'tank_battle_stats'):
        for row in db.execute(
            'SELECT tank_id, matches, wins, kills, deaths, assists, fight_score '
            'FROM tank_battle_stats WHERE profile_id=?',
            (int(profile_id),),
        ):
            tank_stats[int(row[0])] = dict(
                matches=int(row[1]),
                wins=int(row[2]),
                kills=int(row[3]),
                deaths=int(row[4]),
                assists=int(row[5]),
                fight_score=int(row[6]),
            )
    return char_tech, tank_stats
