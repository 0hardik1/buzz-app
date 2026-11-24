import {
  useCallback,
  useEffect,
  useId,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  CaretDownIcon,
  CaretRightIcon,
} from "../../shared/design-system/icons";
import { Button } from "../../shared/design-system/ui/Button";
import {
  mediaCollapsed,
  setMediaCollapsed,
  subscribeCollapsedMedia,
} from "./collapsed-media";
import styles from "./Messages.module.css";

export function CollapsibleMediaGroup({
  scope,
  groupKey,
  label,
  imageList,
  grid,
  seekRequest,
  children,
}: {
  scope: string | undefined;
  groupKey: string;
  label: string;
  imageList: boolean;
  grid: boolean;
  seekRequest: number | undefined;
  children: ReactNode;
}) {
  const id = useId();
  const subscribe = useCallback(
    (notify: () => void) => subscribeCollapsedMedia(scope, notify),
    [scope],
  );
  const collapsed = useSyncExternalStore(
    subscribe,
    () => mediaCollapsed(scope, groupKey),
    () => false,
  );
  useEffect(() => {
    if (seekRequest !== undefined) setMediaCollapsed(scope, groupKey, false);
  }, [scope, groupKey, seekRequest]);
  const groupLabel = label === "Image" ? "1 image" : label;
  const Caret = collapsed ? CaretRightIcon : CaretDownIcon;
  return (
    <div className={styles.mediaGroup}>
      <div className={styles.mediaDisclosure} data-copy-text="">
        <Button
          variant="ghost"
          shape={collapsed ? "capsule" : "icon"}
          size={collapsed ? "inline" : "sm"}
          title={`${collapsed ? "Show" : "Hide"} ${label.toLowerCase()}`}
          aria-label={label}
          data-highlight-expanded="false"
          aria-expanded={!collapsed}
          aria-controls={id}
          onClick={() => setMediaCollapsed(scope, groupKey, !collapsed)}
        >
          <Caret size={14} aria-hidden="true" />
          {collapsed && <span className="truncate">{label}</span>}
        </Button>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: Groups related media rather than form fields. */}
      <div
        id={id}
        role="group"
        aria-label={groupLabel}
        className={
          collapsed
            ? undefined
            : imageList
              ? `${styles.imageList} ${grid ? styles.imageGrid : ""}`
              : styles.mediaList
        }
        data-image-grid={(grid && !collapsed) || undefined}
        hidden={collapsed}
      >
        {!collapsed && children}
      </div>
    </div>
  );
}
