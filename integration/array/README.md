# METADATA for the Array launcher · 0.4.0

This folder is a concrete integration handoff for the **free, standalone Windows utility**. It does not publish a Store listing or change an Array repository. METADATA runs without Array, an account, activation or a license file. The application has no embedded Store/backend implementation.

## Inspected contract

Prepared against `seismicgear/Array` commit **f17062d24b1625d14707fd8046c134cdef00b33b** (2026-10-18). The patch applies to that source. Rebase and run Array's own release/lifecycle tests if its adapter or Store contract changes.

| Source | Relevant behavior |
|---|---|
| [Native adapters](https://github.com/seismicgear/Array/blob/f17062d24b1625d14707fd8046c134cdef00b33b/apps/desktop/core/adapters.mjs) | Product identity is source-defined. Windows detection verifies the executable identity/publisher. The NSIS installation path comes from native uninstall records. |
| [Release trust](https://github.com/seismicgear/Array/blob/f17062d24b1625d14707fd8046c134cdef00b33b/apps/desktop/core/release-trust.mjs) | Authenticated release envelopes, approved HTTPS artifact hosts, hashes, platform/version bounds and product signing policy. |
| [Lifecycle](https://github.com/seismicgear/Array/blob/f17062d24b1625d14707fd8046c134cdef00b33b/apps/desktop/core/lifecycle.mjs) | Array owns download/install/launch/update state and verification. |
| [Canonical Store vocabulary](https://github.com/seismicgear/Array/blob/f17062d24b1625d14707fd8046c134cdef00b33b/packages/store-contract/contract.mjs) | Store status/commercial/licensing codes are supplied by the service and shared by its clients. |

The inspected commercial vocabulary contains `purchasable`, `quote`, `community` and `not_offered`; licensing contains `community`, `activation` and `grant`. It has **no explicit free utility without activation**. Add the free-utility case in the canonical KI website/Store contract and service when publishing, then consume it in Array. METADATA must not be falsely marked as a purchasable/activation product or assigned an invented community license. The source package itself is private/unlicensed source, not a grant of an open-source license.

## Files in this handoff

| File | Purpose |
|---|---|
| `metadata-product.mjs` | Source-defined Windows product identity and registration helper. |
| `register-adapter.patch` | Minimal patch to register the helper through Array's existing native-adapter factory. |
| `verify-adapter.mjs` | Contract checks against a patched scratch Array checkout, with OS calls mocked. |
| `product-intent.json` | Product copy, free/no-account/no-activation intent and supported platform. This is deliberately labeled as an intent record, not a Store catalog object. |
| `release-artifacts.json` | Actual hashes/sizes and executable identity for these unsigned build candidates. It is not a signed Array release envelope. |

## Native identity

| Setting | Value |
|---|---|
| Catalog/product ID | `metadata` |
| Display product | `METADATA` |
| Native app ID | `industries.kuykendall.metadata` |
| Windows ProductName | `KI Metadata Workbench` |
| Installed executable | `KI Metadata Workbench.exe` |
| Uninstall DisplayName | `KI Metadata Workbench` (exact, case-sensitive) |
| Install kind | `nsis` |
| Platform / architecture | `win32` / `x64` |
| Release version | `0.4.0` (PE ProductVersion `0.4.0.0`) |

The NSIS build is per-user, assisted, allows a chosen installation directory and does not request elevation. `build/installer.nsh` writes `InstallLocation` into the standard uninstall record. The desktop shortcut and application user-model ID use the stable app identity. Settings/history are retained on uninstall by package policy.

The adapter checks the app and its native core, FFmpeg, ffprobe and ExifTool processes at their installation paths before replacement. It registers only on Windows. There are no pretend macOS/Linux packages or adapters in this release.

The portable EXE is an alternate standalone download; it should not be offered to the existing NSIS install adapter as an installer. A portable extraction directory is also not a durable executable location for Array management.

## Apply and check the handoff

On a scratch branch/check-out of the pinned Array source:

1. Copy `metadata-product.mjs` into `apps/desktop/core/`.
2. Apply `register-adapter.patch` at the Array repository root after reviewing the diff.
3. From the METADATA source directory, run the verification below with the actual patched core path.
4. Add the product to the canonical Store/catalog path and run the Array repository's own suites before publishing.

```powershell
node integration/array/verify-adapter.mjs 'C:\Source\Array\apps\desktop\core'
```

This handoff passed eight contract checks against the patched inspected source: registration beside Annex/FORGE, no unsupported platform registration, basename/product-resource checks, refusal of unsigned application/installer candidates, trusted version/hash resolution and installation-specific process checks. OS calls were mocked. It is not an end-to-end Array installation result. The result is `docs/evidence/array-adapter-tests-0.4.0.txt`.

## Release trust and publication

The supplied EXEs are **unsigned** and have not been launched on Windows. Array correctly refuses to treat an unsigned candidate as a publisher-verified installation. Its trust checks are preserved by the helper and patch.

For the actual KI release, use the normal publisher/signing process and clean-account Windows acceptance. Sign the app/installer, then recalculate both artifact and installed-executable hashes; signing changes bytes. Host the signed installer on an approved HTTPS artifact host and create the authenticated release envelope using KI's real release key and policy.

The inspected envelope payload requires `schemaVersion: 1`, product/platform/arch/channel/version, `minArrayVersion`, monotonic `sequence`, `publishedAt`, `expiresAt`, and its `artifact` record. The artifact identifies the HTTPS URL, SHA-256, size, `kind: "nsis"`, executable name and executable SHA-256. Validate against the current `release-trust.mjs`; product/channel key IDs, publisher thumbprints, allowed hosts and timestamps must come from the actual release environment. Do not reuse this unsigned inventory as an authenticated manifest.

Register the real Windows publisher pin under `productPublishers.metadata` and the product's release trust before enabling installation. Update the canonical catalog only after the free-utility contract is supported. No signing key, certificate, host URL, Store status or release sequence is fabricated by this handoff.

## Launch and ongoing use

Array can launch the installed executable normally. Employees can also use its shortcut with Array closed. Absolute file arguments are accepted, and later launches hand new files to the existing instance. A dedicated inspection shortcut can add `--inspect-only`; `KI_READ_ONLY=1` is available to the native core as well.

A locked launch cannot be relaxed from the UI. It is an application workflow control, not OS write protection. Normal inspection remains local and account-free. Team presets are exchanged as explicit local JSON packs; employee provisioning, licensing, billing and Store state remain owned outside this utility.
