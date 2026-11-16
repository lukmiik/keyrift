import { describe, expect, it } from "vite-plus/test";

import { LineSplitter } from "./line-splitter.ts";

describe("LineSplitter", () => {
  it("returns a complete line", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"id":1}\n')).toEqual(['{"id":1}']);
  });

  it("returns several lines from one chunk", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"id":1}\n{"id":2}\n')).toEqual(['{"id":1}', '{"id":2}']);
  });

  it("joins a line split across chunks", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"id"')).toEqual([]);
    expect(splitter.push(':1}\n{"id":2')).toEqual(['{"id":1}']);
    expect(splitter.push("}\n")).toEqual(['{"id":2}']);
  });

  it("skips blank lines", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('\n\n{"id":1}\n  \n')).toEqual(['{"id":1}']);
  });

  it("completes a line when only the newline arrives later", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"id":1}')).toEqual([]);
    expect(splitter.push("\n")).toEqual(['{"id":1}']);
  });
});
