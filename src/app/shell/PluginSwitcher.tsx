import { useRef } from "react";
import type { RegisteredPage } from "../../features/pages/service";
import type { NavigationOpenOptions } from "../../features/navigation/controller";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import {
  MenuRoot,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuIcon,
  MenuSeparator,
} from "../../shared/design-system/ui/Menu";
import {
  CaretDownIcon,
  ArrowRightIcon,
} from "../../shared/design-system/icons";
import { PageNavigation, PageArtwork } from "./PageNavigation";
import { usePagePresentation } from "./BestieNavigation";

export function PluginSwitcher({
  pages,
  selected,
  currentPage,
  onSelect,
}: {
  pages: readonly RegisteredPage[];
  selected: string;
  currentPage: string;
  onSelect(
    key: string,
    options?: Pick<NavigationOpenOptions, "focus"> & { section?: string },
  ): void;
}) {
  const navigated = useRef(false);
  const select: typeof onSelect = (key, options) => {
    navigated.current = true;
    if (options) onSelect(key, options);
    else onSelect(key);
  };
  const presentation = usePagePresentation();
  const active =
    pages.find((page) => page.key === currentPage) ??
    pages.find((page) => page.key === selected) ??
    pages.find((page) => page.key === "buzz.channels/channels") ??
    pages[0];
  if (!active) return null;
  const { label } = presentation(active);
  return (
    <nav aria-label="Plugins" className="shell-plugin-switcher">
      <MenuRoot
        onOpenChange={(open) => {
          if (open) navigated.current = false;
        }}
      >
        <MenuTrigger
          render={
            <NavigationItem
              aria-label={`Switch app: ${label}`}
              label={label}
              icon={<PageArtwork page={active} size={20} />}
              trailing={<CaretDownIcon size={16} aria-hidden="true" />}
            />
          }
        />
        <MenuPopup
          aria-label="Apps"
          align="start"
          finalFocus={() =>
            navigated.current ? document.getElementById("main-content") : true
          }
        >
          <PageNavigation
            pages={pages}
            selected={active.key}
            currentPage={currentPage}
            onSelect={select}
            placement="menu"
          />
          <MenuSeparator />
          <MenuItem onClick={() => select("settings", { section: "plugins" })}>
            <MenuIcon>
              <ArrowRightIcon size={18} />
            </MenuIcon>
            Open Plugins
          </MenuItem>
        </MenuPopup>
      </MenuRoot>
    </nav>
  );
}
