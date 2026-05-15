const REMOVED_SERVICE_CODES = ["CARD_PORTAL", "DORM_ELEC", "LIB_SEAT", "HEALTH_CLINIC"];

export function visibleServiceWhere(extra: Record<string, any> = {}) {
  return {
    ...extra,
    hidden: false,
    code: { notIn: REMOVED_SERVICE_CODES },
  };
}

export function normalizeServiceCard<T extends Record<string, any>>(card: T): T {
  if (card.code !== "ACAD_PORTAL") return card;
  return {
    ...card,
    name: "教务数据",
    category: "教务",
    owner: "教务处",
    icon: "🎓",
    url: "/jwxt",
    needSso: true,
    description: "在站内查看课表、成绩和培养方案",
    materials: "学校统一认证账号",
  };
}
