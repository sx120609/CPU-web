import tls from "node:tls";

export function readLiveTlsCertificate(domain, { port = 443, timeoutMs = 10_000, connect = tls.connect } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: domain,
      port,
      servername: domain,
      rejectUnauthorized: true,
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback(value);
    };

    socket.setTimeout(timeoutMs, () => finish(reject, new Error(`TLS connection timed out for ${domain}`)));
    socket.once("error", (error) => finish(reject, error));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate(true);
      finish(resolve, {
        authorized: socket.authorized,
        authorizationError: socket.authorizationError,
        subject: certificate.subject,
        subjectAltName: certificate.subjectaltname,
        issuer: certificate.issuer,
        validFrom: certificate.valid_from,
        validTo: certificate.valid_to,
        fingerprint256: certificate.fingerprint256,
        serialNumber: certificate.serialNumber,
      });
    });
  });
}
