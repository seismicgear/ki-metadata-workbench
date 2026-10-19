use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{io::Read, path::Path, process::{Command, Stdio}, thread, time::Duration};
use wait_timeout::ChildExt;

pub fn executable(name: &str) -> String {
    let var = match name { "ffmpeg" => "KI_FFMPEG", "ffprobe" => "KI_FFPROBE", "exiftool" => "KI_EXIFTOOL", _ => "KI_UNKNOWN_TOOL" };
    std::env::var(var).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| {
        // The standalone CLI resolves the same bundled engines as the desktop app.
        let filename=format!("{name}{}",if cfg!(windows){".exe"}else{""});
        if let Some(dir)=std::env::current_exe().ok().and_then(|p|p.parent().map(Path::to_path_buf)) {
            let candidate=if name=="exiftool"{dir.join("exiftool").join(&filename)}else{dir.join(&filename)};
            if candidate.is_file(){return candidate.to_string_lossy().into_owned();}
        }
        name.to_string()
    })
}
fn read_bounded(mut reader: impl Read, maximum: u64) -> (Vec<u8>, bool) {
    let mut bytes = Vec::new(); let mut buf = [0u8; 8192]; let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let remaining = maximum.saturating_sub(bytes.len() as u64) as usize;
                bytes.extend_from_slice(&buf[..n.min(remaining)]);
                if n > remaining { truncated = true; }
            }
        }
    }
    (bytes, truncated)
}
pub fn run(name: &str, args: &[String], timeout: u64) -> Result<Vec<u8>> {
    let mut command = Command::new(executable(name));
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW, no shell involved.
    }
    let mut child = command.spawn().with_context(|| format!("{name} is unavailable. Configure its executable in Tools, or add it to PATH."))?;
    let out = child.stdout.take().context("Missing stdout pipe")?;
    let err = child.stderr.take().context("Missing stderr pipe")?;
    let stdout_thread = thread::spawn(move || read_bounded(out, 16 * 1024 * 1024));
    let stderr_thread = thread::spawn(move || read_bounded(err, 2 * 1024 * 1024));
    let status = child.wait_timeout(Duration::from_secs(timeout))?;
    if status.is_none() { let _ = child.kill(); let _ = child.wait(); }
    let (stdout, truncated) = stdout_thread.join().unwrap_or_default();
    let (stderr, _) = stderr_thread.join().unwrap_or_default();
    let status = status.context("Media tool timed out; the staged file was not committed")?;
    if !status.success() { bail!("{name} failed: {}", String::from_utf8_lossy(&stderr)); }
    if truncated { bail!("{name} output exceeds the inspection limit"); }
    Ok(stdout)
}
pub fn status(name: &str) -> Value {
    let args = if name == "exiftool" { vec!["-config".into(), "".into(), "-ver".into()] } else { vec!["-version".into()] };
    match run(name, &args, 10) {
        Ok(data) => json!({"available": true, "version": String::from_utf8_lossy(&data).lines().next().unwrap_or("")}),
        Err(error) => json!({"available": false, "version": "", "error": error.to_string()}),
    }
}
pub fn probe(path: &Path) -> Result<Value> {
    let data = run("ffprobe", &[
        "-protocol_whitelist".into(), "file,pipe".into(), "-format_whitelist".into(), "mov,matroska,webm,avi,asf,mp3,flac,wav,aiff,ogg".into(), "-v".into(), "error".into(), "-show_format".into(), "-show_streams".into(),
        "-show_chapters".into(), "-show_data_hash".into(), "sha256".into(),
        "-of".into(), "json".into(), "-i".into(), path.to_string_lossy().into_owned(),
    ], 120)?;
    serde_json::from_slice(&data).context("Invalid ffprobe JSON")
}
/// Hashes demuxed packet payloads only. This is deliberately not called a
/// decoded-picture, timing, watermark or render-equivalence verification.
pub fn stream_hashes(path: &Path) -> Result<String> {
    let data = run("ffmpeg", &[
        "-protocol_whitelist".into(), "file,pipe".into(), "-format_whitelist".into(), "mov,matroska,webm,avi,asf,mp3,flac,wav,aiff,ogg".into(), "-v".into(), "error".into(), "-nostdin".into(), "-i".into(), path.to_string_lossy().into_owned(),
        "-map".into(), "0:a?".into(), "-map".into(), "0:V?".into(),
        "-c".into(), "copy".into(), "-f".into(), "streamhash".into(),
        "-hash".into(), "sha256".into(), "-".into(),
    ], 900)?;
    let text = String::from_utf8(data)?;
    let lines: Vec<_> = text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).collect();
    if lines.is_empty() { bail!("No audio/video packet hashes were produced"); }
    Ok(lines.join("\n"))
}
