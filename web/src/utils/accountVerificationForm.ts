type AccountVerificationApplicationDraft = {
  requestedLabel: string;
  identityDescription: string;
  evidence: string;
  acknowledged: boolean;
};

export function accountVerificationApplicationIssue(draft: AccountVerificationApplicationDraft) {
  if (draft.requestedLabel.trim().length < 2) return "认证名称至少填写 2 个字";
  if (draft.identityDescription.trim().length < 10) return "身份说明至少填写 10 个字";
  if (draft.evidence.trim().length < 10) {
    return "可核验信息至少填写 10 个字；如暂无公开资料，请说明管理员可以通过什么方式核验";
  }
  if (!draft.acknowledged) return "请先勾选真实性确认";
  return "";
}
