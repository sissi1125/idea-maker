import { describe, expect, it } from "vitest";
import { RAG_CORE_VERSION } from "../index";

describe("rag-core smoke", () => {
  it("exports a version string", () => {
    expect(RAG_CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
