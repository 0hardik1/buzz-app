import type { JsonValue } from "../../features/navigation/targets";
export type HomeReader = {
  channelId: string;
  messageId?: string;
  source?: { channelId: string; messageId: string };
};
export function homeReader(value: unknown): HomeReader | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("channelId" in value) ||
    typeof value.channelId !== "string" ||
    !value.channelId ||
    value.channelId.length > 256
  )
    return;
  if (
    "messageId" in value &&
    (typeof value.messageId !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.messageId))
  )
    return;
  let source: HomeReader["source"];
  if ("source" in value) {
    const candidate = value.source;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      !("channelId" in candidate) ||
      typeof candidate.channelId !== "string" ||
      !candidate.channelId ||
      candidate.channelId.length > 256 ||
      !("messageId" in candidate) ||
      typeof candidate.messageId !== "string" ||
      !/^[a-f0-9]{64}$/.test(candidate.messageId)
    )
      return;
    source = { channelId: candidate.channelId, messageId: candidate.messageId };
  }
  return {
    channelId: value.channelId,
    ...(source ? { source } : {}),
    ...("messageId" in value ? { messageId: value.messageId as string } : {}),
  };
}
export const validHomeRoute = (value: JsonValue) => !!homeReader(value);
