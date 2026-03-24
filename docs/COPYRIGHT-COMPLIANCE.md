# Copyright Compliance Policy

This repository uses the MIT license for project-owned code.

## Rules

1. Do not copy third-party code, text, graphics, or media into this repository unless the license permits redistribution and modification for this project.
2. Preserve required attributions and license notices when importing third-party materials.
3. Do not include proprietary, paid, or unknown-license content.
4. Prefer original project assets and text over externally sourced material.
5. Run `npm run copyright:audit` before shipping releases.

## Dependency License Requirements

- Allowed by default: permissive and weak-copyleft licenses that are compatible with distribution strategy (for example MIT, Apache-2.0, BSD variants, ISC, MPL-2.0).
- Requires legal review: strong copyleft licenses such as GPL/AGPL.
- Forbidden for shipping until reviewed: dependencies marked `UNKNOWN` or `UNLICENSED`.

## Verification Process

1. Run `npm run copyright:audit`.
2. Confirm report status is `pass` in `dist/copyright-audit-report.json`.
3. Review `docs/THIRD_PARTY_LICENSES.md` for dependency license changes.
4. Resolve all failures before release.

## Notes

- This process reduces legal risk but is not legal advice.
- If there is any ambiguity, get counsel review before release.
