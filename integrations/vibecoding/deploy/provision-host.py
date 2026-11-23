#!/usr/bin/env python3
"""Pre-warm a private course workspace on the Linux gateway host (root operator only)."""
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

ROOT = Path('/var/lib/kuaixue-vibe/hosts')
IMAGE = 'kuaixue-vibe-host:20261123-full'
VIBE_NETWORK = os.environ.get('KUAIXUE_VIBE_NETWORK', 'kuaixue-vibe-egress')
VIBE_MEMORY = os.environ.get('KUAIXUE_VIBE_MEMORY', '2g')
VIBE_CPUS = os.environ.get('KUAIXUE_VIBE_CPUS', '2')
VIBE_PIDS = os.environ.get('KUAIXUE_VIBE_PIDS', '512')

def provision(user, course, version):
    if not all(re.fullmatch(r'[A-Za-z0-9_.@-]{1,160}', s) for s in [user, course, version]):
        raise ValueError('需要受信课程服务的用户、课程及版本 ID')
    group = grp.getgrnam('kuaixue-vibe').gr_gid
    key = hashlib.sha256(json.dumps([user, course, version], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    ROOT.mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(ROOT, 0, group)
    ROOT.chmod(0o750)
    root = ROOT / key
    root.mkdir(mode=0o750, exist_ok=True)
    os.chown(root, 0, group)
    root.chmod(0o750)
    # Serialize retries for this workspace. Only root writes this directory.
    with (root / 'provision.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        token = root / 'token'
        if not token.exists():
            tmp = root / 'token.new'
            tmp.write_text(secrets.token_urlsafe(32), encoding='ascii')
            os.chown(tmp, 0, group)
            tmp.chmod(0o440)
            tmp.replace(token)
        for name in ('workspace', 'ipc'):
            directory = root / name
            directory.mkdir(exist_ok=True)
            os.chown(directory, 1000, group)
            directory.chmod(0o750 if name == 'ipc' else 0o700)
        name = 'kx-vibe-' + key
        def docker(*args, **options):
            return subprocess.run(['docker', *args], text=True, **options)
        if VIBE_NETWORK != 'none' and docker(
            'network', 'inspect', VIBE_NETWORK, capture_output=True
        ).returncode != 0:
            docker(
                'network', 'create',
                '--driver', 'bridge',
                '--opt', 'com.docker.network.bridge.enable_icc=false',
                VIBE_NETWORK,
                check=True,
                capture_output=True,
            )
        exists = docker('container', 'inspect', '-f', '{{.State.Running}}', name, capture_output=True)
        if exists.returncode == 0:
            if exists.stdout.strip() != 'true':
                docker('start', name, check=True)
            return
        docker('run', '-d', '--name', name, '--restart', 'unless-stopped', '--network', VIBE_NETWORK,
               '--read-only', '--cap-drop=ALL', '--security-opt', 'no-new-privileges', '--user', f'1000:{group}',
               '--pids-limit', VIBE_PIDS, '--memory', VIBE_MEMORY, '--cpus', VIBE_CPUS,
               '--ulimit', 'fsize=67108864:67108864',
               '--tmpfs','/tmp:rw,nosuid,nodev,size=512m', '--tmpfs',f'/home/node:rw,nosuid,nodev,uid=1000,gid={group},size=512m',
               '-v',f'{token}:/run/secrets/rpc-token:ro','-v',f'{root}/workspace:/workspace:rw',
               '-v',f'{root}/ipc:/ipc:rw', IMAGE, check=True)

if __name__ == '__main__':
    if os.geteuid() or len(sys.argv) != 4:
        sys.exit('usage (root): provision-host.py USER_ID COURSE_ID VERSION_ID')
    os.umask(0o077)
    provision(*sys.argv[1:])
