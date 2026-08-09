import { RawChannelList } from "./RawChannelList";
import { RawThreadList } from "./RawThreadList";
import { RawThreadView } from "./RawThreadView";

export function RawTab({ splat }: { splat: string }) {
  if (!splat) return <RawChannelList />;
  const parts = splat.split("/").filter(Boolean);
  if (parts.length === 1) return <RawThreadList channel={parts[0]} />;
  return <RawThreadView path={`raw/${splat}${splat.endsWith(".md") ? "" : ".md"}`} channel={parts[0]} />;
}
