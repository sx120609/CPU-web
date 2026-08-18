import assert from "node:assert/strict";
import test from "node:test";
import { runWithAiProviderIsolation } from "../src/services/aiUpstreamScheduler";

function nextTurn() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("取消正在处理的 Ollama 请求不会让同端点的后续请求一起取消", async () => {
  const endpoint = "http://scheduler-cancel-test.local:11434/v1/chat/completions";
  const firstController = new AbortController();
  let firstStarted = false;
  let secondStarted = false;
  const first = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    signal: firstController.signal,
    run: () => new Promise<string>((_resolve, reject) => {
      firstStarted = true;
      firstController.signal.addEventListener("abort", () => reject(firstController.signal.reason), { once: true });
    }),
  });
  await nextTurn();
  assert.equal(firstStarted, true);

  const second = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    run: async () => {
      secondStarted = true;
      return "second";
    },
  });
  await nextTurn();
  assert.equal(secondStarted, true);

  firstController.abort(new Error("客户端已断开连接"));
  await assert.rejects(first, /客户端已断开连接/u);
  assert.equal(await second, "second");
  assert.equal(secondStarted, true);
});

test("取消排队中的 Ollama 请求只移除自己的队列项", async () => {
  const endpoint = "http://scheduler-queue-test.local:11434/v1/chat/completions";
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    run: () => new Promise<string>((resolve) => {
      releaseFirst = () => resolve("first");
    }),
  });
  await nextTurn();

  const second = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    run: () => new Promise<string>((resolve) => {
      releaseSecond = () => resolve("second");
    }),
  });
  await nextTurn();

  const queuedController = new AbortController();
  let queuedStarted = false;
  const queued = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    signal: queuedController.signal,
    run: async () => {
      queuedStarted = true;
      return "queued";
    },
  });
  let thirdStarted = false;
  const third = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    run: async () => {
      thirdStarted = true;
      return "third";
    },
  });
  await nextTurn();
  assert.equal(queuedStarted, false);
  assert.equal(thirdStarted, false);
  queuedController.abort(new Error("用户取消排队"));
  await assert.rejects(queued, /用户取消排队/u);

  releaseFirst();
  releaseSecond();
  assert.equal(await first, "first");
  assert.equal(await third, "third");
  assert.equal(await second, "second");
  assert.equal(queuedStarted, false);
  assert.equal(thirdStarted, true);
});

test("两个 Ollama 请求并行时，第三个请求可以继续排队", async () => {
  const endpoint = "http://scheduler-parallel-test.local:11434/v1/chat/completions";
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    run: () => new Promise<string>((resolve) => {
      releaseFirst = () => resolve("first");
    }),
  });
  const second = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    run: () => new Promise<string>((resolve) => {
      releaseSecond = () => resolve("second");
    }),
  });
  await nextTurn();

  let thirdStarted = false;
  const third = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    run: async () => {
      thirdStarted = true;
      return "third";
    },
  });
  await nextTurn();
  assert.equal(thirdStarted, false);

  releaseFirst();
  assert.equal(await first, "first");
  assert.equal(await third, "third");
  releaseSecond();
  assert.equal(await second, "second");
  assert.equal(thirdStarted, true);
});

test("流式响应在消费完成前保持 Ollama 服务槽位", async () => {
  const endpoint = "http://scheduler-stream-test.local:11434/v1/chat/completions";
  let releaseStream!: () => void;
  let releaseSecond!: () => void;
  const first = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    run: async () => "stream-response",
    holdActiveUntil: () => new Promise<void>((resolve) => {
      releaseStream = resolve;
    }),
  });
  assert.equal(await first, "stream-response");

  let secondStarted = false;
  const second = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    run: () => new Promise<string>((resolve) => {
      secondStarted = true;
      releaseSecond = () => resolve("second");
    }),
  });
  await nextTurn();
  assert.equal(secondStarted, true);
  let thirdStarted = false;
  const third = runWithAiProviderIsolation({
    provider: "ollama",
    endpoint,
    run: async () => {
      thirdStarted = true;
      return "third";
    },
  });
  await nextTurn();
  assert.equal(thirdStarted, false);
  releaseStream();
  await nextTurn();
  assert.equal(thirdStarted, true);
  assert.equal(await third, "third");
  releaseSecond();
  assert.equal(await second, "second");
});
