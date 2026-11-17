# Sidebar host hand test

An unsigned API v1 demo for sidebar replacement on PR #3695. It uses only the
host's React instance and page registration: no imports, dependencies, network,
file access or saved plugin data. The demo adds two pages and a local click
counter. The source PR does not include this package.

Use a desktop build from commit `4ab703eef` or later containing that correction.

1. In Settings, open **Plugins → Manage plugins → Add → Browse** (accessible
   name: **Browse plugin folder**). Choose the extracted `sidebar-host-demo`
   folder containing `manifest.json` and `plugin.js`.
2. Review **Sidebar host hand test**, choose **Install plugin**, and enable it
   if it is disabled. Close Settings. No build or dependency installation is needed.
3. In Messages, choose **All**. Set a section's filter/sort, collapse a group,
   and scroll the channel list. Remember that view.
4. Search for **Sidebar host demo** and open it. **Replacement navigation**
   should replace the All/Solo/Team sidebar. Click **Demo clicks: 0** and confirm
   it increments. Messages conversation rows should be absent.
5. Click the **Messages** dock button. The section filter/sort, collapse state
   and scroll position should return. Search/palette navigation can scroll page
   links into view, so use the dock button for this return check.
6. Search for **Sidebar demo standalone**. Its page should open with no sidebar.
   Return to Messages and confirm navigation works.
7. Open **Sidebar demo standalone** again, quit the development app, and relaunch
   the same build/profile. It should reopen that page without a sidebar or a
   stuck launch screen. Then select Messages and confirm its sidebar appears.
8. When finished, disable or delete **Sidebar host hand test** in Manage plugins.
   This removes its two navigation entries.

The default app accepts unsigned plugins. A distributor may require signatures;
use its normal signing process rather than changing that policy for this demo.

Verification at `4ab703eef`: the native CLI installed the package into an isolated
profile. Chromium and WebKit exercised Settings installation, the external blob
module loader, replacement, the click counter, return scroll/collapse, standalone
visibility and reload onto standalone. Native folder selection and process restart
still require the human check above. This demo uses the existing `Page.sidebar`
adapter; it does not open the bundled-only v2 context/source preview or migrate Settings.
