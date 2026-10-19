//! Complete container walks for strict, local image metadata removal.
//!
//! These parsers deliberately do not use the descriptive metadata reader as
//! evidence of absence. JPEG is walked through every scan to EOI, PNG through
//! IEND, and WebP through RIFF including ANMF subchunks. Unknown *metadata* is
//! discarded by an allowlist; unsupported critical structures fail closed.
//! Compressed pixels are never decoded or re-encoded here. EXIF orientation and
//! ICC profiles are deliberately removed and reported as appearance changes.
use anyhow::{bail, ensure, Context, Result};
use serde::Serialize;
use std::collections::BTreeSet;

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

#[derive(Debug, Clone, Serialize)]
pub struct PrivacyReport {
    pub removable_blocks: usize,
    pub categories: BTreeSet<String>,
    pub trailing_bytes: usize,
    pub exif_orientation: Option<u32>,
    pub color_profiles: usize,
    #[serde(skip)]
    seen_exif: bool,
}
impl Default for PrivacyReport {
    fn default() -> Self {
        Self { removable_blocks: 0, categories: BTreeSet::new(), trailing_bytes: 0,
            exif_orientation: None, color_profiles: 0, seen_exif: false }
    }
}
impl PrivacyReport {
    fn remove(&mut self, category: &str, data: &[u8]) {
        self.removable_blocks += 1;
        self.categories.insert(category.to_owned());
        // Classification is informative only. All disallowed blocks are removed
        // regardless of key, language, compression, or recognizable generator.
        let text = String::from_utf8_lossy(&data[..data.len().min(65536)]).to_ascii_lowercase();
        if ["parameters", "stable diffusion", "stablediffusion", "comfyui", "workflow",
            "invokeai", "negative prompt", "trainedalgorithmicmedia", "digitalSourceType",
            "dall-e", "dall·e", "midjourney", "c2pa.created", "cfg scale", "sampler:"]
            .iter().any(|s| text.contains(&s.to_ascii_lowercase())) || text.starts_with("prompt\0") {
            self.categories.insert("AI generation".into());
        }
    }
    fn exif(&mut self, data: &[u8]) {
        self.remove("EXIF", data);
        let data = data.strip_prefix(b"Exif\0\0").unwrap_or(data);
        let parsed = if data.len() <= 2 * 1024 * 1024 {
            exif::Reader::new().read_raw(data.to_vec()).ok()
        } else { None };
        let orientation = parsed.as_ref().and_then(|exif| {
            let value = exif.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
                .and_then(|f| f.value.get_uint(0)).unwrap_or(1);
            (1..=8).contains(&value).then_some(value)
        });
        if parsed.as_ref().map(|e| e.fields().any(|f| f.tag.to_string().starts_with("GPS"))).unwrap_or(false) {
            self.categories.insert("GPS".into());
        }
        if !self.seen_exif { self.exif_orientation = orientation; }
        else if self.exif_orientation != orientation { self.exif_orientation = None; }
        self.seen_exif = true;
    }
    fn profile(&mut self, data: &[u8]) {
        self.color_profiles += 1;
        self.remove("ICC color profile", data);
    }
    fn trailer(&mut self, length: usize) {
        self.trailing_bytes += length;
        if length != 0 { self.categories.insert("Trailing data".into()); }
    }
    pub fn is_clean(&self) -> bool { self.removable_blocks == 0 && self.trailing_bytes == 0 }
}

pub struct CleanImage {
    pub bytes: Vec<u8>,
    pub report: PrivacyReport,
    pub format: &'static str,
    pub width: Option<u32>,
    pub height: Option<u32>,
}
pub fn clean(data: &[u8]) -> Result<CleanImage> {
    ensure!(data.len() <= 256 * 1024 * 1024, "Image exceeds the 256 MiB limit");
    if data.starts_with(b"\xff\xd8") { jpeg(data) }
    else if data.starts_with(PNG_SIGNATURE) { png(data) }
    else if data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP") { webp(data) }
    else { bail!("Expected a JPEG, PNG or WebP image signature") }
}

