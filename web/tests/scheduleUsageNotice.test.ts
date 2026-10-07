import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { effectScope, ref } from "vue";
import { useScheduleUsageNotice } from "../src/views/schedule/useScheduleUsageNotice";

function setup(t: TestContext, storageUnavailable = false) {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 10000 });
  const saved = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => {
        if (storageUnavailable) throw new Error("Storage unavailable");
        return saved.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (storageUnavailable) throw new Error("Storage unavailable");
        saved.set(key, value);
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const user = ref<{ id: number; username: string } | null>(null);
  function mount() {
    const scope = effectScope();
    const notice = scope.run(() => useScheduleUsageNotice(() => user.value))!;
    t.after(() => scope.stop());
    return { ...notice, unmount: () => scope.stop() };
  }
  return { user, saved, mount };
}

test("only the requested prefix sees the notice, including after asynchronous login", (t) => {
  const { user, mount } = setup(t);
  const notice = mount();
  assert.equal(notice.visible.value, false);
  for (const username of ["2020250001", "12020260001", "admin", ""]) {
    user.value = { id: 1, username };
    assert.equal(notice.visible.value, false);
  }
  user.value = { id: 1, username: "2020260001" };
  assert.equal(notice.visible.value, true);
  user.value = null;
  assert.equal(notice.visible.value, false);
});

test("confirmation requires three full seconds after opening and persists per account", (t) => {
  const { user, saved, mount } = setup(t);
  user.value = { id: 2, username: "2020260002" };
  const notice = mount();
  t.mock.timers.tick(10000);
  notice.acknowledge();
  assert.equal(notice.visible.value, true, "time before the opening animation finishes does not count");
  assert.equal(saved.size, 0);
  notice.beginReading();
  t.mock.timers.tick(2999);
  notice.acknowledge();
  assert.equal(notice.visible.value, true);
  assert.equal(notice.secondsLeft.value, 1);
  assert.equal(saved.size, 0);
  t.mock.timers.tick(1);
  assert.equal(notice.secondsLeft.value, 0);
  notice.acknowledge();
  assert.equal(notice.visible.value, false);
  assert.equal(saved.get("cpu-schedule-usage-notice-202026-v1:2"), "1");
  notice.unmount();
  const remounted = mount();
  assert.equal(remounted.visible.value, false);
  user.value = { id: 3, username: "2020260003" };
  assert.equal(remounted.visible.value, true, "another account must acknowledge separately");
  remounted.acknowledge();
  assert.equal(remounted.visible.value, true);
  user.value = { id: 4, username: "2020260004" };
  saved.set("cpu-schedule-usage-notice-202026-v1:5", "1");
  user.value = { id: 5, username: "2020260005" };
  assert.equal(remounted.visible.value, false, "a persisted acknowledgement is respected");
});

test("leaving before confirmation or switching accounts resets the countdown", (t) => {
  const { user, saved, mount } = setup(t);
  user.value = { id: 6, username: "2020260006" };
  const notice = mount();
  notice.beginReading();
  t.mock.timers.tick(1000);
  assert.equal(notice.secondsLeft.value, 2);
  notice.unmount();
  t.mock.timers.tick(5000);
  assert.equal(notice.secondsLeft.value, 2, "unmount clears the timer");
  assert.equal(saved.size, 0);
  const remounted = mount();
  assert.equal(remounted.visible.value, true);
  assert.equal(remounted.secondsLeft.value, 3);
  remounted.beginReading();
  t.mock.timers.tick(1000);
  user.value = { id: 7, username: "2020260007" };
  assert.equal(remounted.secondsLeft.value, 3);
  t.mock.timers.tick(2999);
  remounted.acknowledge();
  assert.equal(remounted.visible.value, true, "another account cannot inherit the old deadline");
  t.mock.timers.tick(1);
  remounted.acknowledge();
  assert.equal(remounted.visible.value, false, "switching an open dialog restarts the reading time");
});

test("unavailable storage does not prevent closing and remembers acknowledgement during this session", (t) => {
  const { user, mount } = setup(t, true);
  user.value = { id: 8, username: "2020260008" };
  const notice = mount();
  assert.equal(notice.visible.value, true);
  notice.beginReading();
  t.mock.timers.tick(3000);
  notice.acknowledge();
  assert.equal(notice.visible.value, false);
  notice.unmount();
  assert.equal(mount().visible.value, false);
});
