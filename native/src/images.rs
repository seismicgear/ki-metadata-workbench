use crate::{image_privacy, model::*, xmp};
use anyhow::{bail, Context, Result};
use exif::{In, Tag as ExifTag};
use flate2::read::ZlibDecoder;
use img_parts::{jpeg::{Jpeg, JpegSegment}, png::{Png, PngChunk}, ImageEXIF};
use serde_json::json;
use std::{collections::BTreeMap, fs, io::Read, path::Path};

const XMP_HEADER: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const XMP_EXT: &[u8] = b"http://ns.adobe.com/xmp/extension/\0";
const EXIF_HEADER: &[u8] = b"Exif\0\0";
const LIMIT: u64 = 256 * 1024 * 1024;
fn bytes(path: &Path) -> Result<Vec<u8>> {
    if fs::metadata(path)?.len() > LIMIT { bail!("Image exceeds the 256 MiB V1 limit"); }
    Ok(fs::read(path)?)
}
fn parse_exif(bytes: &[u8]) -> Result<exif::Exif> {
    exif::Reader::new().read_raw(bytes.to_vec()).context("Malformed EXIF; cannot safely preserve orientation")
}
fn orientation(exif: Option<&[u8]>) -> Result<u32> {
    let Some(data) = exif else { return Ok(1); };
    let exif = parse_exif(data)?;
    let value = exif.get_field(ExifTag::Orientation, In::PRIMARY).and_then(|f| f.value.get_uint(0)).unwrap_or(1);
    if !(1..=8).contains(&value) { bail!("Invalid EXIF orientation"); }
    Ok(value)
}
fn minimal_exif(value: u32) -> Vec<u8> {
    let mut result = b"II\x2a\x00\x08\x00\x00\x00\x01\x00\x12\x01\x03\x00\x01\x00\x00\x00".to_vec();
    result.extend_from_slice(&(value as u16).to_le_bytes()); result.extend_from_slice(&[0; 6]); result
}
fn description_segment(segment: &JpegSegment) -> bool {
    let marker = segment.marker(); let b = segment.contents();
    marker == 0xfe || marker == 0xed || (marker == 0xe1 && (b.starts_with(XMP_HEADER) || b.starts_with(XMP_EXT) || b.starts_with(EXIF_HEADER)))
}
fn text_chunk(kind: [u8; 4]) -> bool { matches!(&kind, b"tEXt" | b"iTXt" | b"zTXt" | b"eXIf" | b"tIME") }
fn split_zero(bytes: &[u8]) -> Result<(&[u8], &[u8])> {
    let n = bytes.iter().position(|b| *b == 0).context("Truncated PNG text field")?;
    Ok((&bytes[..n], &bytes[n+1..]))
}
fn inflate(bytes: &[u8]) -> Result<String> {
    let mut data = Vec::new(); ZlibDecoder::new(bytes).take(2 * 1024 * 1024 + 1).read_to_end(&mut data)?;
    if data.len() > 2 * 1024 * 1024 { bail!("Compressed PNG text exceeds 2 MiB"); }
    Ok(String::from_utf8_lossy(&data).to_string())
}
fn png_text(chunk: &PngChunk) -> Result<Option<(String, String)>> {
    if !matches!(&chunk.kind(), b"tEXt" | b"iTXt" | b"zTXt") { return Ok(None); }
    let (key, rest) = split_zero(chunk.contents())?;
    let key = String::from_utf8_lossy(key).to_string();
    let value = match &chunk.kind() {
        b"tEXt" => rest.iter().map(|v| char::from(*v)).collect(),
        b"zTXt" => { if rest.first() != Some(&0) { bail!("Unsupported PNG text compression"); } inflate(&rest[1..])? },
        _ => {
            if rest.len() < 2 { bail!("Truncated PNG iTXt"); }
            let flag = rest[0]; if rest[1] != 0 || flag > 1 { bail!("Unsupported PNG iTXt encoding"); }
            let (_, r) = split_zero(&rest[2..])?; let (_, text) = split_zero(r)?;
            if flag == 1 { inflate(text)? } else { String::from_utf8(text.to_vec())? }
        }
    };
    Ok(Some((key, value)))
}
fn add_exif(raw: Option<&[u8]>, doc: &mut Inspection) {
    if let Some(bytes) = raw {
        match parse_exif(bytes) {
            Ok(exif) => {
                for field in exif.fields() {
                    doc.raw.push(RawField {namespace: format!("EXIF/{}", field.ifd_num), key: format!("{}", field.tag), value: field.display_value().with_unit(&exif).to_string(), writable: false});
                }
            }, Err(e) => doc.warnings.push(e.to_string()),
        }
    }
}
fn add_xmp(xml: &str, doc: &mut Inspection) {
    match xmp::read(xml) { Ok(fields) => doc.fields.extend(fields), Err(e) => doc.warnings.push(e.to_string()) }
    doc.raw.push(RawField {namespace: "XMP".into(), key: "Packet".into(), value: xml.into(), writable: false});
}
pub fn inspect(path: &Path, doc: &mut Inspection) -> Result<()> {
    let data = bytes(path)?;
    let clean = image_privacy::clean(&data)?;
    let expected_format = match doc.format.as_str() { "JPG" | "JPEG" => "JPEG", "PNG" | "APNG" => "PNG", "WEBP" => "WebP", _ => "" };
    if clean.format != expected_format { bail!("The image signature does not match its filename extension"); }
    doc.properties["image_privacy"] = serde_json::to_value(&clean.report)?;
    if let Some(width) = clean.width { doc.properties["width"] = json!(width); }
    if let Some(height) = clean.height { doc.properties["height"] = json!(height); }
    if clean.format == "WebP" {
        doc.properties["orientation"] = json!(if clean.report.categories.contains("EXIF") {clean.report.exif_orientation} else {Some(1)});
        doc.properties["tag_family"] = json!("WebP image privacy inspection");
        doc.capabilities = Capabilities { fields: vec![], artwork: false, raw_edit: false,
            policies: vec!["keep".into(), "strip_metadata".into()], writer: "Rust / WebP container privacy".into() };
        for category in &clean.report.categories {
            doc.raw.push(RawField { namespace: "Image container".into(), key: category.clone(),
                value: "Detected by the complete container scan; removed by Strip image metadata.".into(), writable: false });
        }
        return Ok(());
    }
    let mut descriptive_fallback = false;
    let (orient, blocks) = if data.starts_with(b"\xff\xd8") {
        let image = Jpeg::from_bytes(data.into())?; let exif = image.exif();
        add_exif(exif.as_deref(), doc);
        for segment in image.segments() {
            let b = segment.contents();
            if b.starts_with(XMP_HEADER) { add_xmp(&String::from_utf8_lossy(&b[XMP_HEADER.len()..]), doc); }
            else if segment.marker() == 0xfe { doc.raw.push(RawField {namespace: "JPEG".into(), key: "Comment".into(), value: String::from_utf8_lossy(b).to_string(), writable: false}); }
            else if segment.marker() == 0xed { doc.raw.push(RawField {namespace: "IPTC/Photoshop".into(), key: "APP13".into(), value: format!("{} binary bytes; BLAKE3 {}", b.len(), blake3::hash(b)), writable: false}); }
            if b.starts_with(XMP_EXT) { doc.warnings.push("Extended XMP is present. V1 will not edit it in place; clear descriptive metadata first.".into()); }
            if segment.marker() == 0xeb { doc.warnings.push("APP11/JUMBF content credentials are present. Use Strip image metadata to remove them.".into()); }
        }
        (orientation(exif.as_deref()).ok(), image.segments().len())
    } else if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        let image = match Png::from_bytes(data.into()) {
            Ok(image) => image,
            Err(error) => {
                // The complete scan already validated retained rendering CRCs.
                // Corruption in metadata to be discarded must not block stripping.
                descriptive_fallback = true;
                doc.warnings.push(format!("Descriptive inspection could not read a metadata block ({error}). Strip image metadata can remove it."));
                Png::from_bytes(clean.bytes.clone().into())?
            }
        };
        let exif = image.exif(); add_exif(exif.as_deref(), doc);
        for c in image.chunks() {
            match png_text(c) {
                Ok(Some((key, value))) if key == "XML:com.adobe.xmp" => add_xmp(&value, doc),
                Ok(Some((key, value))) => doc.raw.push(RawField {namespace: "PNG text".into(), key, value, writable: false}),
                Err(e) => doc.warnings.push(e.to_string()), _ => (),
            }
        }
        if let Some(header) = image.chunk_by_type(*b"IHDR") {
            let b = header.contents();
            if b.len() >= 8 {
                doc.properties["width"] = json!(u32::from_be_bytes(b[..4].try_into()?));
                doc.properties["height"] = json!(u32::from_be_bytes(b[4..8].try_into()?));
            }
        }
        (orientation(exif.as_deref()).ok(), image.chunks().len())
    } else { bail!("The file does not contain a supported JPEG or PNG signature"); };
    let _ = orient; // The full scan includes duplicate/late EXIF blocks too.
    doc.properties["orientation"] = json!(if clean.report.categories.contains("EXIF") {clean.report.exif_orientation} else {Some(1)});
    doc.properties["container_blocks"] = json!(blocks);
    doc.properties["tag_family"] = json!("XMP + EXIF inspection");
    doc.capabilities = Capabilities {
        fields: xmp::fields(), artwork: false, raw_edit: false,
        policies: vec!["keep".into(), "clear_descriptive".into(), "privacy".into(), "strip_metadata".into()], writer: "Rust / image parts + XMP + complete privacy scan".into(),
    };
    if descriptive_fallback {
        doc.capabilities.fields.clear();
        doc.capabilities.policies = vec!["strip_metadata".into()];
    }
    doc.warnings.push("Image field edits use XMP. Strip image metadata removes EXIF/GPS, C2PA, generation metadata, text, profiles and private blocks. The other cleanup modes preserve orientation/color profiles and may retain private blocks.".into());
    Ok(())
}
fn xmp_for_write(source: Option<String>, patch: &Patch) -> Result<Option<String>> {
    let mut changes = BTreeMap::new();
    let base = if patch.policy != Policy::Keep {
        if patch.policy == Policy::Privacy {
            if let Some(ref xml) = source {
                for (key, value) in xmp::read(xml)? {
                    if matches!(key.as_str(), "title" | "artist" | "copyright" | "label" | "keywords") { changes.insert(key, Some(value)); }
                }
            }
        }
        None
    } else { source.as_deref() };
    changes.extend(patch.fields.clone());
    let mut custom = BTreeMap::new();
    for raw in &patch.raw {
        if raw.namespace != "XMP/KI" { bail!("Only the XMP/KI custom namespace is writable as raw image metadata"); }
        custom.insert(raw.key.clone(), raw.value.clone());
    }
    if changes.is_empty() && custom.is_empty() { return Ok(base.map(str::to_owned)); }
    Ok(Some(xmp::patch(base, &changes, &custom)?))
}
pub fn write(path: &Path, patch: &Patch) -> Result<Vec<String>> {
    if !matches!(patch.artwork, ArtworkEdit::Keep) { bail!("Album artwork operations do not apply to an image file"); }
    let data = bytes(path)?;
    if patch.policy == Policy::StripMetadata {
        if !patch.fields.is_empty() || !patch.raw.is_empty() {
            bail!("Strip image metadata cannot be combined with staged metadata fields or raw edits");
        }
        let cleaned = image_privacy::clean(&data)?;
        let verified = image_privacy::clean(&cleaned.bytes)?;
        if !verified.report.is_clean() { bail!("Image metadata removal failed its container read-back check"); }
        let mut warnings = vec![];
        match cleaned.report.exif_orientation {
            Some(2..=8) => warnings.push("All EXIF, including orientation, was removed. The output uses the stored pixel orientation and may display rotated or flipped.".into()),
            None if cleaned.report.categories.contains("EXIF") => warnings.push("Malformed or conflicting EXIF was removed. Its prior display orientation could not be determined.".into()),
            _ => (),
        }
        if cleaned.report.color_profiles > 0 {
            warnings.push("Embedded ICC color profiles were removed because they can contain identifying text. Color appearance can change.".into());
        }
        fs::write(path, cleaned.bytes)?;
        return Ok(warnings);
    }
    if data.starts_with(b"RIFF") {
        if patch.policy != Policy::Keep || !patch.fields.is_empty() || !patch.raw.is_empty() {
            bail!("WebP supports inspection and Strip image metadata; descriptive editing is not supported");
        }
        return Ok(vec![]);
    }
    if data.starts_with(b"\xff\xd8") {
        let mut image = Jpeg::from_bytes(data.into())?;
        let exif = image.exif(); let orient = orientation(exif.as_deref())?;
        if patch.policy == Policy::Keep && image.segments().iter().any(|s| s.contents().starts_with(XMP_EXT)) {
            bail!("Extended XMP cannot be safely edited by V1. Clear descriptive metadata first.");
        }
        let packets: Vec<_> = image.segments().iter().filter(|s| s.contents().starts_with(XMP_HEADER)).collect();
        if packets.len() > 1 && patch.policy == Policy::Keep { bail!("Multiple XMP packets require clearing descriptive metadata before editing"); }
        let source = packets.first().map(|s| String::from_utf8(s.contents()[XMP_HEADER.len()..].to_vec())).transpose()?;
        let xml = xmp_for_write(source, patch)?;
        if patch.policy != Policy::Keep {
            image.segments_mut().retain(|s| !description_segment(s));
            if orient != 1 { image.set_exif(Some(minimal_exif(orient).into())); }
        } else { image.segments_mut().retain(|s| !s.contents().starts_with(XMP_HEADER)); }
        if let Some(xml) = xml {
            let mut block = XMP_HEADER.to_vec(); block.extend_from_slice(xml.as_bytes());
            if block.len() > 65533 { bail!("XMP exceeds the single JPEG APP1 segment limit"); }
            let index = if image.segments().first().map(|s| s.marker() == 0xd8).unwrap_or(false) { 1 } else { 0 };
            image.segments_mut().insert(index, JpegSegment::new_with_contents(0xe1, block.into()));
        }
        fs::write(path, image.encoder().bytes())?;
    } else {
        let mut image = Png::from_bytes(data.into())?;
        let exif = image.exif(); let orient = orientation(exif.as_deref())?;
        let mut source = None; let mut xmp_indices = Vec::new();
        for (index, chunk) in image.chunks().iter().enumerate() {
            if let Some((key, value)) = png_text(chunk)? {
                if key == "XML:com.adobe.xmp" { source = Some(value); xmp_indices.push(index); }
            }
        }
        if xmp_indices.len() > 1 && patch.policy == Policy::Keep { bail!("Multiple XMP packets require clearing descriptive metadata before editing"); }
        let xml = xmp_for_write(source, patch)?;
        if patch.policy != Policy::Keep {
            image.chunks_mut().retain(|c| !text_chunk(c.kind()));
            if orient != 1 { image.set_exif(Some(minimal_exif(orient).into())); }
        } else {
            let mut index = 0usize;
            image.chunks_mut().retain(|_| { let keep = !xmp_indices.contains(&index); index += 1; keep });
        }
        if let Some(xml) = xml {
            let mut text = b"XML:com.adobe.xmp\0\0\0\0\0".to_vec(); text.extend_from_slice(xml.as_bytes());
            let last = image.chunks().iter().position(|c| c.kind() == *b"IEND").context("PNG has no IEND")?;
            image.chunks_mut().insert(last, PngChunk::new(*b"iTXt", text.into()));
        }
        fs::write(path, image.encoder().bytes())?;
    }
    Ok(vec!["XMP was rewritten without decoding pixels. EXIF orientation and color-related blocks are retained. This does not remove image watermarks or guarantee all private data is gone.".into()])
}
pub fn payload_hash(path: &Path) -> Result<String> {
    let data = bytes(path)?; let mut hasher = blake3::Hasher::new();
    if data.starts_with(b"RIFF") { return Ok(blake3::hash(&data).to_hex().to_string()); }
    if data.starts_with(b"\xff\xd8") {
        let mut image = Jpeg::from_bytes(data.into())?;
        hasher.update(&orientation(image.exif().as_deref())?.to_le_bytes());
        image.segments_mut().retain(|s| !description_segment(s));
        hasher.update(&image.encoder().bytes());
    } else {
        let mut image = Png::from_bytes(data.into())?;
        hasher.update(&orientation(image.exif().as_deref())?.to_le_bytes());
        image.chunks_mut().retain(|c| !text_chunk(c.kind()));
        hasher.update(&image.encoder().bytes());
    }
    Ok(hasher.finalize().to_hex().to_string())
}
pub fn privacy_payload_hash(path: &Path) -> Result<String> {
    let cleaned = image_privacy::clean(&bytes(path)?)?;
    Ok(blake3::hash(&cleaned.bytes).to_hex().to_string())
}
pub fn verify_privacy(path: &Path) -> Result<()> {
    let scan = image_privacy::clean(&bytes(path)?)?;
    if !scan.report.is_clean() {
        bail!("Privacy verification failed: {} removable blocks and {} trailing bytes remain. No output was committed.",
            scan.report.removable_blocks, scan.report.trailing_bytes);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn orientation_survives_minimal_exif() {
        for n in 1..=8 { assert_eq!(orientation(Some(&minimal_exif(n))).unwrap(), n); }
    }
    #[test] fn malformed_exif_is_not_treated_as_upright() { assert!(orientation(Some(b"bad")).is_err()); }
    #[test] fn preserves_icc_and_png_rendering_chunks() {
        for kind in [*b"iCCP", *b"gAMA", *b"sRGB", *b"tRNS", *b"cHRM", *b"IDAT", *b"fdAT"] { assert!(!text_chunk(kind)); }
        assert!(text_chunk(*b"tEXt"));
    }
}
