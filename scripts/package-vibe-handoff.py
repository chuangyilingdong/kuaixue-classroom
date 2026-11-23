import hashlib
import io
from pathlib import Path
import tarfile


root = Path(__file__).resolve().parents[1]
release = root / 'release'
build = release / 'vibe-server'
deploy = root / 'integrations/vibecoding/deploy'
workbench = release / 'vibe-course-web'
files = {name: build / name for name in (
    'gateway.cjs', 'host-image-full.tar', 'host-image-full.manifest.json',
    'host-image-full.sha256', 'LICENSE', 'THIRD-PARTY-NOTICES.md',
)}
for name in ('kuaixue-vibe.socket', 'kuaixue-vibe.service', 'provision-host.py', 'nginx-preview.conf'):
    files[name] = deploy / name
files['DEPLOY.md'] = root / 'docs/快学课堂_VibeCoding网关部署_20261123.md'
files['ASSET-API.md'] = root / 'docs/快学课堂_画布素材接口交付_20261123.md'
files['RUNTIME-SPEC.md'] = root / 'docs/specs/vibecoding-full-runtime.md'
files['FULL-CAPABILITY-RECEIPT.md'] = root / 'docs/快学课堂_完整能力补齐回执_20261123.md'
files['HYBRID-RUNTIME.md'] = root / 'docs/快学课堂_VibeCoding混合运行接入_20261123.md'
files['MAIN-SITE-CONSTRAINTS.md'] = root / 'docs/快学课堂_主站接口约束确认_20261123.md'
for path in workbench.rglob('*'):
    if path.is_file():
        files['workbench/' + path.relative_to(workbench).as_posix()] = path
assert 'workbench/index.html' in files
assert not any(name.endswith('.map') for name in files)
archive = release / 'kuaixue-vibe-linux-amd64-20261123-full.tar.gz'
with tarfile.open(archive, 'w:gz', compresslevel=3) as output:
    hashes = []
    for name, path in sorted(files.items()):
        info = output.gettarinfo(str(path), arcname=name)
        assert info.isfile()
        info.mode = 0o755 if name == 'provision-host.py' else 0o644
        with path.open('rb') as source:
            hashes.append(hashlib.file_digest(source, 'sha256').hexdigest() + '  ' + name)
            source.seek(0)
            output.addfile(info, source)
    manifest = ('\n'.join(hashes) + '\n').encode()
    info = tarfile.TarInfo('SHA256SUMS')
    info.size = len(manifest)
    output.addfile(info, io.BytesIO(manifest))
with tarfile.open(archive, 'r|gz') as check:
    expected = dict((line[66:], line[:64]) for line in hashes)
    for member in check:
        contents = check.extractfile(member)
        if member.name == 'SHA256SUMS':
            assert contents.read() == manifest
        else:
            assert hashlib.file_digest(contents, 'sha256').hexdigest() == expected.pop(member.name)
    assert not expected
print(archive.name, len(files), 'files verified')
