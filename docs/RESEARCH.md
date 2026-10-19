> Historical implementation research from the earlier workbench. Current 0.4.0 format behavior, qualification and ecosystem references are documented in FORMATS.md, TEST_REPORT.md and ECOSYSTEM_DESIGN.md.

# Research and engineering decisions

Initial research: September 23, 2026. Image privacy upgrade and qualification update: October 18, 2026, version 0.2.0.

Primary documentation informed the implementation. Dependencies have now been resolved, and the Rust engine has been compiled and tested on Linux. The complete `npm test` gate passes 46 model/shell checks, 25 Rust unit tests, 12 real-media regression checks and 35 native image-privacy checks. Another 21 browser-preview checks pass, for 139 checks in total. Qualification and package/build evidence are recorded in [TEST_REPORT.md](TEST_REPORT.md). Native Windows runtime acceptance is still required; documentation review and cross-compilation do not establish that result.

## Electron with a framework-free renderer

Electron does not require React. The renderer uses HTML, CSS and TypeScript compiled to browser-native modules. UI components are DOM-building functions; mutable draft state is small and explicit. No React, JSX, hooks, virtual DOM, frontend router or state-management framework is installed.

The privileged boundary follows Electron's security guidance: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a restrictive CSP, sender/frame validation, named preload methods, blocked navigation/window creation, denied permissions and blocked HTTP(S)/WebSocket requests. The file-preview protocol grants opaque tokens only for approved local media. `webUtils.getPathForFile` resolves dropped native files in preload rather than using the removed `File.path` shortcut.

