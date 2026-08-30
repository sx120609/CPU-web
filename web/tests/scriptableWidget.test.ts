import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildScriptableWidgetScript } from "../src/views/schedule/scriptableWidget";

test("Scriptable widget keeps tomorrow's date monotonic at a Sunday boundary", async () => {
  const fixedNow = new Date("2026-08-30T04:39:00.000Z").getTime();
  const payload = {
    week: 1,
    strictDate: true,
    generatedAt: "2026-08-30T04:39:00.000Z",
    today: null as any,
    days: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      label: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][index],
      date: `2026-08-${String(24 + index).padStart(2, "0")}`,
      courses: [],
    })),
  };
  payload.today = payload.days[6];

  class FixedDate extends Date {
    constructor(value?: string | number) {
      super(value === undefined ? fixedNow : value);
    }

    static now() {
      return fixedNow;
    }
  }

  class TextContainer {
    texts: string[];

    constructor(texts: string[] = []) {
      this.texts = texts;
    }

    addText(value: string) {
      this.texts.push(String(value));
      return {};
    }

    addSpacer() {}

    addStack() {
      return new TextContainer(this.texts);
    }
  }

  let rendered: TextContainer | undefined;
  class ListWidget extends TextContainer {
    setPadding() {}

    async presentMedium() {}
  }

  class Request {
    timeoutInterval = 0;

    constructor(_endpoint: string) {}

    async loadJSON() {
      return { code: 0, data: payload };
    }
  }

  class DateFormatter {
    locale = "";
    dateFormat = "";

    string(date: Date) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    }
  }

  const source = buildScriptableWidgetScript("https://example.test/widget");
  await vm.runInNewContext(`(async () => { ${source} })()`, {
    Date: FixedDate,
    DateFormatter,
    Request,
    ListWidget,
    Color: class Color {
      constructor(_value: string) {}
      static dynamic(light: unknown) { return light; }
    },
    Font: {
      boldSystemFont: () => ({}),
      mediumSystemFont: () => ({}),
      systemFont: () => ({}),
    },
    Size: class Size {
      constructor(_width: number, _height: number) {}
    },
    config: { widgetFamily: "large", runsInWidget: true },
    Script: {
      setWidget(widget: TextContainer) { rendered = widget; },
      complete() {},
    },
  });

  assert.ok(rendered);
  assert.ok(rendered.texts.includes("周日 08/30"));
  assert.ok(rendered.texts.includes("周一 08/31"));
  assert.ok(!rendered.texts.includes("周一 08/24"));
});
