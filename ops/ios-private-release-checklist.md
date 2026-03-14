# iOS Private Release Checklist (FreedomForge Max)

Use this checklist to publish the app **only for yourself** via Apple/TestFlight.

## 1) Prerequisites
- Apple Developer account (active)
- Full Xcode installed from App Store
- Logged in to Xcode with your Apple ID

## 2) Prepare app shell from this repo
```bash
npm install
npm run ios:prepare
npm run ios:open
```

## 3) Xcode project setup
In Xcode (`ios/App/App.xcodeproj`):
1. Select target **App**
2. Signing & Capabilities:
   - Team: your Apple Developer team
   - Bundle Identifier: keep `com.freedomforge.max` or set a unique one you control
3. General:
   - Display Name: `FreedomForge Max`
   - Version / Build: increment each upload
4. Deployment target: choose your iOS minimum

## 4) Branding assets (optional but recommended)
- Replace icon assets in:
  - `ios/App/App/Assets.xcassets/AppIcon.appiconset`
- Replace splash image in:
  - `ios/App/App/Assets.xcassets/Splash.imageset`

## 5) Archive and upload (private)
1. Product -> Archive
2. Distribute App -> App Store Connect -> Upload
3. In App Store Connect -> TestFlight:
   - Add only your Apple ID as tester
   - Do not add public/external testers if you want personal-only access

## 6) Ongoing updates
For web UI/API updates only (same wrapper app):
- Deploy your web app normally to Railway.
- The iOS wrapper points to production URL and reflects updates.

For native wrapper changes:
```bash
npm run ios:prepare
npm run ios:open
```
Then archive/upload a new build in Xcode.
