# Sidebar PR #3695 reviewer images

These screenshots use synthetic fixture data and disposable identities. They are illustrative. The expected appearance is unchanged by this refactor.

The matched comparisons use Chromium, a 1440 × 950 viewport, light theme and default text size. Filenames identify the captured commit and engine:

- `d88203ad0`: base.
- `5e0d297c5`: earlier candidate production code, before the global-host correction.
- `stars-groups`: default All pane with Starred and saved groups.
- `no-stars`: the first group sits directly below Team when Starred is empty.
- `create-reveal`: dragging a channel reveals the create-section target.

The separate geometry check found no differences in section and create-target gaps across 18 cases per engine in Chromium and WebKit. Screenshots do not replace that measurement or establish native-app validation.

The remaining candidate images use the existing browser app fixtures with three synthetic channels (General, Planning and Design), a saved Work group and two communities. They show All/Solo/Team, Primary → Secondary → Primary and Design after dragging it into Work. The capture journey passed in Chromium with retries disabled. These stills show the resulting views; they do not depict every intermediate drag or reconnect frame.

## Global host correction

The `4ab703eef-chromium-*.png` images capture source commit `4ab703eef97708726564132751189f8d5ab74f79`, using the production frontend with the production broker and synthetic upstream fixtures, light theme and default text size. No real community data or native app is shown.

- `panes-all`, `panes-solo`, `panes-team`, `community-b`, `community-a-return`, and `drag-into-work`: refreshed versions of the small three-channel fixture above, at 1440 × 950. Captures passed in Chromium and WebKit; the published versions are Chromium.
- `messages-before-replacement`, `page-sidebar-replacement`, and `messages-after-return`: the global-host journey at 1440 × 600. A synthetic page replaces Messages through `Page.sidebar`; returning restores exactly 180px scroll plus the saved collapse/filter/sort state. The fixture enables extra example pages to exercise replacement. This is not Settings migration. The journey passed in Chromium and WebKit.

The corrected-source layout/navigation checks passed 38 existing cases across both engines. An additional action/drag run passed 27 of 28; WebKit's navigation-groups:1001 hit the previously documented decode/route flake, while its grouping/scroll frame assertions passed. These screenshots are illustrative, and do not establish native or human validation. Historical comparison images above retain their original source labels and validation scope.

## Runnable hand-test plugin

Download [sidebar-host-demo.zip](sidebar-host-demo.zip), extract it, and load its
folder through Settings → Plugins → Manage plugins → Add → Browse. The
[self-contained source and instructions](sidebar-host-demo/README.md) use the
existing v1 page-sidebar API to demonstrate replacement, Messages return and a
standalone page. This package is outside the source PR; no build is needed.
