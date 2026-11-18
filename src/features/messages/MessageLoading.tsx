import { SkeletonBox } from "skullet/react";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import styles from "./Messages.module.css";
import loading from "./MessageLoading.module.css";

/** Read placeholders share message geometry; announcements retain the quiet delay. */
export function MessageLoading({
  label = "Loading messages…",
}: {
  label?: string;
}) {
  return (
    <div className={styles.threadLoading}>
      <LoadingRegion pending label={label} statusVisibility="screen-reader">
        <div className={loading.messages} aria-hidden="true">
          {["76%", "58%", "88%"].map((width) => (
            <div key={width} className={loading.row}>
              <SkeletonBox
                width="var(--space-8)"
                height="var(--space-8)"
                radius="var(--radius-pill)"
              />
              <div className={loading.body}>
                <SkeletonBox width="28%" height="var(--space-3)" />
                <SkeletonBox width={width} height="var(--space-3)" />
                <SkeletonBox width="46%" height="var(--space-3)" />
              </div>
            </div>
          ))}
        </div>
      </LoadingRegion>
    </div>
  );
}
