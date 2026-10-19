# Formats and cleanup scope · 0.4.0

The extension registry has 84 routes. Extensions select an adapter; the actual file must parse successfully and advertise a compatible operation before saving. A recognized extension is not a guarantee that every codec, camera variant, compression method or proprietary structure can be edited.

## Complete registry

| Family | Extensions | Editing and verification |
|---|---|---|
| Native images (5) | jpg, jpeg, png, apng, webp | JPEG/PNG descriptive XMP; all five routes support strict stripping when structurally valid. Strict output must pass container scan and encoded-content comparison. WebP has no descriptive editor. |
| Extended images (35) | tif, tiff, heic, heif, hif, avif, jxl, dng, nef, nrw, arw, cr2, cr3, orf, rw2, pef, srw, raf, rwl, mos, mrw, iiq, 3fr, mef, erf, kdc, dcr, sr2, srf, x3f, jp2, jpx, psd, psb, gif | ExifTool inventory; curated XMP edits when supported. Main-image fingerprint where available; otherwise metadata-readback copies only. Restrictions below apply. |
| Audio (12) | mp3, flac, wav, wave, aif, aiff, aifc, m4a, m4b, ogg, oga, opus | Lofty native tags/artwork. Editable keys depend on the detected tag family. FFmpeg compares demuxed audio/video packet hashes. |
| Video (8) | mp4, mov, m4v, mkv, webm, avi, wmv, asf | Supported container text tags; explicit all-stream remux acknowledgment. Stream inventory plus audio/video packet hashes. |
| PDF (1) | pdf | Info properties and mapped XMP synchronization. Full rewrite; reachable content-object graph hash excludes metadata/storage bookkeeping. |
| Office Open XML (14) | docx, docm, dotx, dotm, xlsx, xlsm, xltx, xltm, pptx, pptm, potx, potm, ppsx, ppsm | Existing core/app/custom property parts. Every non-metadata package member's name, length and decompressed content is hashed. |
| OpenDocument (9) | odt, ods, odp, odg, odf, ott, ots, otp, otg | Existing meta.xml property part; non-metadata package-content hash. |
| Other regular files | Any other extension, or no extension | File name, size and fingerprint, plus ExifTool metadata when readable. No generic writer. Renaming an extension does not make unsupported content editable. |

## Policies

| Policy | Meaning |
|---|---|
| Keep existing | Apply only explicit supported field/removal/artwork changes. Unedited metadata is retained within the adapter's preservation limits. |
| Clear descriptive | Clear the adapter's descriptive tag/property scope, then apply any explicit new values. Audio removes the known tag families; video clears container metadata; extended images clear XMP/IPTC and descriptive EXIF; documents clear property parts. |
| Privacy cleanup | Format-specific location/identity/software/source fields. For documents this clears the document-property scope. It is not a universal all-block sanitizer. Explicit new supported values are applied after cleanup. |
| Strip image metadata | Strict JPEG/PNG/APNG/WebP container policy. Removes EXIF, GPS, XMP, IPTC, C2PA/JUMBF, text/private chunks, ICC and trailing data; disallows new metadata and requires the strict scan and encoded-content match. |

The Sharing screen chooses strict stripping for native images and scoped privacy cleanup where that adapter supports it. It replaces prior drafts for eligible files. Unsupported files remain visible and are reported as skipped. Review the scope before saving a mixed batch.

## Extended images and camera files

Editable XMP fields are title, creator, description, rights, keywords, credit, creation date and rating. The raw editor permits only those same supported XMP keys. Existing camera EXIF, binary IPTC, RAW calibration and arbitrary proprietary fields are not generic writable inputs.

Privacy cleanup removes XMP/IPTC and enumerated descriptive EXIF, GPS, owner/body/lens serial, software, image-unique ID and capture/create/modify timestamps, plus supported JUMBF groups. Camera calibration, orientation and embedded color profiles remain. Unknown maker metadata, previews and private structures may remain. A cleanup fails if readback still exposes a targeted GPS/JUMBF/IPTC group.

