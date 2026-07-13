import { Calendar, ChatDotRound, Compass, DataLine, Document, DocumentChecked, FolderOpened, Microphone, Tools } from "@element-plus/icons-vue";
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
  componentKey: "feedback" | "questionnaire" | "grade_check" | "file_collect" | "pdf_tools" | "school_calendar" | "lost_found" | "voicehub";
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
    status: "ready",
    category: "表单",
    routeName: "service-tool-detail",
    componentKey: "questionnaire",
    accent: "#d97706",
    iconComponent: DocumentChecked,
  },
  {
    slug: "grade_check",
    name: "成绩表核对",
    summary: "上传 Excel 后按学号开放个人查询",
    description: "发起者上传带有学号字段的成绩或信息表，学生登录后只能查看自己学号对应的记录。",
    icon: "📊",
    status: "ready",
    category: "查询",
    routeName: "service-tool-detail",
    componentKey: "grade_check",
    accent: "#2563eb",
    iconComponent: DataLine,
  },
  {
    slug: "file_collect",
    name: "文件收集",
    summary: "集中收作业、材料和照片",
    description: "发起者创建收集任务并分享提交链接，系统负责字段校验、文件命名、提交统计和批量下载。",
    icon: "📁",
    status: "ready",
    category: "收集",
    routeName: "service-tool-detail",
    componentKey: "file_collect",
    accent: "#0f766e",
    iconComponent: FolderOpened,
  },
  {
    slug: "pdf_tools",
    name: "PDF 工具",
    summary: "合并、拆分、压缩、转图片和提取文字",
    description: "浏览器本地处理常见 PDF 操作，适合整理作业、通知和课程材料。",
    icon: "📄",
    status: "ready",
    category: "文件",
    routeName: "service-tool-detail",
    componentKey: "pdf_tools",
    accent: "#0f766e",
    iconComponent: Document,
  },
  {
    slug: "school_calendar",
    name: "药大校历",
    summary: "查看官方校历、学期周次、假期和关键节点",
    description: "整理中国药科大学官方校历，保留原图，同时把学期、假期和重要日期拆成更容易查看的卡片。",
    icon: "校",
    status: "ready",
    category: "校历",
    routeName: "service-tool-detail",
    componentKey: "school_calendar",
    accent: "#7c3aed",
    iconComponent: Calendar,
  },
  {
    slug: "lost_found",
    name: "失物招领",
    summary: "公开找物与招领信息，登录后私下提交认领",
    description: "按校区、地点、时间和认领状态查找信息，并与论坛讨论和站内消息联动。",
    icon: "🧭",
    status: "ready",
    category: "校园互助",
    routeName: "lost-found",
    componentKey: "lost_found",
    accent: "#0f8f7b",
    iconComponent: Compass,
  },
  {
    slug: "voicehub",
    name: "药苑之声",
    summary: "校园广播站点歌、投票、播出排期与沉浸式歌词播放",
    description: "完整接入广播站点歌系统，可查看播出排期、提交歌曲、参与投票，并由广播站统一审核与安排播放。",
    icon: "声",
    status: "ready",
    category: "校园广播",
    routeName: "service-voicehub",
    componentKey: "voicehub",
    accent: "#dc2626",
    iconComponent: Microphone,
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
