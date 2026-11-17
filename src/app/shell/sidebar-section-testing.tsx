/** Real bundled registrations for direct shell fixtures that do not start the app runtime. */
import { Context } from "@deepseek-ai/cordis";
import { useEffect, useState, type ComponentProps } from "react";
import { bundledOwner } from "../../plugins/provenance";
import { SidebarSectionsService } from "../../features/channel-navigation/sidebar-sections-service";
import { soloSidebarSource } from "../../bundled/channels/SoloSidebarSource";
import { PrimarySidebar as Shell } from "./PrimarySidebar";

export function PrimarySidebar(props: ComponentProps<typeof Shell>) {
  const [{ root, registry }] = useState(() => {
    const root = new Context();
    root.provide("pluginStatus", {
      isActive: () => true,
      subscribe: () => () => {},
    });
    const registry = new SidebarSectionsService(root);
    root
      .extend({
        pluginOwner: bundledOwner({ id: "buzz.channels", revision: "bundled" }),
      })
      .sidebarSections?.registerSource?.(soloSidebarSource);
    return { root, registry };
  });
  useEffect(
    () => () => {
      void root.fiber.dispose();
    },
    [root],
  );
  return (
    <Shell
      {...props}
      sidebarSections={{
        ...registry,
        version: 1,
        register: () => {},
        snapshot: registry.snapshot,
        subscribe: registry.subscribe,
        ...props.sidebarSections,
        sourceSnapshot:
          props.sidebarSections?.sourceSnapshot ?? registry.sourceSnapshot,
        sourceSubscribe:
          props.sidebarSections?.sourceSubscribe ?? registry.sourceSubscribe,
      }}
    />
  );
}
