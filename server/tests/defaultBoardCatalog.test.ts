import assert from "node:assert/strict";
import test from "node:test";
import { COMMUNITY_BOARD_DEFS } from "../src/services/defaultBoardCatalog";

test("社群汇总板块带有稳定的默认图标", () => {
  const board = COMMUNITY_BOARD_DEFS.find((item) => item.slug === "group");

  assert.ok(board);
  assert.equal(board.name, "社群汇总");
  assert.equal(board.icon, "👥");
});
