import type { ReactNode } from "react";
import { ScrollEdgeMaterial } from "./ScrollEdgeMaterial";
import styles from "./ScrollEdgeViewport.module.css";

/** Frames an existing scroller marked by useScrollEdges; owns no scroll state. */
export function ScrollEdgeViewport({ children }: { children: ReactNode }) {
  return (
    <div className={styles.viewport} data-scroll-edge-viewport="">
      {children}
      <ScrollEdgeMaterial edge="top" className={styles.edge} />
    </div>
  );
}
