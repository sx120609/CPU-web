import type { Component } from "vue";
import type { FeatureKey } from "@/api/site";

export type GuideHue = "brand" | "blue" | "amber" | "green" | "violet" | "orange";

/** 拾间的客户端；章节或条目只讲某个客户端时标上，别的客户端里按上架规则不露出。 */
export type GuideClient = "android" | "harmony" | "ios" | "desktop" | "next";

/** 章节、条目的显示条件：全部满足才显示。都不写就是人人可见。 */
export interface GuideNeeds {
  /** 本校开着这个路径所属的功能（学校档案的 pages）。 */
  path?: string;
  /** 本校开着这个小工具（data/serviceTools.ts 的 slug），并且后台没有隐藏它。 */
  tool?: string;
  /** 后台的站点功能开关。 */
  feature?: FeatureKey;
  /** 拾间的客户端服务本校（"any"）；写了具体客户端时，上架的 iOS、鸿蒙 App 里只显示自己的，NEXT 只在 NEXT 里显示。 */
  client?: GuideClient | "any";
  /** 随客户端上架规则隐藏的内容。 */
  shelf?: "forum" | "miniGames" | "assistant" | "commerce" | "downloads";
}

export interface GuideLink {
  label: string;
  to: string;
}

/** 一个操作：标题平时就看得到，其余点开才显示。 */
export interface GuideTopic {
  id: string;
  title: string;
  /** 标题旁的小标签，如“需登录”“仅 App”。 */
  tag?: string;
  /** 说明文字，每项一段。 */
  body?: string[];
  /** 按顺序做的步骤。 */
  steps?: string[];
  /** 补充提醒。 */
  tips?: string[];
  link?: GuideLink;
  needs?: GuideNeeds;
}

export interface GuideChapter {
  id: string;
  group: string;
  title: string;
  summary: string;
  hue: GuideHue;
  icon: Component;
  /** 搜索时额外匹配的说法。 */
  keywords?: string[];
  intro?: string[];
  /** 章首的直达按钮。 */
  entry?: GuideLink;
  needs?: GuideNeeds;
  topics: GuideTopic[];
}
