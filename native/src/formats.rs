//! File families are explicit. Other files still receive a read-only inventory.
pub const AUDIO: &[&str] = &["mp3","flac","wav","wave","aif","aiff","aifc","m4a","m4b","ogg","oga","opus"];
pub const IMAGES: &[&str] = &["jpg","jpeg","png","apng","webp"];
pub const EXTENDED_IMAGES: &[&str] = &["tif","tiff","heic","heif","hif","avif","jxl","dng","nef","nrw","arw","cr2","cr3","orf","rw2","pef","srw","raf","rwl","mos","mrw","iiq","3fr","mef","erf","kdc","dcr","sr2","srf","x3f","jp2","jpx","psd","psb","gif"];
pub const VIDEO: &[&str] = &["mp4","mov","m4v","mkv","webm","avi","wmv","asf"];
pub const OFFICE: &[&str] = &["docx","docm","dotx","dotm","xlsx","xlsm","xltx","xltm","pptx","pptm","potx","potm","ppsx","ppsm"];
pub const OPENDOCUMENT: &[&str] = &["odt","ods","odp","odg","odf","ott","ots","otp","otg"];
pub fn kind(ext: &str) -> &'static str {
    if AUDIO.contains(&ext) { "audio" }
    else if IMAGES.contains(&ext) || EXTENDED_IMAGES.contains(&ext) { "image" }
    else if VIDEO.contains(&ext) { "video" }
    else if ext == "pdf" || OFFICE.contains(&ext) || OPENDOCUMENT.contains(&ext) { "document" }
    else { "other" }
}
