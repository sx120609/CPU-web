/**
 * 理论课都在教学楼上，教室号本身就带楼栋（A–E）：「教学楼A102」只写「A102」。
 * 别的地点（实验楼、体育馆、教学楼后面不是楼栋加房号的）原样保留。
 * 只用在给人看的输出上（小组件、推送、图片）；课程数据不动，隐藏和编辑记录按原始地点认课。
 */
export function classroomOnly(value: unknown): string {
  const location = String(value ?? "").trim();
  return location.replace(/^教学楼\s*(?=[A-Ea-e]\s*[-－]?\s*\d)/u, "") || location;
}
