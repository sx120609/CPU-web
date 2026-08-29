import assert from "node:assert/strict";
import test from "node:test";
import { TencentCloudGateway, createTencentCloudGateway } from "../src/tencent-cloud.mjs";

function fakeClient(responses, calls) {
  return new Proxy({}, {
    get: (_target, method) => async (params) => {
      calls.push({ method, params });
      return responses[method] ?? {};
    },
  });
}

test("official client wrapper maps CDN, SSL application, deploy, poll, and rollback parameters", async () => {
  const calls = [];
  const cdnClient = fakeClient({
    DescribeDomainsConfig: {
      Domains: [{
        Domain: "img.cputime.cn",
        ResourceId: "cdn-2o4qgm9j",
        Status: "online",
        Https: { Switch: "on", CertInfo: { CertId: "old", ExpireTime: "2026-02-01 08:00:00" } },
        HttpsBilling: { Switch: "on" },
      }],
    },
  }, calls);
  const sslClient = fakeClient({
    ApplyCertificate: { CertificateId: "new" },
    DeployCertificateInstance: { DeployRecordId: 12 },
    DescribeHostDeployRecordDetail: { TotalCount: 1 },
    DeployCertificateRecordRollback: { DeployRecordId: 13 },
  }, calls);
  const gateway = new TencentCloudGateway({ cdnClient, sslClient });

  const current = await gateway.describeCdnDomain("img.cputime.cn");
  assert.equal(current.resourceId, "cdn-2o4qgm9j");
  assert.equal(current.certificateId, "old");
  await gateway.applyFreeCertificate("img.cputime.cn");
  await gateway.deployCertificate({ certificateId: "new", domain: "img.cputime.cn", httpsBillingSwitch: "on" });
  await gateway.describeDeployRecord(12);
  await gateway.rollbackDeploy(12);

  assert.deepEqual(calls[0].params.Filters, [{ Name: "domain", Value: ["img.cputime.cn"], Fuzzy: false }]);
  assert.deepEqual(calls[1].params, {
    DvAuthMethod: "DNS_AUTO",
    DomainName: "img.cputime.cn",
    PackageType: "83",
    ValidityPeriod: "3",
    CsrEncryptAlgo: "RSA",
  });
  assert.deepEqual(calls[2].params, {
    CertificateId: "new",
    InstanceIdList: ["img.cputime.cn|on"],
    ResourceType: "cdn",
  });
  assert.equal(calls[3].params.DeployRecordId, "12");
  assert.equal(calls[4].params.DeployRecordId, 12);
});

test("gateway factory uses the official SDK service versions and temporary token", async () => {
  const constructed = [];
  class SslClient { constructor(options) { constructed.push({ service: "ssl", options }); } }
  class CdnClient { constructor(options) { constructed.push({ service: "cdn", options }); } }
  const gateway = await createTencentCloudGateway({ secretId: "id", secretKey: "key", token: "temporary" }, {
    sdkModule: { ssl: { v20191205: { Client: SslClient } }, cdn: { v20180606: { Client: CdnClient } } },
  });
  assert.ok(gateway instanceof TencentCloudGateway);
  assert.deepEqual(constructed.map((entry) => entry.service), ["cdn", "ssl"]);
  assert.equal(constructed[0].options.credential.token, "temporary");
  assert.equal(constructed[0].options.profile.signMethod, "TC3-HMAC-SHA256");
  assert.equal(constructed[0].options.profile.httpProfile.endpoint, "cdn.tencentcloudapi.com");
  assert.equal(constructed[1].options.profile.httpProfile.endpoint, "ssl.tencentcloudapi.com");
});
