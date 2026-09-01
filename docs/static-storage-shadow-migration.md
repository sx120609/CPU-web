# 腾讯 COS 到阿里 OSS 待命镜像

## 当前决定

截至 2026-09-01，腾讯云 COS/CDN 继续作为生产静态资源入口。阿里云 OSS 与 ESA 保留为待命方案，不切换站点存储提供方，也不修改现有 `img.cputime.cn` 流量。

已完成的首轮迁移包含 35,048 个对象、7,330,758,614 字节。后续部署通过增量镜像补齐新对象，避免下次切换前再次全量搬运。

## 部署行为

`deploy.sh` 在同步 Web 静态资源后运行 `server/dist/scripts/copyTencentCosToAliyunOss.js`：

- 只复制 OSS 中尚不存在的对象 Key。
- OSS 中同名且一致的对象直接复用。
- 同名但大小或可比较 ETag 不一致时保留 OSS 原对象并告警，不覆盖、不删除。
- 上传使用 OSS 禁止覆盖条件，避免并发任务在清单生成后覆盖新对象。
- 下载后校验 COS 大小和可比较 MD5，上传后再次校验 OSS 大小和可比较 MD5。
- COS、OSS 任一未配置时安全跳过。
- 镜像失败只产生部署告警，不影响腾讯云交付、站点启动或部署健康状态。

默认开启。需要临时停用时，在部署进程环境或 `server/.env` 中设置：

```dotenv
COS_TO_OSS_SHADOW_MIRROR=0
```

手工检查或补同步：

```bash
cd server
npm run storage:copy-cos-to-oss -- --dry-run
npm run storage:copy-cos-to-oss
```

可用 `--limit=N` 限制单次待复制对象数量。访问密钥只保存在生产配置或管理后台，禁止写入仓库；OSS 身份只需要列举、读取和禁止覆盖写入权限，不应授予删除权限。

正式改用 ESA/OSS 仍是独立操作，必须另行确认并完成域名、存储提供方、公开读取、Range/CORS 和回退验证。本次自动镜像不会触发正式切换。
