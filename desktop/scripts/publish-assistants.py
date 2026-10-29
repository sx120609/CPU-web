"""Publish verified GitHub component artifacts; upload the signed catalog last.
Requires requests (already in the worker requirements). Never stores the PDS key.
"""
import argparse
import getpass
import hashlib
import json
import pathlib
import subprocess
import time
import requests

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, help='Downloaded exact-commit GitHub assistant artifact directory')
parser.add_argument('--commit', required=True)
parser.add_argument('--key', required=True, help='Local Ed25519 private PEM, never commit it')
args = parser.parse_args()
source = pathlib.Path(args.source).resolve()
provenance = json.loads((source / 'provenance.json').read_text())
assert provenance['commit'] == args.commit, 'Artifact commit mismatch'
checksums = {}
for line in (source / 'SHA256SUMS.txt').read_text().splitlines():
    digest, name = line.split(maxsplit=1)
    name = name.lstrip('*')
    assert pathlib.Path(name).name == name, 'Unsafe artifact name'
    assert hashlib.sha256((source / name).read_bytes()).hexdigest() == digest, 'Artifact checksum mismatch'
    checksums[name] = digest
metadata = json.loads((source / 'builtin.json').read_text())
assert set(metadata) == {'chaoxing', 'multiplatform', 'weban', 'zhihuishu'}
for kind, item in metadata.items():
    assert item['filename'] == f'{kind}-{item["version"]}.json.gz'
    assert checksums[item['filename']] == item['sha256']
    assert (source / item['filename']).stat().st_size == item['size']

base = 'https://bj37249.api.aliyunfile.com'
catalog_folder = '6ae29fce1be7cd1e2f19477fbebef69d8e2b00aa'
package_folder = '6ae29fce163f8a3cb48041c082685dddbcf41456'
session = requests.Session()
session.headers['Authorization'] = 'Bearer ' + getpass.getpass('PDS API key: ')
def post(endpoint, body):
    r = session.post(base + endpoint, json=body, timeout=45)
    if not r.ok:
        raise RuntimeError('PDS request failed: ' + str(r.status_code))
    return r.json()

def sign(payload):
    # Private bytes never leave this subprocess or appear in command arguments/logs.
    code = """const fs=require('fs'),c=require('crypto');const key=c.createPrivateKey(fs.readFileSync(process.argv[1]));
const source=fs.readFileSync(process.argv[2],'utf8');const expected=source.match(/-----BEGIN PUBLIC KEY-----[\\s\\S]*?-----END PUBLIC KEY-----/)[0];
if(c.createPublicKey(key).export({format:'pem',type:'spki'}).trim()!==expected.trim())throw Error('Publisher key does not match client');
let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>data+=x);process.stdin.on('end',()=>process.stdout.write(c.sign(null,Buffer.from(data),key).toString('base64')));"""
    return subprocess.check_output(['node', '-e', code, str(pathlib.Path(args.key).resolve()), str(pathlib.Path(__file__).parents[1] / 'electron/assistant-updates.ts')], input=payload.encode()).decode()

# Verify the signing key before uploading any data.
sign('key-check')
latest = post('/v2/file/list', {'drive_id': '2', 'parent_file_id': catalog_folder, 'limit': 1, 'order_by': 'created_at', 'order_direction': 'DESC'}).get('items', [])
previous = None
if latest:
    url = post('/v2/file/get_download_url', {'drive_id': '2', 'file_id': latest[0]['file_id']})['url']
    r = requests.get(url, timeout=30); r.raise_for_status()
    previous = json.loads(r.json()['payload'])
    for kind, item in metadata.items():
        old = previous['releases'][kind]
        version = tuple(map(int, item['version'].split('.')))
        old_version = tuple(map(int, old['version'].split('.')))
        assert version >= old_version, 'Cannot publish a lower component version'
        assert version != old_version or item['sha256'] == old['sha256'], f'{kind}: bump the component version when code changes'

def upload(name, content, parent):
    # Reuse completed files left by an interrupted publication; never overwrite.
    marker = ''
    while True:
        listing = post('/v2/file/list', {'drive_id': '2', 'parent_file_id': parent, 'limit': 100, 'marker': marker})
        existing = next((x for x in listing.get('items', []) if x['name'] == name), None)
        if existing:
            assert existing['size'] == len(content) and existing['content_hash'].upper() == hashlib.sha1(content).hexdigest().upper() and existing['status'] == 'available'
            return existing['file_id']
        marker = listing.get('next_marker', '')
        if not marker: break
    digest = hashlib.sha1(content).hexdigest().upper()
    created = post('/v2/file/create', {'drive_id': '2', 'parent_file_id': parent, 'name': name, 'type': 'file', 'size': len(content), 'check_name_mode': 'refuse', 'content_hash': digest, 'content_hash_name': 'sha1', 'part_info_list': [{'part_number': 1}]})
    if not created.get('rapid_upload') and not created.get('exist'):
        url = created['part_info_list'][0]['upload_url']
        r = requests.put(url, data=content, timeout=90)
        if not r.ok: raise RuntimeError('Component upload failed')
        post('/v2/file/complete', {'drive_id': '2', 'file_id': created['file_id'], 'upload_id': created['upload_id']})
    result = post('/v2/file/get', {'drive_id': '2', 'file_id': created['file_id']})
    assert result['content_hash'].upper() == digest and result['size'] == len(content) and result['status'] == 'available'
    return created['file_id']

releases = {}
for kind, item in metadata.items():
    data = (source / item['filename']).read_bytes()
    if previous and previous['releases'][kind]['sha256'] == item['sha256']:
        file_id = previous['releases'][kind]['fileId']
    else:
        file_id = upload(f'{kind}-{item["version"]}-{item["sha256"][:16]}.json.gz', data, package_folder)
    releases[kind] = {k: v for k, v in item.items() if k != 'filename'}
    releases[kind]['fileId'] = file_id
    print(json.dumps({'component': kind, 'version': item['version'], 'size': item['size'], 'fileId': file_id}), flush=True)
sequence = max(int(time.time() * 1000), (previous or {}).get('sequence', 0) + 1)
payload = json.dumps({'schema': 1, 'sequence': sequence, 'commit': args.commit, 'releases': releases}, separators=(',', ':'))
envelope = {'payload': payload, 'signature': sign(payload)}
content = json.dumps(envelope, separators=(',', ':')).encode()
catalog_id = upload(f'assistants-{sequence}.json', content, catalog_folder)
receipt = {'commit': args.commit, 'catalogId': catalog_id, 'catalogBytes': len(content), 'sequence': sequence, 'releases': releases}
(source / 'cloud-receipt.json').write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt), flush=True)
