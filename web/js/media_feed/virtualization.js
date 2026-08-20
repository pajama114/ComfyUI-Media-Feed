import { OVERSCAN } from "./constants.js";

export function visibleItemRange({
  itemCount,
  viewportSize,
  scrollOffset,
  pitch,
  railPadding,
  overscan = OVERSCAN,
}) {
  const rawStart = Math.floor((scrollOffset - railPadding) / pitch) - overscan;
  const rawEnd = Math.ceil((scrollOffset + viewportSize - railPadding) / pitch) + overscan;
  return {
    start: Math.max(0, rawStart),
    end: Math.min(itemCount, rawEnd),
  };
}
