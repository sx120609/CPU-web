import { ChatDotRound, DocumentChecked, Tools } from "@element-plus/icons-vue";
import type { Component } from "vue";

export type ServiceToolStatus = "ready" | "planned";

export interface ServiceTool {
  slug: string;
  name: string;
  summary: string;
  description: string;
  icon: string;
  status: ServiceToolStatus;
  category: string;
  routeName: string;
  componentKey: "feedback" | "placeholder";
  accent: string;
  iconComponent: Component;
}

export const serviceTools: ServiceTool[] = [
  {
    slug: "feedback",
    name: "需求反馈",
    summary: "先把校园服务里的工具想法集中收集起来",
    description: "用于承接后续工具需求、使用建议和问题反馈，之后可以替换为完整的在线问卷能力。",
    icon: "💬",
    status: "ready",
    category: "反馈",
    routeName: "service-tool-detail",
    componentKey: "feedback",
    accent: "#168776",
    iconComponent: ChatDotRound,
  },
  {
    slug: "questionnaire",
    name: "在线问卷",
    summary: "预留问卷发布、填写与结果统计入口",
    description: "后续可扩展问卷编辑器、链接分享、匿名填写和数据导出等能力。",
    icon: "📝",
    status: "planned",
    category: "表单",
    routeName: "service-tool-detail",
    componentKey: "placeholder",
    accent: "#d97706",
    iconComponent: DocumentChecked,
  },
];

export const toolHubIntro = {
  title: "校园小工具",
  subtitle: "一些轻量入口会集中放在这里，适合处理反馈、表单和临时查询这类小任务。",
  iconComponent: Tools,
};

export function findServiceTool(slug: string) {
  return serviceTools.find((tool) => tool.slug === slug);
}
