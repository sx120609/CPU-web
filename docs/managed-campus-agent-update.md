# 校内 systemd Agent 的远程更新

精简安装只含 GitHub 编译制品与运行依赖，没有 Git 仓库或 PM2。此时不要伪造仓库目录或改用本机编译；使用独立的 systemd 更新单元。

现有 Agent 应由非 root 用户运行，版本保存在安装根目录的 `releases/<版本>/server`，身份文件独立保存在 `/var/lib/<运行用户>/`。从已审查的提交安装更新器，例如：

```bash
sudo bash ops/deploy/install-managed-agent-updater.sh \
  /opt/cpu-jwxt-agent jwxt-agent-CPU-Server-03.service /opt/jwxt-node24/bin/node
sudo systemctl start jwxt-agent-CPU-Server-03-update.service
```

安装脚本备份原有 release 配置，保留已有 EnvironmentFile、服务用户和身份文件，不立即重启运行中的 Agent。第一次更新由管理员启动；加载包含托管更新支持的新制品后，后台“远程更新”通过 `JWXT_AGENT_UPDATE_REQUEST_FILE` 写入固定请求标记，独立的 systemd.path 单元执行更新。请求不能指定 shell 命令、下载地址、提交或服务名；运行中的 Agent 没有 sudo 或系统服务管理权限。

更新器固定读取 `sx120609/CPU-web` 的 main 完整 SHA，下载其 GitHub Release Linux 制品，核对清单、平台、Node.js 24、全部组件大小和 SHA-256，以及 Agent 内的完整 SHA 标记。运行依赖和 Prisma 客户端在新目录准备；不访问业务数据库、不在校内机器编译服务。制品缺失、校验失败或依赖失败时保持旧实例。

依赖清单与 Prisma schema 从绑定完整 SHA 的 GitHub Contents API 下载，避免校内出口重置 `raw.githubusercontent.com` 连接。Release 下载有受限镜像回退；所有传输仍必须通过同一 SHA 和组件校验。

制品准备成功后原子切换 `current`，重启现有服务，并等待新进程在网关注册。注册失败自动切回旧目录并验证旧实例注册。原版本目录保留以便恢复。更新执行器在独立 cgroup 中运行，Agent 的重启不会杀掉更新任务。

核验结果：

```bash
systemctl status jwxt-agent-CPU-Server-03-update.path
journalctl -u jwxt-agent-CPU-Server-03-update.service --no-pager
cat /var/lib/cpu-jwxt-agent/agent-remote-update.status.json
cat /opt/cpu-jwxt-agent/current/server/dist/deployment-commit.txt
```

`success` 只在精确 SHA 制品校验通过且 Agent 注册成功后记录。后台的“指令已下发”表示请求接受，不能当成更新完成；应核对上述状态和后台在线/身份状态。单次更新最多 20 分钟，失败或超时清理请求标记。连续失败触发 systemd 启动限速时，处理原因后执行 `systemctl reset-failed jwxt-agent-CPU-Server-03-update.service` 再重试。
