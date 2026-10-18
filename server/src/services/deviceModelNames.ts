/**
 * Market names for the model codes Android and HarmonyOS devices report in
 * `Build.MODEL` / `deviceInfo.productModel`. Huawei shares its codes between
 * both systems. Entries cover the codes seen in the admin statistics, plus the
 * other codes of the same models so that every variant of one phone is
 * counted together. A code that shares hardware between two products names
 * both. Unknown codes are shown as reported and listed for later additions.
 */
const MODEL_NAMES: Record<string, string> = {
  // Xiaomi / REDMI
  "22081212C": "Redmi K50 至尊版",
  "23113RKC6C": "Redmi K70",
  "23116PN5BC": "Xiaomi 14 Pro",
  "23127PN0CC": "Xiaomi 14",
  "23127PN0CG": "Xiaomi 14",
  "2410DPN6CC": "Xiaomi 15 Pro",
  "24117RK2CC": "REDMI K80",
  "24122RKC7C": "REDMI K80 Pro",
  "24129PN74C": "Xiaomi 15",
  "24129PN74G": "Xiaomi 15",
  "24129PN74I": "Xiaomi 15",
  "25060RK16C": "REDMI K80 至尊版",
  "25098PN5AC": "Xiaomi 17 Pro",
  "2509FPN0BC": "Xiaomi 17 Pro Max",
  "25102RK69C": "REDMI K90 Pro Max",
  "25102RKBEC": "REDMI K90 Pro Max",
  "2510DRK44C": "REDMI K90",
  "25113PN0EC": "Xiaomi 17",
  "25113PN0EG": "Xiaomi 17",
  "25113PN0EI": "Xiaomi 17",
  "2602EPTC0G": "Xiaomi 17T Pro",
  "2602EPTC0R": "Xiaomi 17T Pro",
  "2604FRK1EC": "REDMI K90 Max",
  "M025EC": "Xiaomi 17T Pro",
  // HUAWEI
  "ADA-AL00U": "HUAWEI nova 12 Ultra",
  "ADA-AL10U": "HUAWEI nova 12 Ultra",
  "ADY-AL00": "HUAWEI Pura 70",
  "ADY-AL10": "HUAWEI Pura 70",
  "ALN-AL00": "HUAWEI Mate 60 Pro",
  "ALN-AL10": "HUAWEI Mate 60 Pro+ / RS 非凡大师",
  "ALN-AL80": "HUAWEI Mate 60 Pro",
  "ALT-AL10": "HUAWEI Mate X5",
  "BRA-AL00": "HUAWEI Mate 60",
  "CHZ-AL00": "华为畅享 90 Pro Max",
  "CLS-AL00": "HUAWEI Mate 70",
  "CLS-AL30": "HUAWEI Mate 70",
  "CRS-AL00": "HUAWEI nova 16 Pro",
  "EMA-AL00U": "HUAWEI nova 16",
  "HBN-AL00": "HUAWEI Pura 70 Pro",
  "HBN-AL10": "HUAWEI Pura 70 Pro+",
  "HBN-AL80": "HUAWEI Pura 70 Pro+",
  "HED-AL00": "HUAWEI Pura 80",
  "KEE-AL00": "HUAWEI Pura 90",
  "KLE-AL00U": "HUAWEI nova 15 Pro",
  "LMR-AL00": "HUAWEI Pura 80 Pro",
  "LMR-AL10": "HUAWEI Pura 80 Pro+ / Ultra",
  "MIA-AL00": "HUAWEI nova 14 Pro",
  "MLN-AL00": "HUAWEI Pura 90 Pro",
  "MRT-AL10": "HUAWEI nova 14 Ultra",
  "PLA-AL10": "HUAWEI Mate 70 Pro+",
  "PLR-AL00": "HUAWEI Mate 70 Pro",
  "PLR-AL30": "HUAWEI Mate 70 Pro",
  "PLR-AL50": "HUAWEI Mate 70 Pro",
  "PSN-AL00": "HUAWEI nova 15",
  "SCA-AL00": "HUAWEI Pura 90 Pro Max",
  "SGT-AL00": "HUAWEI Mate 80 Pro",
  "SGT-AL10": "HUAWEI Mate 80 Pro Max",
  "SGT-AL50": "HUAWEI Mate 80 Pro",
  "SGU-AL10": "HUAWEI Mate 80 RS 非凡大师",
  "SLG-W10": "HUAWEI MatePad 11.5 S 2025",
  "SLG-W50": "HUAWEI MatePad 11.5 S 2025",
  "SLY-AL00": "HUAWEI nova 15 Ultra",
  "SUP-AL90": "HUAWEI Mate 70 Air",
  "TGR-W00": "HUAWEI MatePad 11.5 S",
  "TGR-W10": "HUAWEI MatePad 11.5 S",
  "TLR-AL00": "HUAWEI nova 14",
  "TXZ-AL10": "HUAWEI MatePad 11.5 (2026)",
  "TXZ-W10": "HUAWEI MatePad 11.5 (2026)",
  "TXZ-W20": "HUAWEI MatePad 11.5 (2026)",
  "VYG-AL00": "HUAWEI Mate 80",
  "VYG-AL30": "HUAWEI Mate 80",
  // HONOR
  "DNN-AN00": "荣耀 400",
  "DNP-AN00": "荣耀 400 Pro",
  "ELI-AN00": "荣耀 200",
  "ELP-AN00": "荣耀 200 Pro",
  "MAA-AN00": "荣耀 100",
  "MEP-AN00": "荣耀 500 Pro",
  "MTN-AN80": "荣耀 X70",
  "REA-AN00": "荣耀 90",
  "SER-AN00": "荣耀 WIN Turbo / Power2",
  "VKI-AN00": "荣耀 600 Pro",
  // OPPO
  "PHV110": "OPPO Reno10 Pro",
  "PHW110": "OPPO Reno10",
  "PKB110": "OPPO Find X8",
  "PLA110": "OPPO Reno14",
  "PLG110": "OPPO Find X9 Pro",
  "PLG120": "OPPO Find X9 Pro",
  "PLJ110": "OPPO Find X9",
  "PME110": "OPPO Find X9s Pro",
  "PMM110": "OPPO Reno16 / Reno16t",
  // vivo / iQOO
  "V2307A": "iQOO 12",
  "V2359A": "vivo X100s",
  "V2408A": "iQOO 13",
  "V2415A": "vivo X200",
  "V2443A": "vivo Y37t / Y50 / G3 等",
  "V2458A": "vivo X200s",
  "V2463A": "iQOO Neo10 Pro+",
  "V2464A": "vivo S30",
  "V2465A": "vivo S30 Pro mini",
  "V2505A": "iQOO 15",
  "V2507A": "iQOO Z10 Turbo+",
  "V2509A": "vivo X300",
  "V2520A": "iQOO Neo11",
  "V2528A": "vivo S50 / S50t",
  "V2548A": "vivo X300s",
  "V2571A": "vivo S60",
  // Others
  "NX789J": "红魔 10 Pro / 10S Pro",
  "SM-W7024": "三星 W24 Flip",
};

export function deviceModelName(model: string): string | null {
  return MODEL_NAMES[model.trim().toUpperCase()] ?? null;
}

export type DeviceModelGroup = {
  /** The group's most common code; a stable key for the row. */
  deviceModel: string;
  /** Every reported code of the model, most common first. */
  deviceModels: string[];
  /** Market name, or the code itself when it is not known. */
  name: string;
  named: boolean;
  count: number;
};

/**
 * Counts devices per model. Codes with the same market name form one row, so
 * a phone sold under several codes is counted once in the ranking.
 */
export function groupDeviceModels(models: Map<string, number>, nameOf: (model: string) => string | null): DeviceModelGroup[] {
  const groups = new Map<string, { name: string; named: boolean; count: number; codes: [string, number][] }>();
  for (const [model, count] of models) {
    const name = nameOf(model);
    const key = name ?? `\u0000${model}`;
    const group = groups.get(key) ?? { name: name ?? model, named: name != null, count: 0, codes: [] };
    group.count += count;
    group.codes.push([model, count]);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const codes = group.codes.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code]) => code);
      return { deviceModel: codes[0], deviceModels: codes, name: group.name, named: group.named, count: group.count };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
