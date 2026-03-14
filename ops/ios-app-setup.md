# iOS App Setup (FreedomForge Max)

This repo now includes a Capacitor iOS wrapper project at `ios/`.

## What was generated
- `capacitor.config.ts`
- `ios/` native Xcode project

## Current wrapper mode
The iOS app is configured to load your live production URL:
- `https://<YOUR_APP_URL>`

This means updates to the web app are reflected in the iOS app without rebuilding the binary for every UI/content change.

## One-time Mac setup
1. Install full Xcode from App Store.
2. Open Xcode once and accept license.
3. Set active developer dir:
   - `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
4. (Optional if needed) install CocoaPods:
   - `sudo gem install cocoapods`

## Daily iOS workflow
1. Sync wrapper config/plugins:
   - `npm run ios:sync`
2. Open project in Xcode:
   - `npm run ios:open`
3. In Xcode:
   - Set Signing Team (your Apple Developer account)
   - Set unique Bundle Identifier if needed
   - Select your iPhone device
   - Build + Run

## App Store / TestFlight (private usage)
For a personal/private app distribution:
1. In Xcode, Product -> Archive
2. Distribute App -> App Store Connect -> Upload
3. In App Store Connect, create app record and submit to TestFlight
4. Add only your Apple ID as an internal/external tester

## Recommended env for stable auth on mobile
- Keep using Safari session for first login if in-app webview session isolation occurs.
- Existing session cookie auth is already enabled in app routing.

## Notes
- You currently have command line developer tools only; full Xcode is required for archive/signing.
- The generated `ios/` project is ready and committed once pushed.
