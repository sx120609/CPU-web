const MANAGED_START = '# CPU_WEB_HTTP_REDIRECT_START'
const MANAGED_END = '# CPU_WEB_HTTP_REDIRECT_END'

function assertAbsoluteNginxPath(value, label) {
  const normalized = String(value || '').trim().replace(/\\/g, '/')
  if (!normalized.startsWith('/') || /[\r\n;{}]/.test(normalized)) {
    throw new Error(`${label} must be a safe absolute nginx path`)
  }
  return normalized.replace(/\/$/, '') || '/'
}

export function patchNginxHttpRedirect(source, options = {}) {
  const siteRoot = assertAbsoluteNginxPath(options.siteRoot, 'siteRoot')
  const wellKnownInclude = assertAbsoluteNginxPath(
    options.wellKnownInclude || '/www/server/panel/vhost/nginx/well-known/cpu.lizmt.cn.conf',
    'wellKnownInclude'
  )
  let config = String(source || '').replace(/\r\n/g, '\n')

  const managedPattern = new RegExp(
    `^${MANAGED_START}[\\s\\S]*?^${MANAGED_END}\\n*`,
    'm'
  )
  const hadManagedBlock = managedPattern.test(config)
  config = config.replace(managedPattern, '')

  const baotaRedirectPattern = /^\s*#HTTP_TO_HTTPS_START[\s\S]*?^\s*#HTTP_TO_HTTPS_END\s*\n?/m
  const hadBaotaRedirect = baotaRedirectPattern.test(config)
  if (!hadBaotaRedirect && !hadManagedBlock) {
    throw new Error('Baota HTTP redirect block was not found; refusing an ambiguous patch')
  }
  config = config.replace(baotaRedirectPattern, '')

  const listen80Pattern = /^\s*listen\s+80(?:\s+default_server)?;\s*\n/m
  const hadTlsBlockListen80 = listen80Pattern.test(config)
  if (!hadTlsBlockListen80 && !hadManagedBlock) {
    throw new Error('listen 80 directive was not found; refusing an ambiguous patch')
  }
  config = config.replace(listen80Pattern, '')

  const redirectServer = `${MANAGED_START}
server {
    listen 80;
    server_name cputime.cn www.cputime.cn cpu.lizmt.cn;
    root ${siteRoot};

    # Keep Baota/ACME certificate validation reachable over plain HTTP.
    include ${wellKnownInclude};

    location / {
        return 301 https://cputime.cn$request_uri;
    }
}
${MANAGED_END}

`

  return `${redirectServer}${config.replace(/^\s+/, '')}`.replace(/\n{3,}/g, '\n\n')
}
