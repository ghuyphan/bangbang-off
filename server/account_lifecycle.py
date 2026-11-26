"""Small account lifecycle guards shared by HTTP auth and local administration.

No database writes at import/login.  Administration creates its own tables only
when explicitly enabled.  Old installations without those tables retain their
existing login semantics.  Account locks never replace SQLite transactions.
"""
from contextlib import contextmanager
from pathlib import Path
import threading

import storage

_guard = threading.Lock()
_locks = {}


@contextmanager
def account_lock(username, path=None):
    resolved = str(Path(path or storage.database_path()).resolve())
    key = (resolved, str(username))
    with _guard:
        entry = _locks.get(key)
        if entry is None:
            entry = [threading.RLock(), 0]
            _locks[key] = entry
        entry[1] += 1
        lock = entry[0]
    try:
        with lock:
            yield
    finally:
        with _guard:
            entry[1] -= 1
            if entry[1] <= 0:
                _locks.pop(key, None)


def has_table(db, name):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def blocked(db, username):
    if not has_table(db, 'admin_account_deleted_v1'):
        return False
    return db.execute('SELECT 1 FROM admin_account_deleted_v1 WHERE username=? AND deleted=1',
                      (username,)).fetchone() is not None


def valid_user(db, username):
    return not blocked(db, username) and db.execute('SELECT 1 FROM users WHERE username=?',
                                                   (username,)).fetchone() is not None


def next_profile_id(db):
    greatest = int(db.execute('SELECT COALESCE(MAX(profile_id),0) FROM worlds').fetchone()[0])
    if has_table(db, 'admin_account_deleted_v1'):
        greatest = max(greatest, int(db.execute(
            'SELECT COALESCE(MAX(profile_id),0) FROM admin_account_deleted_v1').fetchone()[0]))
    if greatest >= 0xffffffff:
        raise ValueError('Đã đạt giới hạn mã nhân vật; chưa tạo nhân vật mới.')
    return greatest + 1
