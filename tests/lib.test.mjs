// Run:  node --experimental-strip-types --test tests/     (Node 22.6+; no dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHistory, checkPassword, fitMeta, fold, groupConversations, initials, isValidEmail, refreshDelayMs, relativeTime, restoreMessage, slimMeta,
} from "../src/lib.ts";

const NOW = new Date(2026, 10, 22, 15, 0, 0); // local time: 22 Nov 2026, 15:00
const at = (daysAgo, hour = 10) => new Date(2026, 10, 22 - daysAgo, hour, 0, 0).toISOString();
const conv = (id, title, daysAgo, pinned = false) => ({ id, title, pinned, messageCount: 2, createdAt: at(daysAgo), updatedAt: at(daysAgo) });

test("fold removes Vietnamese accents", () => {
  assert.equal(fold("Điều 5 – Mức phạt"), "dieu 5 – muc phat");
  assert.equal(fold("ĐÈN ĐỎ"), "den do");
});

test("initials", () => {
  assert.equal(initials("Nguyễn Văn An"), "NA");
  assert.equal(initials("an"), "A");
  assert.equal(initials("  "), "?");
  assert.equal(initials("Đặng Thu"), "ĐT");
});

test("conversations are grouped: pinned first, then by day", () => {
  const list = [conv("a", "Hôm nay", 0), conv("b", "Hôm qua", 1), conv("c", "Tuần này", 5), conv("d", "Tháng này", 20), conv("e", "Cũ", 90), conv("f", "Ghim", 40, true)];
  const g = groupConversations(list, NOW);
  assert.deepEqual(g.map((s) => s.label), ["Đã ghim", "Hôm nay", "Hôm qua", "7 ngày qua", "30 ngày qua", "Cũ hơn"]);
  assert.deepEqual(g[0].items.map((c) => c.id), ["f"]);
});

test("sidebar search ignores case and accents, empty sections disappear", () => {
  const list = [conv("a", "Mức phạt vượt đèn đỏ", 0), conv("b", "Thuế thu nhập", 1)];
  assert.deepEqual(groupConversations(list, NOW, "MUC PHAT").flatMap((s) => s.items.map((c) => c.id)), ["a"]);
  assert.deepEqual(groupConversations(list, NOW, "đèn"), groupConversations(list, NOW, "den"));
  assert.equal(groupConversations(list, NOW, "zzz").length, 0);
});

test("relative time", () => {
  const ago = (s) => new Date(NOW.getTime() - s * 1000).toISOString();
  assert.equal(relativeTime(ago(20), NOW), "vừa xong");
  assert.equal(relativeTime(ago(300), NOW), "5 phút trước");
  assert.equal(relativeTime(ago(7200), NOW), "2 giờ trước");
  assert.equal(relativeTime(ago(3 * 86400), NOW), "3 ngày trước");
  assert.match(relativeTime(at(40), NOW), /^\d\d\/\d\d\/2026$/);
});

const res = {
  answer: "Mức phạt là ... [1]", grounded: true, confidence: 0.71, retrieved: 5, refusal_reason: null, retrieval_mode: "hybrid+rerank",
  search_query: null, model: "gpt-6.2-sol", answer_mode: "documents", latency_ms: { retrieval_ms: 100, generation_ms: 900, total_ms: 1000, stages: { embed_ms: 5 } },
  citations: [{ id: 1, doc_name: "d", doc_label: "NĐ 168", chapter: "", article: "7", article_title: "t", clause: "", score: 0.8, snippet: "x".repeat(2000) }],
  agent: { route: "documents", attempts: 1, queries: [], steps: [{ node: "plan", summary: "s", ms: 1 }], verification: { status: "ok", cited: [1], invalid_markers: [], unsupported_numbers: [] }, llm_calls: 3, tools: "search" },
};

test("an answer survives save and restore, without the heavy parts", () => {
  const meta = slimMeta("agent", res);
  assert.equal(meta.citations[0].snippet.length, 401); // 400 chars + the ellipsis
  assert.ok(!JSON.stringify(meta).includes("steps"));
  const back = restoreMessage({ id: "m", seq: 2, role: "assistant", text: res.answer, meta, createdAt: "" }, 7);
  assert.equal(back.id, 7);
  assert.equal(back.meta.model, "gpt-6.2-sol");
  assert.equal(back.meta.latency_ms.total_ms, 1000);
  assert.equal(back.meta.agent.llm_calls, 3);
  assert.equal(back.meta.agent.verification.status, "ok");
  assert.equal(back.citations[0].article, "7");
});

test("search results and plain messages restore too", () => {
  const meta = slimMeta("search", { citations: res.citations, latency_ms: { retrieval_ms: 0, generation_ms: 0, total_ms: 42 } });
  const back = restoreMessage({ id: "m", seq: 2, role: "assistant", text: "1 đoạn", meta, createdAt: "" }, 1);
  assert.equal(back.searchMs, 42);
  assert.equal(back.meta, undefined);
  assert.deepEqual(restoreMessage({ id: "u", seq: 1, role: "user", text: "hi", createdAt: "" }, 3), { id: 3, role: "user", text: "hi" });
  assert.deepEqual(restoreMessage({ id: "a", seq: 2, role: "assistant", text: "old", createdAt: "" }, 4), { id: 4, role: "assistant", text: "old" });
});

test("oversized meta is trimmed by dropping citations, not rejected", () => {
  const big = slimMeta("chat", { ...res, citations: Array.from({ length: 10 }, (_, i) => ({ ...res.citations[0], id: i + 1 })) });
  const fitted = fitMeta(big, 2500);
  assert.ok(JSON.stringify(fitted).length <= 2500);
  assert.ok(fitted.citations.length < 10 && fitted.citations.length > 0);
});

test("history keeps only good chat turns, the last 6", () => {
  const msgs = [];
  let id = 1;
  const turn = (q, a, extra = {}) => msgs.push({ id: id++, role: "user", text: q }, { id: id++, role: "assistant", text: a, ...extra });
  for (let i = 0; i < 8; i++) turn(`q${i}`, `a${i}`);
  turn("bad", "", { error: "x" });
  turn("blocked", "no", { meta: { answer_mode: "blocked" } });
  turn("search", "3 đoạn", { searchMs: 5 });
  const h = buildHistory(msgs);
  assert.equal(h.length, 12);
  assert.deepEqual(h[0], { role: "user", content: "q2" });
  assert.deepEqual(h.at(-1), { role: "assistant", content: "a7" });
});

test("email and password checks", () => {
  assert.ok(isValidEmail("an@example.com") && !isValidEmail("an@") && !isValidEmail("a b@x.vn"));
  assert.equal(checkPassword("short").ok, false);
  assert.equal(checkPassword("password1234").ok, false);
  assert.equal(checkPassword("aaaaaaaaaaaa").ok, false);
  assert.equal(checkPassword("nguyenvanan2026", "nguyenvanan@x.vn").ok, false);
  const good = checkPassword("Tr0ub4dor&Horse-Staple");
  assert.ok(good.ok && good.score >= 3);
  assert.ok(checkPassword("abcdefghijk1").score < good.score);
});

test("refresh happens a minute before expiry, never in a tight loop", () => {
  assert.equal(refreshDelayMs(900), 840_000);
  assert.equal(refreshDelayMs(30), 5_000);
  assert.equal(refreshDelayMs(0), 5_000);
});
