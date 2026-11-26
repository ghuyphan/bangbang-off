"""Prepare a private LAN listener and a public trust certificate."""
from ipaddress import IPv4Address, IPv4Network
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess

PRIVATE_NETWORKS = tuple(map(IPv4Network, ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')))
_TUNNEL_PREFIXES = ('utun', 'ppp', 'ipsec', 'tun', 'tap', 'wg')


def private_address(value):
    address = IPv4Address(value)
    if not any(address in network for network in PRIVATE_NETWORKS):
        raise ValueError('LAN needs an RFC1918 IPv4 address on this Mac.')
    return str(address)


def _ifaddr(interface):
    try:
        out = subprocess.check_output(['/usr/sbin/ipconfig', 'getifaddr', interface], text=True, stderr=subprocess.DEVNULL).strip()
        return private_address(out) if out else None
    except (OSError, subprocess.CalledProcessError, ValueError):
        return None


def _udp_probe_address():
    for target in ('192.168.255.255', '10.255.255.255', '172.16.255.255'):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                probe.connect((target, 1))
                candidate = probe.getsockname()[0]
                return private_address(candidate)
        except (OSError, ValueError):
            continue
    return None


def default_address():
    try:
        route = subprocess.check_output(['/sbin/route', '-n', 'get', 'default'], text=True, stderr=subprocess.DEVNULL)
        interface = next((line.split(':', 1)[1].strip() for line in route.splitlines()
                          if line.strip().startswith('interface:')), None)
        if interface and not interface.startswith(_TUNNEL_PREFIXES):
            addr = _ifaddr(interface)
            if addr:
                return addr
    except (OSError, subprocess.CalledProcessError):
        pass
    probed = _udp_probe_address()
    if probed:
        return probed
    for idx in range(10):
        addr = _ifaddr(f'en{idx}')
        if addr:
            return addr
    addr = _ifaddr('bridge0')
    if addr:
        return addr
    raise RuntimeError('Connect to Wi-Fi or pass --lan-address with this Mac’s private IPv4 address.')


def _cert_valid_for(cert, address, min_seconds=604800):
    if not cert.is_file():
        return False
    try:
        subprocess.run(['/usr/bin/openssl', 'x509', '-in', str(cert), '-noout', '-checkend', str(min_seconds)],
                       check=True, capture_output=True)
        text = subprocess.check_output(['/usr/bin/openssl', 'x509', '-in', str(cert), '-noout', '-text'],
                                       text=True, stderr=subprocess.DEVNULL)
        return re.search(rf'IP Address:{re.escape(address)}(?:,|\s|$)', text) is not None
    except (OSError, subprocess.CalledProcessError):
        return False


def certificates(directory, address):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    ca = directory / 'ca'
    ca.mkdir(exist_ok=True, mode=0o700)
    ca.chmod(0o700)
    cert, key = directory / 'server.pem', directory / 'server-key.pem'
    public = directory / 'BangBang-LAN-CA.cer'
    root_pem = ca / 'rootCA.pem'
    if not (_cert_valid_for(cert, address) and key.is_file() and root_pem.is_file()):
        mkcert = shutil.which('mkcert')
        if not mkcert:
            raise RuntimeError('LAN HTTPS requires mkcert. Install it with brew install mkcert.')
        subprocess.run([mkcert, '-cert-file', str(cert), '-key-file', str(key), address],
                       env=dict(os.environ, CAROOT=str(ca)), check=True, capture_output=True)
    key.chmod(0o600)
    if not public.is_file() or public.stat().st_mtime < root_pem.stat().st_mtime:
        subprocess.run(['/usr/bin/openssl', 'x509', '-in', str(root_pem),
                        '-outform', 'DER', '-out', str(public)], check=True)
    return cert, key, public
