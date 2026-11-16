PrintForge for macOS
====================

1. Drag PrintForge into the Applications folder.

2. Open it the first time:
   PrintForge is not from the App Store, so macOS asks you to confirm once.
   - Double-click PrintForge. When macOS says it cannot verify the app,
     click "Done" (or "Cancel").
   - Open System Settings > Privacy & Security, scroll down and click
     "Open Anyway" next to PrintForge, then confirm.
   (On macOS 14 and older you can instead right-click the app > Open > Open.)

   Terminal alternative:
     xattr -dr com.apple.quarantine /Applications/PrintForge.app

Requires macOS 12 Monterey or newer, on Apple Silicon or Intel Macs.
Your projects are saved in Documents/PrintForge.