Primary references:

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [webUtils](https://www.electronjs.org/docs/latest/api/web-utils)
- [Application distribution](https://www.electronjs.org/docs/latest/tutorial/application-distribution)

Electron 44 is the declared desktop dependency family. The shell's filesystem and process-bridge modules are CommonJS JavaScript; the renderer and protocol types are TypeScript. There is no Python application component. The browser preview uses an explicitly labeled synthetic bridge and does not exercise Electron's native dialogs or native Windows IPC.

## Native audio metadata: Lofty

Lofty provides a Rust reader/writer spanning MP3, FLAC, WAV, AIFF, MP4 audio and Vorbis/Opus families. The core uses it for ordinary tag edits and modifies a sparse set of keys instead of rebuilding all metadata from normalized form fields.

The library's generic tags and conversions can be lossy; format-specific items may be preserved without appearing in the generic inventory; a mapped key is not a guarantee of every player's presentation. The interface reports supported fields from the actual tag family. It uses separate label and publisher keys. Dates use the library's RecordingDate representation for normal player compatibility, with older year fallback on read.

WAV and AIFF use embedded ID3 for the richer release fields. RIFF INFO cannot express the same complete set of release fields, but player support for embedded ID3 varies. The app rereads the result and aborts if a requested field is not represented as expected.

Primary references:

- [Lofty documentation](https://docs.rs/lofty/latest/lofty/)
- [Tag representation](https://docs.rs/lofty/latest/lofty/tag/struct.Tag.html)
- [ItemKey mappings](https://docs.rs/lofty/latest/lofty/tag/enum.ItemKey.html)
- [WriteOptions](https://docs.rs/lofty/latest/lofty/config/struct.WriteOptions.html)
- [Picture handling](https://docs.rs/lofty/latest/lofty/picture/struct.Picture.html)

The manifest pins Lofty 0.25.4. That dependency has been resolved and exercised by the compiled native test suite. These results qualify the tested fixtures, not all tag combinations or player behavior.

## Image metadata: distinct editing and stripping policies

JPEG and PNG retain the existing semantic field-editing workflow based on XMP and `img-parts`, without a pixel decode/re-encode cycle. Unknown XMP bytes are retained outside explicitly edited properties. The patcher removes and reinserts edited RDF child properties, escapes text, refuses DTD-bearing packets and validates generated XML. Attribute-form properties, extended XMP and conflicting duplicate packets are rejected for in-place edits. EXIF camera values remain inspection data rather than arbitrary writable controls.

The existing `keep`, `clear_descriptive` and `privacy` policies retain their earlier behavior, including effective EXIF orientation and color-profile preservation. They do not guarantee removal of every private container. WebP adds inspection and strict stripping; it does not add descriptive field editing.

Version 0.2.0 adds a separate image-only `strip_metadata` policy for JPEG, PNG/APNG and WebP. It removes whole metadata containers using an explicit list of retained rendering structures. It cannot be combined with staged field, raw-tag or artwork edits. Unknown metadata is discarded regardless of whether the inspector recognizes a field or generator.

XMP inspection now checks the 2 MiB packet limit, DTD prohibition and a 64-level nesting limit before building an XML tree. PNG text inflation is limited to 2 MiB. Malformed descriptive packets can produce warnings and remain eligible for strict removal, while malformed structures needed to retain the image cause the operation to fail.

Supporting implementation references:

- [img-parts](https://docs.rs/img-parts/latest/img_parts/)
- [JPEG representation](https://docs.rs/img-parts/latest/img_parts/jpeg/struct.Jpeg.html)
- [PNG representation](https://docs.rs/img-parts/latest/img_parts/png/struct.Png.html)
- [kamadak-exif](https://docs.rs/kamadak-exif/latest/exif/)
- [quick-xml](https://docs.rs/quick-xml/latest/quick_xml/)
- [xmltree](https://docs.rs/xmltree/latest/xmltree/)

### JPEG: inspect every scan and application segment

A strict removal pass cannot treat all bytes following the first SOS marker as opaque scan data: JPEG supports multiple scans and intervening marker segments. The reviewed `img-parts` parser stores the remainder following its first scan as entropy bytes, so the new strict path uses its own complete marker/entropy walker through EOI. It handles byte stuffing, restart markers, TEM and DNL in entropy data, and scans subsequent metadata segments as well.

The walker validates retained frame, scan, restart, expansion and coding-table structures. It retains compressed scan data and bounded JFIF/Adobe technical headers, removes JFIF thumbnails, removes EXIF/XMP/IPTC/ICC/APP11/comments and other application data, and removes bytes after EOI. Unsupported structural markers and malformed retained lengths fail before commit.

Primary references:

- [ITU-T T.81, Annex B: JPEG syntax](https://www.w3.org/Graphics/JPEG/itu-t81.pdf)
- [JFIF 1.02](https://www.w3.org/Graphics/JPEG/jfif3.pdf)
- [img-parts JPEG image parser source](https://docs.rs/img-parts/latest/src/img_parts/jpeg/image.rs.html)
- [img-parts JPEG segment source](https://docs.rs/img-parts/latest/src/img_parts/jpeg/segment.rs.html)

### PNG/APNG: retain a defined set of chunks

The strict PNG path retains `IHDR`, `PLTE`, `IDAT`, `IEND`, `tRNS`, `gAMA`, `cHRM`, `sRGB`, `cICP`, `mDCV`, `cLLI`, `sBIT`, `bKGD`, `pHYs`, `acTL`, `fcTL` and `fdAT`. These cover encoded pixels, palette/transparency, supported color/rendering information, physical dimensions and animation controls/data. Bounds, CRCs and required fixed lengths are validated for retained chunks; the header and color-type-dependent structures are checked.

Other ancillary chunks are removed, including all `tEXt`/`zTXt`/`iTXt`, `eXIf`, `iCCP`, `tIME`, `caBX` and unknown private chunks. An unknown critical chunk is rejected because discarding it might destroy the image. The output ends at IEND. The operation does not inflate or recompress IDAT/fdAT pixels.

Primary reference: [Portable Network Graphics, third edition](https://www.w3.org/TR/png-3/).

### WebP: clean both the RIFF container and animation frames

The WebP path retains the image/animation structures `VP8X`, `ANIM`, `ANMF`, `ALPH`, `VP8 ` and `VP8L` where valid. It removes `EXIF`, `XMP `, `ICCP`, `C2PA` and unknown chunks. ANMF frame contents are walked recursively so an unknown nested chunk cannot survive merely because the outer animation frame is retained. ALPH headers and raw alpha-plane lengths are validated.

RIFF and frame lengths are rebuilt, metadata/reserved feature flags are cleared, padding is normalized and bytes beyond the declared RIFF boundary are removed. Encoded image/alpha data and animation frame controls are retained without recompression.

Primary reference: [WebP RIFF container specification](https://developers.google.com/speed/webp/docs/riff_container).

### C2PA and AI generation metadata

The C2PA specification places manifests in JPEG APP11, PNG `caBX` and RIFF `C2PA` chunks. The strict pass removes those complete storage locations, including duplicate or fragmented metadata, and removes XMP packets that can contain external `dcterms:provenance` references. This operation makes no cryptographic validation, signer-trust or authenticity claim. An external manifest, sidecar or watermark is outside the container cleanup.

Generator metadata can use ordinary metadata fields. AUTOMATIC1111's image-saving code uses PNG `parameters` text and EXIF UserComment for JPEG/WebP generation information. ComfyUI's SaveImage implementation writes PNG `prompt` and extra PNG information. Consequently the stripping decision is based on entire metadata containers, not a list of generator keywords. Keyword recognition contributes only an informative category in inspection; an unfamiliar, compressed or differently named prompt is removed with its containing metadata block.

Primary references:

- [C2PA 2.4 specification](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html)
- [AUTOMATIC1111 image writer source](https://raw.githubusercontent.com/AUTOMATIC1111/stable-diffusion-webui/master/modules/images.py)
- [ComfyUI SaveImage source](https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/nodes.py)

### Orientation, color and retention decisions

Strict stripping removes all EXIF, including orientation, and all embedded ICC profiles. Keeping a minimal EXIF orientation record would leave EXIF in a mode intended to remove it completely. Keeping arbitrary ICC bytes could retain descriptive strings or other identifying profile content. The [ICC profile specification](https://www.color.org/specification/ICC.1-2022-05.pdf) defines descriptive profile tags.

The app does not rotate pixels or convert color spaces. An output can therefore display rotated/flipped after orientation removal, or with a color shift after ICC removal, despite unchanged encoded pixel data. The UI reports the relevant appearance notes. Other retained rendering fields, including supported PNG color/gamma fields and bounded JPEG color-transform headers, remain part of the protected container.

Verified strict journals omit the source's descriptive fields, raw metadata and inspection warnings from the persisted record. They retain recovery information, structural properties and counts. The original file, replacement backup, returned in-memory audit and source-snapshot exports can still contain original values. See [SECURITY.md](SECURITY.md) for the precise retention boundary.

The earlier consideration of `little_exif` and native Exiv2 bindings did not become an additional application dependency. Format support and stripping guarantees are based on the implemented adapters and tested operations.

## Video metadata: explicit remux, not transcoding

Video uses a controlled FFmpeg subprocess with an argument array and no shell. `-map 0 -copy_unknown -c copy` requests all streams. Unsupported remux combinations fail instead of silently dropping data. Metadata commands are typed operations, not arbitrary user command strings.

MP4/MOV outputs use the muxer's metadata-tag mode for named container values. This can affect compatibility with software that expects a different tagging convention. Rebuilding a video container can change unknown atoms and structural details even when compressed packet payloads match. Accordingly video writes require explicit acknowledgement, inventory comparison and a scoped packet-hash check.

Primary references:

- [FFmpeg stream copy](https://ffmpeg.org/ffmpeg.html#Streamcopy)
- [Advanced options](https://ffmpeg.org/ffmpeg.html#Advanced-options)
- [Container formats](https://ffmpeg.org/ffmpeg-formats.html)
- [ffprobe](https://ffmpeg.org/ffprobe.html)

The build does not bundle the FFmpeg/ffprobe command-line programs. Users can select their own trusted installation. Codec availability, licensing and playback support vary with the build. Strict image stripping itself does not require FFmpeg.

## Separate metadata success from content verification

The core uses separate checks for:

1. Source identity: full-file BLAKE3 before and after processing, with another check before commit.
2. Metadata read-back: requested field values must survive serialization.
3. Strict image absence: a complete output scan must report no removable metadata blocks or trailing bytes under the container rules.
4. Content scope: strict source/output hashes compare the image containers after the same removal rules; ordinary image edits retain their existing encoded-image comparison; audio/video compare demuxed compressed A/V packet hashes.
5. Video inventory: selected stream, codec and disposition properties.
6. Recovery: backup hash before replacement; current-file and backup hashes before restore.

Strict output inspection and content verification must both succeed and cannot be bypassed by unverified opt-in. Encoded-data equality does not imply identical display after the deliberate orientation/profile removal. Independent decoding and animation checks in the fixture suite provide additional evidence for those tested files; they do not turn the operation into a universal forensic sanitizer or a C2PA validator.

Primary reference for hashing: [BLAKE3 Rust implementation](https://docs.rs/blake3/latest/blake3/).

## Branding basis

The application uses the owner's supplied `KIWordmarkNoLogo2026(1).png` and `KIBanner(2).png`. The interface follows their black/white/red visual language. The app icon is derived from the supplied radial emblem. No external fonts are bundled, and no replacement logo was invented.

## Extension and qualification boundary

Additional adapters can implement the same inspection, sparse-patch, staging and verification contract. Future format support should be qualified per operation: inspect, edit, clear, strict strip, preserve encoded rendering data, verify and restore. A long file-extension list is not a substitute for a supported capability matrix.

Compilation, native fixture tests, browser-preview checks, Windows cross-compilation and native Windows desktop acceptance are distinct evidence. Record the exact tested artifact and follow [WINDOWS_ACCEPTANCE.md](WINDOWS_ACCEPTANCE.md) before claiming that a Windows package has passed native acceptance.
