//! Read-only file identity. Signatures identify a container, never validate its contents.
use anyhow::Result;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

struct Signature { name: &'static str, mime: &'static str, extensions: &'static [&'static str] }
fn signature(h: &[u8]) -> Option<Signature> {
    let s = |name, mime, extensions| Some(Signature { name, mime, extensions });
    if h.starts_with(b"\x89PNG\r\n\x1a\n") { return s("PNG", "image/png", &["png", "apng"]); }
    if h.starts_with(b"\xff\xd8\xff") { return s("JPEG", "image/jpeg", &["jpg", "jpeg", "jpe"]); }
    if h.starts_with(b"GIF87a") || h.starts_with(b"GIF89a") { return s("GIF", "image/gif", &["gif"]); }
    if h.starts_with(b"RIFF") && h.len() >= 12 {
        return match &h[8..12] {
            b"WEBP" => s("WebP", "image/webp", &["webp"]),
            b"WAVE" => s("WAVE", "audio/wav", &["wav", "wave"]),
            b"AVI " => s("AVI", "video/x-msvideo", &["avi"]),
            _ => None,
        };
    }
    if h.starts_with(b"fLaC") { return s("FLAC", "audio/flac", &["flac"]); }
    if h.starts_with(b"FORM") && h.len() >= 12 && [&b"AIFF"[..], &b"AIFC"[..]].contains(&&h[8..12]) { return s("AIFF", "audio/aiff", &["aif", "aiff", "aifc"]); }
    if h.starts_with(b"OggS") { return s("Ogg", "application/ogg", &["ogg", "oga", "ogv", "opus", "spx"]); }
    if h.starts_with(b"ID3") || (h.len() > 1 && h[0] == 0xff && h[1] & 0xe0 == 0xe0 && (h[1] >> 1) & 3 != 0) { return s("MPEG audio", "audio/mpeg", &["mp3", "mp2", "mp1"]); }
    if h.starts_with(b"%PDF-") { return s("PDF", "application/pdf", &["pdf"]); }
    if h.starts_with(b"PK\x03\x04") || h.starts_with(b"PK\x05\x06") || h.starts_with(b"PK\x07\x08") { return s("ZIP package", "application/zip", &["zip", "docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "odt", "ods", "odp", "odg", "odf", "ott", "ots", "otp", "otg", "epub", "jar", "apk"]); }
    if h.starts_with(b"II*\0") || h.starts_with(b"MM\0*") || h.starts_with(b"II+\0") || h.starts_with(b"MM\0+") { return s("TIFF / camera RAW", "image/tiff", &["tif", "tiff", "dng", "nef", "nrw", "arw", "cr2", "orf", "rw2", "pef", "srw", "rwl", "mos", "mrw", "iiq", "3fr", "mef", "erf", "kdc", "dcr", "sr2", "srf"]); }
    if h.starts_with(b"\0\0\0\x0cJXL \r\n\x87\n") || h.starts_with(b"\xff\x0a") { return s("JPEG XL", "image/jxl", &["jxl"]); }
    if h.starts_with(b"\0\0\0\x0cjP  \r\n\x87\n") { return s("JPEG 2000", "image/jp2", &["jp2", "jpx", "jpf"]); }
    if h.starts_with(b"8BPS") { return s("Photoshop", "image/vnd.adobe.photoshop", &["psd", "psb"]); }
    if h.starts_with(b"FUJIFILMCCD-RAW") { return s("Fujifilm RAW", "image/x-fuji-raf", &["raf"]); }
    if h.starts_with(b"FOVb") { return s("Sigma X3F", "image/x-sigma-x3f", &["x3f"]); }
    if h.len() >= 12 && &h[4..8] == b"ftyp" {
        return match &h[8..12] {
            b"avif" | b"avis" => s("AVIF", "image/avif", &["avif"]),
            b"heic" | b"heix" | b"hevc" | b"hevx" | b"mif1" | b"msf1" => s("HEIF / ISO media", "image/heif", &["heic", "heif", "hif", "avif"]),
            b"crx " => s("Canon CR3", "image/x-canon-cr3", &["cr3"]),
            _ => s("ISO base media", "video/mp4", &["mp4", "mov", "m4v", "m4a", "m4b", "3gp", "3g2", "heic", "heif", "hif", "avif"]),
        };
    }
    if h.starts_with(b"\x1aE\xdf\xa3") { return s("Matroska / WebM", "video/x-matroska", &["mkv", "webm", "mka", "mks"]); }
    if h.starts_with(b"\x30\x26\xb2\x75\x8e\x66\xcf\x11\xa6\xd9\0\xaa\0\x62\xce\x6c") { return s("ASF", "video/x-ms-asf", &["asf", "wmv", "wma"]); }
    if h.starts_with(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") { return s("OLE compound document", "application/x-ole-storage", &["doc", "xls", "ppt", "msg", "msi", "vsd", "docx", "xlsx", "pptx", "docm", "xlsm", "pptm"]); }
    if h.starts_with(b"7z\xbc\xaf\x27\x1c") { return s("7-Zip", "application/x-7z-compressed", &["7z"]); }
    if h.starts_with(b"Rar!\x1a\x07") { return s("RAR", "application/vnd.rar", &["rar"]); }
    if h.starts_with(b"\x1f\x8b") { return s("Gzip", "application/gzip", &["gz", "tgz", "svgz"]); }
    if h.starts_with(b"MZ") { return s("DOS / PE executable", "application/vnd.microsoft.portable-executable", &["exe", "dll", "sys", "scr", "cpl", "ocx"]); }
    if h.starts_with(b"\x7fELF") { return s("ELF executable", "application/x-elf", &["elf", "so", "bin", ""]); }
    None
}

pub fn fingerprint(path: &Path) -> Result<Value> {
    let mut file = File::open(path)?;
    let mut blake = blake3::Hasher::new();
    let mut sha = Sha256::new();
    let mut buffer = [0; 65536];
    let mut header = Vec::new();
    let mut bytes = 0u64;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 { break; }
        if header.is_empty() { header.extend_from_slice(&buffer[..count.min(64)]); }
        blake.update(&buffer[..count]); sha.update(&buffer[..count]); bytes += count as u64;
    }
    let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    let detected = signature(&header);
    let status = detected.as_ref().map(|s| if s.extensions.contains(&extension.as_str()) { "compatible" } else if extension.is_empty() { "unknown" } else { "mismatch" }).unwrap_or("unknown");
    Ok(json!({
        "sha256": sha.finalize().iter().map(|b|format!("{b:02x}")).collect::<String>(), "blake3": blake.finalize().to_hex().to_string(),
        "bytes_hashed": bytes, "header_hex": header.iter().take(32).map(|b|format!("{b:02x}")).collect::<Vec<_>>().join(" "),
        "detected_type": detected.as_ref().map(|s|s.name), "mime_type": detected.as_ref().map(|s|s.mime),
        "extension_status": status,
        "scope": "Full-file fingerprints and leading-byte signature. This is not a malware scan, authenticity check or complete format validator."
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn known_sha256_and_blake3() {
        let f = tempfile::NamedTempFile::new().unwrap(); std::fs::write(f.path(), b"abc").unwrap();
        let e = fingerprint(f.path()).unwrap();
        assert_eq!(e["sha256"], "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(e["blake3"], blake3::hash(b"abc").to_hex().to_string());
        assert_eq!(e["bytes_hashed"], 3); assert_eq!(e["header_hex"], "61 62 63");
    }
    #[test] fn mismatched_extension_is_detected() {
        let dir = tempfile::tempdir().unwrap(); let p = dir.path().join("photo.jpg");
        std::fs::write(&p, b"MZexample").unwrap();
        let e = fingerprint(&p).unwrap(); assert_eq!(e["extension_status"], "mismatch"); assert_eq!(e["detected_type"], "DOS / PE executable");
    }
    #[test] fn office_container_does_not_claim_docx_validation() {
        let dir = tempfile::tempdir().unwrap(); let p = dir.path().join("file.docx"); std::fs::write(&p, b"PK\x03\x04").unwrap();
        let e = fingerprint(&p).unwrap(); assert_eq!(e["detected_type"], "ZIP package"); assert_eq!(e["extension_status"], "compatible");
    }
    #[test] fn short_headers_do_not_panic() { for n in 0..12 { let _ = signature(&vec![0xff; n]); } }
}
