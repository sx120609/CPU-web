import assert from 'node:assert/strict'
import test from 'node:test'
import { patchNginxHttpRedirect } from './nginx-http-redirect.mjs'

const SOURCE = `server {
    listen 80;
    listen 443 ssl;
    listen 443 quic;
    server_name www.cputime.cn cputime.cn cpu.lizmt.cn;
    root /www/wwwroot/cpu.lizmt.cn/CPU-web;
    #HTTP_TO_HTTPS_START
    set $isRedirect 1;
    if ($server_port != 443) {
        set $isRedirect 2;
    }
    if ($uri ~ /.well-known/) {
        set $isRedirect 1;
    }
    if ($isRedirect != 1) {
        rewrite ^/(.*)$ https://$host/$1 permanent;
    }
    #HTTP_TO_HTTPS_END
    add_header Strict-Transport-Security "max-age=31536000";
    add_header Alt-Svc 'h3=":443"';
}
`

test('splits HTTP redirect from the TLS server and is idempotent', () => {
  const options = { siteRoot: '/www/wwwroot/cpu.lizmt.cn/CPU-web' }
  const once = patchNginxHttpRedirect(SOURCE, options)
  const twice = patchNginxHttpRedirect(once, options)

  assert.equal(twice, once)
  assert.match(once, /listen 80;[\s\S]*return 301 https:\/\/cputime\.cn\$request_uri;/)
  assert.match(once, /include \/www\/server\/panel\/vhost\/nginx\/well-known\/cpu\.lizmt\.cn\.conf;/)
  assert.match(once, /server \{\n\s*listen 443 ssl;/)
  assert.doesNotMatch(once, /\$isRedirect|HTTP_TO_HTTPS/)
  assert.equal((once.match(/listen 80;/g) || []).length, 1)
})
test('fails closed when the expected Baota layout is absent', () => {
  assert.throws(
    () => patchNginxHttpRedirect('server { listen 443 ssl; }', { siteRoot: '/srv/site' }),
    /not found/
  )
  assert.throws(
    () => patchNginxHttpRedirect(SOURCE, { siteRoot: 'relative/path' }),
    /safe absolute/
  )
})
