# Phase 13A dependency and security audit

## Status and boundary

Audit performed September 4, 2026 from the frozen Phase 12 checkpoint
`57031a47f8991f19c6b7e01a17fd1c671b19f41f` (`phase-12-accepted`). This document is the
required remediation gate before dependency changes. It does not authorize Phase 13C, provider
activation, staging, production deployment, or product functionality.

`pnpm audit --prod` currently reports 19 transitive advisories: 10 high and 9 moderate. The increase
from the earlier 10-advisory snapshot is new registry intelligence, not a new direct dependency.

## Advisory inventory and reachability

| Advisory            | Package / installed / fixed            | Severity | Chain and affected surface                                             | Runtime, practical exposure, and remediation                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------- | -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-ggr8-5vv4-36mx | `deepmerge-ts` 7.1.5 / >=8.0.0         | High     | Prisma CLI/config through `prisma`; API and database workspace tooling | Not shipped in the API query runtime or mobile binary. Crafted recursive config input is not accepted from users. Major override is unsafe; defer until a Prisma-compatible release.                                                                          |
| GHSA-5jgf-p345-68v8 | `fast-uri` 3.1.5 / >=3.1.6             | High     | AJV through Prisma tooling, Nest CLI, and mobile `@hookform/resolvers` | The package can be bundled in mobile validation, although schemas/URI formats are application-controlled. Patch override to 3.1.6 is semver-compatible and low risk.                                                                                          |
| GHSA-f65p-4m7j-42xc | `fast-uri` 3.1.5 / >=3.1.6             | High     | Same as above                                                          | SSRF requires a consumer to trust the parsed host for outbound access; this app does not do so. Apply the same patch.                                                                                                                                         |
| GHSA-fph4-wmhf-6fwf | `fast-uri` 3.1.5 / >=3.1.6             | High     | Same as above                                                          | Repeated hostname decoding is not used to authorize outbound requests. Apply the same patch.                                                                                                                                                                  |
| GHSA-jqff-g426-hqxp | `fast-uri` 3.1.5 / >=3.1.6             | High     | Same as above                                                          | Encoded-scheme host confusion is not part of the application request pipeline. Apply the same patch.                                                                                                                                                          |
| GHSA-w3rx-r6r6-pgpr | `image-size` 1.2.1 / >=2.0.3           | High     | Expo CLI/Metro and React Native community CLI; mobile build tooling    | Not bundled into the installed app. A malicious local ICNS input could hang the developer/builder process. Fixed release is a major jump outside parent ranges; do not force it.                                                                              |
| GHSA-5p2g-fcmc-qvqq | `image-size` 1.2.1 / >=2.0.3           | High     | Same as above                                                          | Malicious JXL/HEIF affects asset inspection during build, not uploaded marketplace media. Track upstream Expo/Metro remediation.                                                                                                                              |
| GHSA-3f6p-5ww8-9rcr | `mysql2` 3.15.3 / >=3.22.0             | High     | Prisma CLI through API and database workspaces                         | The platform uses PostgreSQL and never opens a MySQL connection. Tooling only and unreachable in deployed architecture; a compatible 3.x override can remove it without a framework upgrade.                                                                  |
| GHSA-6g55-p6wh-862q | `postcss` 8.4.49 / >=8.5.12            | High     | Expo Metro config; mobile build tooling                                | Not bundled into native runtime. Exploitation requires attacker-controlled build CSS/source maps. A compatible 8.x override to the highest required fix is low risk.                                                                                          |
| GHSA-r28c-9q8g-f849 | `postcss` 8.4.49 / >=8.5.18            | High     | Same as above                                                          | Same build-only boundary. Patch through >=8.5.23.                                                                                                                                                                                                             |
| GHSA-6gmq-8vp8-gcm6 | `@xmldom/xmldom` 0.9.11 / >=0.9.12     | Moderate | Expo config plugins/plist/Xcode parsing; mobile native generation      | Build tooling only; no untrusted runtime XML. Patch within 0.9 is safe if parent resolution permits it.                                                                                                                                                       |
| GHSA-6gmq-8vp8-gcm6 | `@xmldom/xmldom` 0.8.14 / >=0.8.15     | Moderate | Expo config plugins/plist/Xcode parsing; mobile native generation      | Same boundary. Patch within 0.8 separately; do not collapse both lines onto a breaking 0.9 release.                                                                                                                                                           |
| GHSA-vcc3-ghjq-m6fr | `decode-uri-component` 0.2.2 / >=0.4.3 | Moderate | React Navigation core -> `query-string`; mobile runtime                | Bundled and reachable through application/deep-link query parsing, but malformed input causes only client-local denial of service. The fix is outside the parent's declared line; defer to a React Navigation-compatible update rather than override blindly. |
| GHSA-rgwj-5xj2-c3m3 | `mysql2` 3.15.3 / >=3.23.1             | Moderate | Prisma CLI; API/database tooling                                       | PostgreSQL-only architecture makes the compressed MySQL protocol unreachable. If overridden, use >=3.23.1 to cover both MySQL advisories.                                                                                                                     |
| GHSA-qx2v-qp2m-jg93 | `postcss` 8.4.49 / >=8.5.10            | Moderate | Expo Metro config; mobile build tooling                                | No web rendering of attacker-controlled CSS through this copy. Covered by the proposed 8.5.23 patch.                                                                                                                                                          |
| GHSA-fxqj-rqcc-2cmp | `postcss` 8.4.49 / >=8.5.23            | Moderate | Expo Metro config; mobile build tooling                                | Crafted source maps could read builder files. Builds use repository-controlled input. Apply 8.5.23 or newer compatible 8.x.                                                                                                                                   |
| GHSA-x5fp-wj9c-mxmx | `qs` 6.15.3 / >=6.15.4                 | Moderate | Nest platform Express -> Express/body-parser; API runtime              | Network-reachable request parsing, so this is a priority even though application DTO validation limits impact. A 6.16.0 override remains within the parent 6.x range.                                                                                         |
| GHSA-4mjr-xmp4-gh2g | `qs` 6.15.3 / >=6.16.0                 | Moderate | Same as above                                                          | Attacker-controlled parsing can consume server resources. Apply 6.16.0 and rerun API integration tests.                                                                                                                                                       |
| GHSA-w5hq-g745-h8pq | `uuid` 7.0.3 / >=11.1.1                | Moderate | Expo config plugins/Xcode project tooling                              | Build-only UUID generation, not application IDs or security tokens. Fixed release is multiple majors beyond the parent; defer to Expo upstream.                                                                                                               |

