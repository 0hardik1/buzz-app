import { createContext, type ReactNode } from "react";

/** A reader opened as a tab: `id` names what it reads, such as a message, so
 * opening the same one again shows its tab. */
export type DetailTab = {
  id: string;
  title: string;
  content: ReactNode;
};
/** Opens a reader in a tab the conversation workspace owns. The tab mounts its
 * own copy of the content, so it doesn't depend on the row that opened it. */
export const DetailTabContext = createContext<
  ((tab: DetailTab) => void) | undefined
>(undefined);
