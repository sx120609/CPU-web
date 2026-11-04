# CPU Date OAuth2 对接

CPU Date 使用服务客户端 `cpudate`，固定回调为 `https://cpudate.com/auth/sso/callback`。
授权范围为 `openid profile`，换取 token 时同时提交 `client_secret` 与 S256 PKCE 的 `code_verifier`。
密钥仅保存在双方服务器，CPU Date 对应变量为 `SSO_CLIENT_SECRET`。

## 用户资料与自动绑定

以 CPU Date 的 access token 调用 `GET /api/oauth/userinfo`，读取响应的 `data`：

```json
{
  "code": 0,
  "data": {
    "sub": "123",
    "user": {
      "id": 123,
      "studentId": "2020260001",
      "studentSso": true,
      "schoolId": "cpu",
      "nickname": "示例昵称",
      "avatar": "https://cputime.cn/api/user-avatars/123?v=0123456789abcdef"
    }
  },
  "message": ""
}
```

- `user.studentId` 是学校统一认证验证过的学号，保持字符串格式，包括前导零。未经学校认证的账号返回 `null`，`user.studentSso` 为 `false`。
- `user.schoolId` 是学校标识，药大为 `cpu`。学号仅在所属学校内唯一；仅服务药大的 CPU Date 应检查此值，避免跨校同号误绑定。
- CPU Date 可在 `studentSso === true`、`schoolId === "cpu"` 且 `studentId` 非空时，直接使用该学号完成绑定，跳过重复输入学号和验证页面。仍须执行自己的 OAuth `state` 与 PKCE 校验。
- `user.avatar` 是可供外站访问的完整 HTTP(S) URL，没有头像时为 `null`。上传的内联头像会转换为主站的公开头像资源 URL。
- 用 `sub` 保存 CPU-web 账号关联；如果既有学号已绑定另一个 `sub`，应走账号冲突处理，不能直接覆盖已有绑定。`sub` 仍为当前数据库的 `User.id`，本次未新增 UUID。

学号及学校认证字段仅向 `cpudate` 客户端提供。其他服务客户端的响应保持原有格式。
CPU-web 提供资料接口；CPU Date 需要消费上述字段，才能完成其页面上的自动绑定和头像同步。
