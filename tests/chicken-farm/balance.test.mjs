// Trại Gà — chốt chặn cân bằng: chạy mô phỏng nhỏ (tools/chicken-farm/balance-sim.mjs) trên CONFIG hiện tại
// và kiểm các mốc mà docs/chicken-farm/design-review.md dựa vào. Không kiểm số chính xác (mô phỏng có nhiễu),
// chỉ kiểm các bất biến thiết kế: không ngõ cụt khi chơi vừa phải, chăm thì đỡ đói hơn ghé thăm, cày không bị đói.
// ~2 giây trên 8 lõi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG } from "../../public/apps/chicken-farm/js/game/rules.js";
const R_MILESTONES = CONFIG.dex.milestones.length;
const SIM = fileURLToPath(new URL("../../tools/chicken-farm/balance-sim.mjs", import.meta.url));

test("cân bằng (mô phỏng 7 ngày, 8 ván/kiểu chơi): mốc thiết kế v5 còn đúng", () => {
  const dir = mkdtempSync(join(tmpdir(), "traiga-bal-"));
  try {
    const out = join(dir, "bal.json");
    execFileSync(process.execPath, [SIM, "--scenarios", "hien-tai", "--runs", "8", "--quiet", "--json", out], { stdio: "ignore", timeout: 120_000 });
    const A = JSON.parse(readFileSync(out, "utf8")).results["hien-tai"].archetypes;
    for (const k of ["casual", "engaged", "hardcore", "neglect"]) assert.equal(A[k].errors, 0, `${k}: lỗi khi chạy`);
    // Q11 (đổi 1 gà lấy 2 trứng): chơi ≥ 3 phiên/ngày thì không ngõ cụt
    for (const k of ["casual", "engaged", "hardcore"]) assert.ok(A[k].deadEnd <= 0.125, `${k}: ngõ cụt ${A[k].deadEnd}`);
    // trụ cột 3 "chăm thì được thưởng": chăm/cày gần như không đói; ghé thăm đói nhiều hơn chăm
    assert.ok(A.engaged.lifeShort.p50 < 0.1, `engaged mất ${A.engaged.lifeShort.p50} tuổi thọ vì đói`);
    assert.ok(A.hardcore.lifeShort.p50 < 0.05, `hardcore mất ${A.hardcore.lifeShort.p50} tuổi thọ vì đói`);
    assert.ok(A.casual.starving > A.engaged.starving, "ghé thăm phải đói nhiều hơn chăm");
    // v4: ghé thăm vẫn bị phạt nhưng không thành vòng xoáy chết đói (v3: 31% tuổi thọ, 46% thời gian bụng rỗng)
    assert.ok(A.casual.lifeShort.p50 < 0.28, `casual mất ${A.casual.lifeShort.p50} tuổi thọ vì đói`);
    assert.ok(A.casual.hatched.p50 >= 8, `casual chỉ nở ${A.casual.hatched.p50} gà / 7 ngày`);
    // Q14 (luật v5): gà con chờ trong ổ khi vắng → người chơi 1 lần/ngày không còn ngõ cụt (v4: 97%)
    assert.ok(A.neglect.deadEnd <= 0.125, `neglect: ngõ cụt ${A.neglect.deadEnd}`);
    // Q13 (luật v5): mốc sổ mở chuồng — tuần đầu đạt mốc 1 nhưng chưa xong hết (còn đích dài hạn)
    assert.ok(A.engaged.milestones.p50 >= 1, `engaged: ${A.engaged.milestones.p50} mốc`);
    assert.ok(A.hardcore.milestones.p50 < R_MILESTONES, "mọi mốc đạt trong 1 tuần — mốc quá dễ");
    // chuồng vẫn là giới hạn với người chơi chăm (chọn lọc gà là một phần lối chơi)
    assert.ok(A.engaged.caps.coopFullBlocked.runsHit > 0.5, "chuồng hết chặn ấp — xem lại design-review Q13");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
