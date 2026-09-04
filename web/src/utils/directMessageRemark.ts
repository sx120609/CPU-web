import { ElMessage, ElMessageBox } from "element-plus";
import { directMessageApi } from "@/api/directMessage";

export type DirectMessageRemarkEditResult = {
  changed: boolean;
  remark: string | null;
};

export async function promptDirectMessageRemark(input: {
  userId: number;
  nickname: string;
  currentRemark?: string | null;
}): Promise<DirectMessageRemarkEditResult> {
  try {
    const { value } = await ElMessageBox.prompt(
      `给“${input.nickname}”设置仅自己可见的备注。留空保存即可清除备注。`,
      "设置用户备注",
      {
        inputValue: input.currentRemark || "",
        inputPlaceholder: "例如：药学院小王",
        confirmButtonText: "保存",
        cancelButtonText: "取消",
        distinguishCancelAndClose: true,
        inputValidator: (raw: string) => {
          const remark = String(raw || "").trim();
          if (/[\r\n]/u.test(remark)) return "备注不能换行";
          return remark.length <= 24 || "备注最多 24 个字";
        },
      },
    );
    const remark = String(value || "").trim() || null;
    const result = await directMessageApi.setRemark(input.userId, remark, { suppressErrorMessage: true });
    ElMessage.success(result.remark ? "备注已保存" : "备注已清除");
    return { changed: true, remark: result.remark };
  } catch (error) {
    if (error === "cancel" || error === "close") return { changed: false, remark: input.currentRemark || null };
    const message = (error as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (error as { message?: string })?.message
      || "备注保存失败";
    ElMessage.error(message);
    return { changed: false, remark: input.currentRemark || null };
  }
}