All affected packages are transitive. Admin and worker production bundles have no independently
identified reachable advisory in this audit. Prisma-related paths appear in API/database installation
graphs, but the affected packages are CLI/config or unused MySQL support rather than the PostgreSQL API
request path.

## Framework compatibility snapshot

| Component                          | Accepted version                                        | Assessment                                                                   |
| ---------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Node / pnpm / Turbo                | 24.20.0 / 11.22.0 / 2.10.11                             | Matches repository engine declarations.                                      |
| Expo / React Native / mobile React | 54.0.37 / 0.81.5 / 19.1.0                               | Correct Expo SDK 54 family.                                                  |
| React Navigation                   | native 7.3.16; bottom-tabs 7.18.16; native-stack 7.18.8 | Compatible current v7 family; deep-link decoder advisory remains transitive. |
| Next.js / Admin React              | 16.3.1 / 19.2.0                                         | Internally aligned in the Admin workspace.                                   |
| NestJS                             | runtime 11.2.1; CLI 11.0.24                             | Same supported major.                                                        |
| Prisma                             | client/CLI/adapter 7.9.1                                | Internally aligned.                                                          |
| TypeScript                         | 5.9.3                                                   | Matches Expo SDK 54's recommended 5.9 line.                                  |

Major Expo modules are pinned to SDK 54 ranges: Constants 18.0.14, Crypto 15.0.9, Device 8.0.10,
Document Picker 14.0.8, Image 3.0.11, Image Picker 17.0.11, Local Authentication 17.0.9,
Location 19.0.8, Notifications 0.32.17, SecureStore 15.0.8, and Status Bar 3.0.9.

Expo Doctor initially found one native-build blocker: `@expo/vector-icons` lacked a direct
`expo-font` peer, causing both `expo-font` 14.0.12 (SDK 54) and 55.0.8 to be installed. Native builds
must not contain duplicate native module versions. Add the SDK-selected `expo-font` version directly;
do not upgrade Expo or React Native.

Known duplicate non-framework versions are the two intentional `@xmldom/xmldom` compatibility lines,
three PostCSS lines (Expo, Next, tooling), and UUID 7/8 lines. Metro 0.83.3 (Expo) and 0.83.7
(community CLI) are transitive tooling copies and must not be manually unified without upstream proof.

## Proposed remediation set and test gates

1. Add SDK 54-selected `expo-font` and `expo-dev-client` directly to mobile. This fixes the Doctor
   blocker and enables development clients without changing SDK/framework majors.
2. Add exact root pnpm overrides for `fast-uri@3.1.6`, `qs@6.16.0`, `postcss@8.5.23`, and
   `mysql2@3.23.1`. These are patch/minor resolutions within the existing package major lines.
3. Apply parent-scoped XML overrides only if pnpm can preserve both compatible lines:
   `@xmldom/xmldom` 0.8 -> 0.8.15 and 0.9 -> 0.9.12. Do not force one version across both parents.
4. Defer `deepmerge-ts`, `image-size`, `decode-uri-component`, and `uuid` because their patched
   releases require a major/out-of-range substitution. Track framework-owner upgrades instead.
5. After resolution, rerun audit, Expo Doctor, Expo dependency check, full `pnpm verify`, API
   integration tests, database validation, diff checks, and explicit iOS/Android exports.

If any override creates a peer warning, type/build failure, behavioral regression, or native duplicate,
remove that override and restore the previous lockfile entry. The immutable Phase 12 tag is the final
rollback point; Phase 13 changes remain a separate forward commit and will not be pushed in this pass.
