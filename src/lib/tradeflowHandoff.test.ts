import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureTradeflowHandoff, getTradeflowJob, saveReportToTradeflow, takeTradeflowJobReference } from "./tradeflowHandoff";

function setLocation(pathAndQuery: string, hash = "") {
  window.history.replaceState(null, "", pathAndQuery + hash);
}

describe("tradeflowHandoff", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setLocation("/");
    vi.restoreAllMocks();
  });

  it("keeps the code and job, and removes the code from the address bar", () => {
    setLocation("/setout?jobReference=%23J-1029", "#tf=abc123");
    captureTradeflowHandoff();
    expect(getTradeflowJob()).toEqual({ jobReference: "#J-1029" });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?jobReference=%23J-1029");
  });

  it("does nothing when opened normally", () => {
    setLocation("/setout");
    captureTradeflowHandoff();
    expect(getTradeflowJob()).toBeNull();
  });

  it("gives the job number back for pre-filling only once", () => {
    setLocation("/setout?jobReference=%23J-1029", "#tf=abc123");
    captureTradeflowHandoff();
    expect(takeTradeflowJobReference()).toBe("#J-1029");
    expect(takeTradeflowJobReference()).toBeNull();
  });

  it("drops a code older than two hours", () => {
    sessionStorage.setItem("tradeflow_handoff", JSON.stringify({ code: "old", jobReference: null, savedAt: Date.now() - 3 * 60 * 60 * 1000 }));
    expect(getTradeflowJob()).toBeNull();
  });

  it("refuses to save without a code", async () => {
    await expect(saveReportToTradeflow(new Blob(["x"]), "Plan")).rejects.toThrow(/from the job in TradeFlow/);
  });

  it("prepares, uploads, then completes", async () => {
    setLocation("/setout?jobReference=%23J-1029", "#tf=abc123");
    captureTradeflowHandoff();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("setout-handoff")) {
          const body = JSON.parse(String(init?.body));
          calls.push(body.action);
          if (body.action === "prepare") return new Response(JSON.stringify({ uploadUrl: "https://upload.example/x", path: "b/j/f.pdf", jobNumber: "#J-1029" }), { status: 200 });
          return new Response(JSON.stringify({ ok: true, jobNumber: "#J-1029" }), { status: 200 });
        }
        calls.push("PUT");
        return new Response("{}", { status: 200 });
      })
    );
    await expect(saveReportToTradeflow(new Blob(["pdf"]), "Plan")).resolves.toBe("#J-1029");
    expect(calls).toEqual(["prepare", "PUT", "complete"]);
  });

  it("shows TradeFlow's message when the link has expired", async () => {
    setLocation("/setout", "#tf=abc123");
    captureTradeflowHandoff();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "expired", message: "This link has expired" }), { status: 410 })));
    await expect(saveReportToTradeflow(new Blob(["pdf"]), "Plan")).rejects.toThrow("This link has expired");
  });
});
