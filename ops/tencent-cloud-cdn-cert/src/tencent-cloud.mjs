function unwrap(response) {
  return response?.Response ?? response;
}

function clientCall(client, method, params) {
  if (!client || typeof client[method] !== "function") {
    throw new Error(`Tencent Cloud SDK client does not implement ${method}`);
  }
  return client[method](params).then(unwrap);
}

export class TencentCloudGateway {
  constructor({ cdnClient, sslClient }) {
    this.cdnClient = cdnClient;
    this.sslClient = sslClient;
  }

  async describeCdnDomain(domain) {
    const response = await clientCall(this.cdnClient, "DescribeDomainsConfig", {
      Offset: 0,
      Limit: 2,
      Filters: [{ Name: "domain", Value: [domain], Fuzzy: false }],
    });
    const matches = (response?.Domains ?? []).filter((item) => String(item.Domain).toLowerCase() === domain.toLowerCase());
    if (matches.length === 0) return null;
    if (matches.length !== 1) throw new Error(`Tencent CDN returned duplicate exact matches for ${domain}`);
    const item = matches[0];
    return {
      domain: item.Domain,
      resourceId: item.ResourceId,
      status: item.Status,
      httpsSwitch: item.Https?.Switch,
      httpsBillingSwitch: item.HttpsBilling?.Switch ?? item.Https?.Switch,
      certificateId: item.Https?.CertInfo?.CertId,
      certificateExpireTime: item.Https?.CertInfo?.ExpireTime,
      certificateDeployTime: item.Https?.CertInfo?.DeployTime,
      raw: item,
    };
  }

  async describeCertificate(certificateId) {
    return clientCall(this.sslClient, "DescribeCertificate", { CertificateId: certificateId });
  }

  async listCertificates(domain) {
    const response = await clientCall(this.sslClient, "DescribeCertificates", {
      Offset: 0,
      Limit: 100,
      SearchKey: domain,
      CertificateType: "SVR",
      CertificateStatus: [0, 1, 4, 13],
    });
    return response?.Certificates ?? [];
  }

  async applyFreeCertificate(domain) {
    return clientCall(this.sslClient, "ApplyCertificate", {
      DvAuthMethod: "DNS_AUTO",
      DomainName: domain,
      PackageType: "83",
      ValidityPeriod: "3",
      CsrEncryptAlgo: "RSA",
    });
  }

  async deployCertificate({ certificateId, domain, httpsBillingSwitch }) {
    return clientCall(this.sslClient, "DeployCertificateInstance", {
      CertificateId: certificateId,
      InstanceIdList: [`${domain}|${httpsBillingSwitch}`],
      ResourceType: "cdn",
    });
  }

  async describeDeployRecord(deployRecordId) {
    return clientCall(this.sslClient, "DescribeHostDeployRecordDetail", {
      DeployRecordId: String(deployRecordId),
      Offset: 0,
      Limit: 200,
    });
  }

  async rollbackDeploy(deployRecordId) {
    return clientCall(this.sslClient, "DeployCertificateRecordRollback", {
      DeployRecordId: Number(deployRecordId),
    });
  }
}

export async function createTencentCloudGateway(credentials, { sdkModule } = {}) {
  const imported = sdkModule ?? await import("tencentcloud-sdk-nodejs");
  const sdk = imported.default ?? imported;
  const SslClient = sdk?.ssl?.v20191205?.Client;
  const CdnClient = sdk?.cdn?.v20180606?.Client;
  if (!SslClient || !CdnClient) {
    throw new Error("Installed tencentcloud-sdk-nodejs does not expose SSL v20191205 and CDN v20180606 clients");
  }

  const credential = {
    secretId: credentials.secretId,
    secretKey: credentials.secretKey,
    ...(credentials.token ? { token: credentials.token } : {}),
  };
  const options = (endpoint) => ({
    credential,
    region: "",
    profile: {
      httpProfile: {
        endpoint,
        reqTimeout: 30,
      },
      signMethod: "TC3-HMAC-SHA256",
    },
  });
  return new TencentCloudGateway({
    cdnClient: new CdnClient(options("cdn.tencentcloudapi.com")),
    sslClient: new SslClient(options("ssl.tencentcloudapi.com")),
  });
}