fn be16(data: &[u8]) -> usize { u16::from_be_bytes([data[0], data[1]]) as usize }
fn be32(data: &[u8]) -> u32 { u32::from_be_bytes(data[..4].try_into().unwrap()) }
fn le32(data: &[u8]) -> u32 { u32::from_le_bytes(data[..4].try_into().unwrap()) }
fn le24(data: &[u8]) -> u32 { data[0] as u32 | ((data[1] as u32) << 8) | ((data[2] as u32) << 16) }

fn jpeg_segment(out: &mut Vec<u8>, marker: u8, body: &[u8]) {
    out.extend_from_slice(&[0xff, marker]);
    out.extend_from_slice(&((body.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(body);
}
fn validate_jpeg_tables(marker: u8, body: &[u8]) -> Result<()> {
    ensure!(!body.is_empty(), "Empty JPEG coding table");
    let mut pos = 0usize;
    while pos < body.len() {
        let table = body[pos]; pos += 1;
        ensure!(table & 15 <= 3 && table >> 4 <= 1, "Unsupported JPEG coding table selector");
        let length = match marker {
            0xdb => 64 * (1 + (table >> 4) as usize),
            0xc4 => {
                ensure!(pos + 16 <= body.len(), "Truncated JPEG Huffman counts");
                let symbols: usize = body[pos..pos + 16].iter().map(|b| *b as usize).sum();
                ensure!(symbols <= 256, "Invalid JPEG Huffman symbol count");
                16 + symbols
            }
            0xcc => {
                ensure!(pos < body.len(), "Truncated JPEG arithmetic conditioning");
                let value = body[pos];
                ensure!(if table >> 4 == 0 { value & 15 <= value >> 4 } else { value <= 63 },
                    "Invalid JPEG arithmetic conditioning");
                1
            }
            _ => unreachable!(),
        };
        pos += length;
        ensure!(pos <= body.len(), "Truncated JPEG coding table or extraneous segment payload");
    }
    Ok(())
}
fn jpeg(data: &[u8]) -> Result<CleanImage> {
    let mut result = CleanImage { bytes: vec![0xff, 0xd8], report: PrivacyReport::default(),
        format: "JPEG", width: None, height: None };
    let mut pos = 2usize;
    let mut scans = 0;
    loop {
        ensure!(data.get(pos) == Some(&0xff), "Invalid JPEG marker at byte {pos}");
        let start = pos;
        while data.get(pos) == Some(&0xff) { pos += 1; }
        let marker = *data.get(pos).context("Truncated JPEG marker")?;
        pos += 1;
        match marker {
            0xd9 => {
                ensure!(scans > 0 && result.width.is_some(), "JPEG has no complete image scan");
                result.bytes.extend_from_slice(&data[start..pos]);
                result.report.trailer(data.len() - pos);
                return Ok(result);
            }
            0xd8 | 0x00 | 0xd0..=0xd7 => bail!("Unexpected JPEG marker 0x{marker:02x}"),
            0x01 => { result.bytes.extend_from_slice(&data[start..pos]); continue; }
            _ => (),
        }
        ensure!(pos + 2 <= data.len(), "Truncated JPEG segment length");
        let length = be16(&data[pos..]);
        ensure!(length >= 2, "Invalid JPEG segment length");
        let end = pos.checked_add(length).context("JPEG segment length overflow")?;
        ensure!(end <= data.len(), "Truncated JPEG segment");
        let body = &data[pos + 2..end];
        match marker {
            0xe0 if body.starts_with(b"JFIF\0") => {
                ensure!(body.len() >= 14, "Truncated JFIF header");
                let thumbnail_size = 3 * body[12] as usize * body[13] as usize;
                ensure!(body.len() >= 14 + thumbnail_size, "Truncated JFIF thumbnail");
                let mut fixed = body[..14].to_vec();
                fixed[12] = 0; fixed[13] = 0;
                if body.len() != 14 || thumbnail_size != 0 {
                    result.report.remove("Embedded thumbnails", &body[14..]);
                }
                jpeg_segment(&mut result.bytes, marker, &fixed);
            }
            0xee if body.starts_with(b"Adobe") => {
                ensure!(body.len() >= 12, "Truncated Adobe color transform header");
                if body.len() != 12 { result.report.remove("Other private blocks", &body[12..]); }
                jpeg_segment(&mut result.bytes, marker, &body[..12]);
            }
            0xe1 if body.starts_with(b"Exif\0\0") => result.report.exif(body),
            0xe1 if body.starts_with(b"http://ns.adobe.com/") => result.report.remove("XMP", body),
            0xe2 if body.starts_with(b"ICC_PROFILE\0") => result.report.profile(body),
            0xeb => result.report.remove("C2PA / JUMBF", body),
            0xed => result.report.remove("IPTC", body),
            0xfe => result.report.remove("Text / comments", body),
            0xe0..=0xef => result.report.remove("Other private blocks", body),
            0xc0..=0xc7 | 0xc9..=0xcf | 0xda..=0xdf => {
                if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf | 0xde) {
                    ensure!(body.len() >= 6, "Truncated JPEG frame header");
                    result.height = Some(be16(&body[1..]) as u32);
                    result.width = Some(be16(&body[3..]) as u32);
                    ensure!(result.width != Some(0), "Invalid JPEG width");
                    ensure!(body.len() == 6 + 3 * body[5] as usize, "Invalid JPEG frame component length");
                }
                if marker == 0xda { ensure!(!body.is_empty() && (1..=4).contains(&body[0]) && body.len() == 4 + 2 * body[0] as usize, "Invalid JPEG scan header"); }
                if marker == 0xdd { ensure!(body.len() == 2, "Invalid JPEG restart interval"); }
                if marker == 0xdc { ensure!(body.len() == 2 && be16(body) > 0, "Invalid JPEG number of lines"); result.height = Some(be16(body) as u32); }
                if marker == 0xdf { ensure!(body.len() == 1 && body[0] >> 4 <= 1 && body[0] & 15 <= 1, "Invalid JPEG expansion header"); }
                if matches!(marker, 0xc4 | 0xcc | 0xdb) { validate_jpeg_tables(marker, body)?; }
                result.bytes.extend_from_slice(&data[start..end]);
            }
            _ => bail!("Unsupported structural JPEG marker 0x{marker:02x}; no file was written"),
        }
        pos = end;
        if marker == 0xda {
            ensure!(result.width.is_some(), "JPEG scan precedes frame header");
            scans += 1;
            let scan_start = pos;
            loop {
                ensure!(pos < data.len(), "JPEG scan has no EOI marker");
                if data[pos] != 0xff { pos += 1; continue; }
                let marker_start = pos;
                while data.get(pos) == Some(&0xff) { pos += 1; }
                let next = *data.get(pos).context("Truncated JPEG scan marker")?;
                if next == 0x00 || next == 0x01 || (0xd0..=0xd7).contains(&next) {
                    pos += 1; continue;
                }
                if next == 0xdc {
                    // DNL is allowed inside an entropy-coded scan and does not
                    // terminate that scan. It contains exactly one line count.
                    ensure!(pos + 5 <= data.len() && be16(&data[pos + 1..]) == 4,
                        "Invalid JPEG DNL inside scan");
                    let height = be16(&data[pos + 3..]);
                    ensure!(height > 0, "Invalid JPEG DNL height");
                    result.height = Some(height as u32); pos += 5; continue;
                }
                // Includes entropy bytes, stuffed FF00, and all restart markers.
                result.bytes.extend_from_slice(&data[scan_start..marker_start]);
                pos = marker_start;
                break;
            }
        }
    }
}

fn png(data: &[u8]) -> Result<CleanImage> {
    let mut result = CleanImage { bytes: PNG_SIGNATURE.to_vec(), report: PrivacyReport::default(),
        format: "PNG", width: None, height: None };
    let mut pos = 8usize;
    let mut image_data = false;
    let mut header = false;
    let mut color_type = 0;
    let mut palette_entries = 0;
    while pos < data.len() {
        ensure!(pos + 12 <= data.len(), "Truncated PNG chunk header");
        let length = be32(&data[pos..]) as usize;
        ensure!(length <= 0x7fffffff, "Invalid PNG chunk length");
        let end = pos.checked_add(length).and_then(|n| n.checked_add(12)).context("PNG length overflow")?;
        ensure!(end <= data.len(), "Truncated PNG chunk");
        let kind: &[u8; 4] = data[pos + 4..pos + 8].try_into().unwrap();
        ensure!(kind.iter().all(u8::is_ascii_alphabetic), "Invalid PNG chunk type");
        let body = &data[pos + 8..end - 4];
        ensure!(header || kind == b"IHDR", "PNG must begin with IHDR");
        let retained = matches!(kind, b"IHDR" | b"PLTE" | b"IDAT" | b"IEND" | b"tRNS" |
            b"gAMA" | b"cHRM" | b"sRGB" | b"cICP" | b"mDCV" | b"cLLI" |
            b"sBIT" | b"bKGD" | b"pHYs" | b"acTL" | b"fcTL" | b"fdAT");
        if retained {
            ensure!(crc32fast::hash(&data[pos + 4..end - 4]) == be32(&data[end - 4..]),
                "PNG rendering chunk {} has an invalid CRC", String::from_utf8_lossy(kind));
            match kind {
                b"IHDR" => {
                    ensure!(!header && length == 13, "Invalid or duplicate PNG IHDR");
                    header = true;
                    let width = be32(body); let height = be32(&body[4..]);
                    ensure!(width > 0 && height > 0 && width <= 0x7fffffff && height <= 0x7fffffff,
                        "Invalid PNG dimensions");
                    result.width = Some(width); result.height = Some(height);
                    ensure!(body[10] == 0 && body[11] == 0 && body[12] <= 1,
                        "Unsupported PNG compression, filter or interlace method");
                    color_type = body[9];
                    ensure!(match color_type {
                        0 => matches!(body[8], 1|2|4|8|16),
                        2|4|6 => matches!(body[8], 8|16),
                        3 => matches!(body[8], 1|2|4|8),
                        _ => false,
                    }, "Invalid PNG bit depth or color type");
                }
                b"IDAT" => image_data = true,
                b"IEND" => ensure!(length == 0 && image_data, "PNG lacks valid image data or IEND"),
                b"acTL" => ensure!(length == 8, "Invalid APNG animation control"),
                b"fcTL" => ensure!(length == 26, "Invalid APNG frame control"),
                b"fdAT" => ensure!(length >= 4, "Truncated APNG frame data"),
                b"gAMA" | b"cICP" => ensure!(length == 4, "Invalid PNG rendering chunk length"),
                b"cHRM" => ensure!(length == 32, "Invalid PNG chromaticities"),
                b"sRGB" => ensure!(length == 1 && body[0] <= 3, "Invalid PNG sRGB intent"),
                b"mDCV" => ensure!(length == 24, "Invalid PNG mastering display metadata"),
                b"cLLI" => ensure!(length == 8, "Invalid PNG content light metadata"),
                b"pHYs" => ensure!(length == 9 && body[8] <= 1, "Invalid PNG physical dimensions"),
                b"PLTE" => {
                    ensure!(length > 0 && length <= 768 && length % 3 == 0, "Invalid PNG palette");
                    palette_entries = length / 3;
                }
                b"sBIT" => ensure!(length == match color_type {0=>1,2|3=>3,4=>2,6=>4,_=>0}, "Invalid PNG significant bits"),
                b"bKGD" => ensure!(length == match color_type {0|4=>2,2|6=>6,3=>1,_=>0}, "Invalid PNG background"),
                b"tRNS" => ensure!(match color_type {0=>length==2,2=>length==6,3=>length>0&&length<=palette_entries,_=>false}, "Invalid PNG transparency"),
                _ => (),
            }
            result.bytes.extend_from_slice(&data[pos..end]);
        } else {
            ensure!(kind[0] & 0x20 != 0, "Unsupported critical PNG chunk {}", String::from_utf8_lossy(kind));
            match kind {
                b"eXIf" => result.report.exif(body),
                b"caBX" => result.report.remove("C2PA / JUMBF", body),
                b"iCCP" => result.report.profile(body),
                b"tEXt" | b"iTXt" | b"zTXt" => {
                    let category = if body.starts_with(b"XML:com.adobe.xmp\0") { "XMP" } else { "Text / comments" };
                    result.report.remove(category, body);
                }
                _ => result.report.remove("Other private blocks", body),
            }
        }
        pos = end;
        if kind == b"IEND" {
            result.report.trailer(data.len() - pos);
            return Ok(result);
        }
    }
    bail!("PNG has no IEND chunk")
}

fn riff_chunk(out: &mut Vec<u8>, kind: &[u8; 4], body: &[u8]) {
    out.extend_from_slice(kind);
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(body);
    if body.len() % 2 != 0 { out.push(0); }
}
fn webp_metadata(kind: &[u8; 4], body: &[u8], report: &mut PrivacyReport) {
    match kind {
        b"EXIF" => report.exif(body),
        b"XMP " => report.remove("XMP", body),
        b"C2PA" => report.remove("C2PA / JUMBF", body),
        b"ICCP" => report.profile(body),
        _ => report.remove("Other private blocks", body),
    }
}
// Returns compressed-image count. ANMF has precisely one bitstream; the root
// may instead contain multiple frames. Unknown ANMF chunks are not image data.
fn webp_chunks(data: &[u8], frame: bool, report: &mut PrivacyReport, width: &mut Option<u32>, height: &mut Option<u32>) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(data.len());
    let mut pos = 0usize;
    let mut bitstreams = 0usize;
    let mut frames = 0usize;
    let mut extended = false;
    let mut animated = false;
    let mut animation_header = false;
    let mut alpha = false;
    while pos < data.len() {
        ensure!(pos + 8 <= data.len(), "Truncated WebP chunk header");
        let kind: &[u8; 4] = data[pos..pos + 4].try_into().unwrap();
        let length = le32(&data[pos + 4..]) as usize;
        let body_end = pos.checked_add(8).and_then(|n| n.checked_add(length)).context("WebP length overflow")?;
        let end = body_end.checked_add(length & 1).context("WebP padding overflow")?;
        ensure!(end <= data.len(), "Truncated WebP chunk or padding");
        let body = &data[pos + 8..body_end];
        let allowed = if frame { matches!(kind, b"ALPH" | b"VP8 " | b"VP8L") }
            else { matches!(kind, b"VP8X" | b"ANIM" | b"ANMF" | b"ALPH" | b"VP8 " | b"VP8L") };
        if allowed {
            if length % 2 != 0 && data[body_end] != 0 { report.remove("Padding data", &data[body_end..end]); }
            match kind {
                b"VP8X" => {
                    ensure!(pos == 0 && !extended && length == 10, "Invalid WebP extended header");
                    extended = true; animated = body[0] & 2 != 0;
                    *width = Some(le24(&body[4..]) + 1); *height = Some(le24(&body[7..]) + 1);
                    let mut fixed = body.to_vec();
                    fixed[0] &= 0x12; // Keep alpha and animation; remove EXIF/XMP/ICC and reserved bits.
                    fixed[1..4].fill(0);
                    if fixed != body { report.remove("Metadata flags", body); }
                    riff_chunk(&mut out, kind, &fixed);
                }
                b"ANIM" => {
                    ensure!(extended && animated && !animation_header && frames == 0 && length == 6,
                        "Invalid WebP animation header");
                    animation_header = true;
                    riff_chunk(&mut out, kind, body);
                }
                b"ANMF" => {
                    ensure!(extended && animated && animation_header && length >= 16,
                        "Invalid WebP animation frame");
                    let mut rebuilt = body[..16].to_vec();
                    if rebuilt[15] & 0xfc != 0 { report.remove("Padding data", &rebuilt[15..16]); rebuilt[15] &= 3; }
                    let mut frame_width = Some(le24(&body[6..]) + 1);
                    let mut frame_height = Some(le24(&body[9..]) + 1);
                    rebuilt.extend(webp_chunks(&body[16..], true, report, &mut frame_width, &mut frame_height)?);
                    riff_chunk(&mut out, kind, &rebuilt);
                    frames += 1;
                }
                b"ALPH" => {
                    ensure!((frame || extended) && !alpha && bitstreams == 0 && !body.is_empty(), "Invalid WebP alpha chunk");
                    ensure!(body[0] & 3 <= 1 && (body[0] >> 4) & 3 <= 1 && body[0] & 0xc0 == 0,
                        "Unsupported WebP alpha encoding");
                    if body[0] & 3 == 0 {
                        let samples = (width.context("Missing WebP alpha width")? as usize)
                            .checked_mul(height.context("Missing WebP alpha height")? as usize)
                            .context("WebP alpha dimensions overflow")?;
                        ensure!(body.len() == samples + 1, "Invalid raw WebP alpha length");
                    }
                    alpha = true; riff_chunk(&mut out, kind, body);
                }
                b"VP8 " | b"VP8L" => {
                    ensure!(bitstreams == 0 && !body.is_empty() && (frame || !animated), "Invalid WebP image inventory");
                    if kind == b"VP8L" {
                        ensure!(!alpha && body.len() >= 5 && body[0] == 0x2f && body[4] & 0xe0 == 0,
                            "Invalid lossless WebP bitstream header");
                        if width.is_none() {
                            let dimensions = le32(&body[1..]);
                            *width = Some((dimensions & 0x3fff) + 1);
                            *height = Some(((dimensions >> 14) & 0x3fff) + 1);
                        }
                    } else {
                        ensure!(body.len() >= 10 && body[0] & 1 == 0 && &body[3..6] == b"\x9d\x01\x2a",
                            "Invalid lossy WebP bitstream header");
                        if width.is_none() {
                            *width = Some((u16::from_le_bytes([body[6],body[7]]) & 0x3fff) as u32);
                            *height = Some((u16::from_le_bytes([body[8],body[9]]) & 0x3fff) as u32);
                        }
                    }
                    bitstreams += 1; riff_chunk(&mut out, kind, body);
                }
                _ => unreachable!(),
            }
        } else { webp_metadata(kind, body, report); }
        pos = end;
    }
    ensure!(if frame || !animated { bitstreams == 1 && frames == 0 } else { bitstreams == 0 && frames > 0 },
        "WebP has no valid image/frame inventory");
    Ok(out)
}
fn webp(data: &[u8]) -> Result<CleanImage> {
    ensure!(data.len() >= 12, "Truncated WebP RIFF header");
    let end = (le32(&data[4..]) as usize).checked_add(8).context("WebP RIFF length overflow")?;
    ensure!(end >= 12 && end <= data.len() && end % 2 == 0, "Invalid WebP RIFF length");
    let mut result = CleanImage { bytes: b"RIFF\0\0\0\0WEBP".to_vec(), report: PrivacyReport::default(),
        format: "WebP", width: None, height: None };
    result.bytes.extend(webp_chunks(&data[12..end], false, &mut result.report, &mut result.width, &mut result.height)?);
    let length = (result.bytes.len() - 8) as u32;
    result.bytes[4..8].copy_from_slice(&length.to_le_bytes());
    result.report.trailer(data.len() - end);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn chunk(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = (body.len() as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind); out.extend_from_slice(body);
        let crc = crc32fast::hash(&out[4..]); out.extend_from_slice(&crc.to_be_bytes()); out
    }
    fn small_png() -> Vec<u8> {
        let mut png = PNG_SIGNATURE.to_vec();
        png.extend(chunk(b"IHDR", &[0,0,0,1,0,0,0,1,8,2,0,0,0]));
        png.extend(chunk(b"IDAT", &[0x78,0x9c,0x63,0x60,0x60,0x60,0,0,0,4,0,1]));
        png.extend(chunk(b"IEND", &[])); png
    }
    #[test] fn arbitrary_png_metadata_and_trailer_are_removed() {
        let original = small_png(); let mut source = original[..33].to_vec();
        source.extend(chunk(b"caBX", b"c2pa"));
        source.extend(chunk(b"zTXt", b"parameters\0\0not-zlib"));
        source.extend(chunk(b"eXIf", b"malformed-exif"));
        source.extend(chunk(b"iCCP", b"private-profile"));
        source.extend(chunk(b"kiDT", b"private-company-data"));
        source.extend_from_slice(&original[33..]); source.extend_from_slice(b"private-trailer");
        let cleaned = clean(&source).unwrap();
        assert_eq!(cleaned.bytes, original);
        assert_eq!(cleaned.report.removable_blocks, 5);
        assert!(cleaned.report.categories.contains("AI generation"));
        assert_eq!(cleaned.report.exif_orientation, None);
        assert!(clean(&cleaned.bytes).unwrap().report.is_clean());
    }
    #[test] fn truncated_and_unknown_critical_png_are_rejected() {
        let image = small_png(); assert!(clean(&image[..image.len()-1]).is_err());
        let mut unknown = image[..33].to_vec(); unknown.extend(chunk(b"KIAB", b"unknown"));
        unknown.extend_from_slice(&image[33..]); assert!(clean(&unknown).is_err());
    }
    #[test] fn png_retained_crc_is_verified() {
        let mut image = small_png(); image[45] ^= 1;
        assert!(clean(&image).is_err());
    }
    #[test] fn jpeg_metadata_after_scan_is_not_treated_as_pixels() {
        // Structural fixture exercises the marker walk; real codec fixtures are
        // decoded independently by tests/image-privacy.integration.mjs.
        let mut source = vec![0xff,0xd8];
        jpeg_segment(&mut source, 0xc0, &[8,0,1,0,1,1,1,0x11,0]);
        jpeg_segment(&mut source, 0xda, &[1,1,0,0,63,0]);
        source.extend_from_slice(&[0x12,0xff,0,0x23,0xff,0xd0,0x34]);
        jpeg_segment(&mut source, 0xeb, b"c2pa-private");
        jpeg_segment(&mut source, 0xfe, b"parameters: private");
        jpeg_segment(&mut source, 0xda, &[1,1,0,0,63,0]);
        source.extend_from_slice(&[0x45,0xff,0,0x67,0xff,0xd9]); source.extend_from_slice(b"trailer");
        let result = clean(&source).unwrap();
        assert_eq!(result.report.removable_blocks, 2);
        assert_eq!(result.report.trailing_bytes, 7);
        assert!(result.bytes.windows(7).any(|b| b == [0x12,0xff,0,0x23,0xff,0xd0,0x34]));
        assert_eq!(clean(&result.bytes).unwrap().bytes, result.bytes);
        assert!(clean(&result.bytes).unwrap().report.is_clean());
    }
    #[test] fn oversized_jpeg_rendering_headers_cannot_hide_private_metadata() {
        for marker in [0xc0, 0xda, 0xdd, 0xdf, 0xdb, 0xc4, 0xcc] {
            let mut source = vec![0xff,0xd8];
            if marker != 0xc0 { jpeg_segment(&mut source, 0xc0, &[8,0,1,0,1,1,1,0x11,0]); }
            let mut body = match marker {
                0xc0 => vec![8,0,1,0,1,1,1,0x11,0],
                0xda => vec![1,1,0,0,63,0],
                0xdd | 0xcc => vec![0,0],
                0xdf => vec![0],
                0xdb => vec![0;65],
                0xc4 => vec![0;17],
                _ => unreachable!(),
            };
            body.extend_from_slice(b"PRIVATE EMPLOYEE");
            jpeg_segment(&mut source, marker, &body);
            jpeg_segment(&mut source, 0xda, &[1,1,0,0,63,0]);
            source.extend_from_slice(&[0x12,0xff,0xd9]);
            assert!(clean(&source).is_err(), "marker {marker:x} retained hidden header data");
        }
    }
}
