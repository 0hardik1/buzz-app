import { createContext, type ReactNode } from "react";

/** Shell-owned destinations placed inside the primary sidebar scrollport. */
export const ShellNavigationCards = createContext<{
  top?: ReactNode;
  bottom?: ReactNode;
}>({});