- **3FR, DCR, KDC and SRF** are inspection-only.
- **X3F** variants without a writable JPEG preview are inspection-only. Supported modern variants permit XMP edits in that preview only; privacy/clear policies are not offered.
- **GIF and PSD** test fixtures permit XMP edits but lack an image-data fingerprint. They return `metadata_only` and are copy-only. Other variants use the same rule whenever the fingerprint is unavailable.
- A bare **JXL codestream** is placed inside a standard metadata-capable JXL container without re-encoding. Compressed JXL metadata requires Brotli support; the bundled Windows ExifTool includes it. An engine missing that decoder exposes inspection only.
- Undersized or otherwise invalid RAW fixtures can be inspected but may be refused by the writer. Refusal does not produce a committed output.

ExifTool's [ImageDataHash documentation](https://exiftool.org/TagNames/Extra.html) describes its coverage: main image data, with some format-specific preview inclusion, not every thumbnail or private block. This app combines that SHA-256 with selected rendering/ICC values. A match is evidence for that defined scope, not a full photographic rendering or every-camera-calibration proof.

## Documents

PDF fields: title, author, subject/description, keywords, creator software and producer. Mapped XMP values are kept consistent with those edits. Cleanup removes Info, Metadata streams/references, document IDs and obsolete/unreachable property objects by writing a new PDF, avoiding an incremental append that leaves earlier properties recoverable. See ExifTool's [PDF write limitation](https://exiftool.org/TagNames/PDF.html) for why this adapter uses a full rewrite.

Office fields include title, creator, subject, description, language, keywords, category, last modified by, company and manager where the corresponding property part exists. OpenDocument includes title, creator, initial creator, description, subject, language and keywords. Cleanup empties the existing property payloads, including custom properties, before any explicitly requested new fields. Absent property parts are not created in this release.

Signed/encrypted documents are inspection-only. Signature detection includes nested PDF signature structures and Office signature content types/paths. Invalid, oversized, DTD-bearing or excessively deep property XML cannot reach a document writer. PDF property cleanup can discard malformed metadata even when it cannot be safely parsed.

Document limits: 512 MiB input; up to 20,000 ZIP members and 2 GiB declared expanded content; metadata parts at most 8 MiB and XML depth 64. PDF decompression is bounded per stream. Non-metadata package members are copied without re-encoding. The app does not execute macros or embedded content.

Cleanup leaves body text, comments, tracked changes, notes, formulas, attachments and embedded files intact. A property-clean document can still identify its authors through those contents.

## Audio and video

Audio privacy cleanup removes enumerated software, comment, owner, encoding-date and source-path fields; artist and rights credits remain unless explicitly changed/removed. Unknown/private tags can remain. WAV/AIFF full release fields use embedded ID3 and may not display in every player. Label and publisher are distinct mappings.

Video privacy cleanup removes recognized sensitive container/stream text keys. Clear descriptive removes container tags. Chapters, subtitles, attachments, rotation and language are not a universal cleanup target. All input streams are mapped; unsupported output combinations fail instead of silently dropping streams. A stream-copy remux can change container structure/timing and unknown metadata. Packet checks do not establish subtitle, attachment, timing or player equivalence.

The optional unverified-copy acknowledgment is restricted to audio/video when verification is unavailable. It cannot bypass a genuine mismatch, enable original replacement, or relax document/image checks.

## Other files

Archives, legacy Office binary files, executables and unrecognized formats remain useful to inspect, but there is no arbitrary binary-property editor. The interface can export a JSON inventory for ecosystem tooling. Such an export may contain private source metadata and is not a cleaned copy of the file.

## Inventory and signature hints in 0.4.0

Every inspected regular file receives a streaming SHA-256 and BLAKE3 fingerprint when it can be read consistently. Inspect exposes the first header bytes and recognized container/MIME hints, including common image/media formats, PDF, ZIP/Office/ODF families, 7z/RAR/gzip, legacy OLE, DOS/PE and ELF. These are inventory hints, not new write adapters or complete format validation.

A recognized extension mismatch forces read-only capabilities. Unknown signatures remain subject to the actual parser and existing writer qualification. When metadata parsing fails, `inventory` can return read-only evidence with a diagnostic; `inspect` retains strict failures. Unknown files, unsupported variants and malformed containers never gain a generic write path. A container signature cannot distinguish every Office subtype, RAW variant or multiplexed media codec.
