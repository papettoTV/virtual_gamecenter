import { createElement, useId, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

function HookProbe({ label }: { label: string }) {
  const reference = useRef(label);
  const [state] = useState(label);
  const id = useId();
  return createElement("p", { id }, `${reference.current}:${state}`);
}

it("renders real React hooks through the same instance as the server renderer", () => {
  expect(renderToStaticMarkup(createElement(HookProbe, { label: "first" }))).toContain("first:first");
  expect(renderToStaticMarkup(createElement(HookProbe, { label: "second" }))).toContain("second:second");
});
