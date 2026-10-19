mod model; mod audio; mod images; mod image_privacy; mod xmp; mod tools; mod video; mod transaction; mod formats; mod extended; mod documents; mod evidence; mod scan;
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use serde_json::{json,Value};
use std::{io::{self,BufRead,Write},path::Path};
#[derive(Deserialize)] #[serde(deny_unknown_fields)] struct Request{id:Value,method:String,#[serde(default)]params:Value}
fn string<'a>(v:&'a Value,k:&str)->Result<&'a str>{v[k].as_str().with_context(||format!("Missing string: {k}"))}
fn dispatch(method:&str,p:Value)->Result<Value>{if matches!(method,"save"|"restore")&&std::env::var("KI_READ_ONLY").as_deref()==Ok("1"){bail!("KI_READ_ONLY=1 blocks native file edits and restoration");}match method{
    "doctor"=>Ok(json!({"version":env!("CARGO_PKG_VERSION"),"ffmpeg":tools::status("ffmpeg"),"ffprobe":tools::status("ffprobe"),"data_dir":transaction::data_dir(),"native_audio":true,"native_images":true,"native_documents":true,"exiftool":tools::status("exiftool"),"formats":{"audio":formats::AUDIO,"images":formats::IMAGES,"extended_images":formats::EXTENDED_IMAGES,"video":formats::VIDEO,"office":formats::OFFICE,"opendocument":formats::OPENDOCUMENT,"documents":["pdf"],"other":"inspection"}})),
    "inspect"=>Ok(serde_json::to_value(transaction::inspect(Path::new(string(&p,"path")?))?)?),
    "inventory"=>Ok(serde_json::to_value(transaction::inventory(Path::new(string(&p,"path")?))?)?),
    "save"=>Ok(serde_json::to_value(transaction::save(serde_json::from_value(p)?)?)?),
    "history"=>Ok(serde_json::to_value(transaction::history()?)?),
    "restore"=>Ok(serde_json::to_value(transaction::restore(Path::new(string(&p,"journal")?))?)?),
    "export_artwork"=>{let index=p["index"].as_u64().context("Missing artwork index")? as usize;transaction::export_artwork(Path::new(string(&p,"path")?),index,Path::new(string(&p,"output")?))?;Ok(json!(true))},
    _=>bail!("Unknown method: {method}")}}
fn serve()->Result<()> {
    let mut input=io::stdin().lock();let mut output=io::stdout().lock();let mut buffer=Vec::new();
    loop {buffer.clear();let mut oversized=false;
        loop {let available=input.fill_buf()?;if available.is_empty(){break}let take=available.iter().position(|b|*b==b'\n').map(|n|n+1).unwrap_or(available.len());
            if buffer.len()+take<=16*1024*1024{buffer.extend_from_slice(&available[..take]);}else{oversized=true}
            let done=available[take-1]==b'\n';input.consume(take);if done{break}}
        if buffer.is_empty()&&!oversized{break}
        let response=if oversized{json!({"id":null,"error":"Request exceeds 16 MiB"})}else{match serde_json::from_slice::<Request>(&buffer){
            Ok(r)=>match std::panic::catch_unwind(std::panic::AssertUnwindSafe(||dispatch(&r.method,r.params))){Ok(Ok(result))=>json!({"id":r.id,"result":result}),Ok(Err(e))=>json!({"id":r.id,"error":format!("{e:#}")}),Err(_)=>json!({"id":r.id,"error":"Native parser failed. No successful commit is being reported; inspect the file and history before retrying."})},
            Err(e)=>json!({"id":null,"error":format!("Invalid request: {e}")})}};
        serde_json::to_writer(&mut output,&response)?;writeln!(&mut output)?;output.flush()?;
    }Ok(())
}
fn run()->Result<()> {let args:Vec<String>=std::env::args().collect();match args.get(1).map(String::as_str){
    Some("--version")|Some("version")=>{println!("ki-meta {}",env!("CARGO_PKG_VERSION"));Ok(())},
    Some("--help")|Some("help")=>{println!("KI Metadata Workbench {}\n\nki-meta inspect <file>\nki-meta inventory <file>\nki-meta scan [--recursive] [--full] [--include-paths] [--] <file-or-folder> ...\nki-meta request <request.json>\nki-meta doctor\nki-meta serve\n\ninventory returns read-only fingerprints even when metadata parsing fails. inspect preserves strict parser errors.\n\nscan writes one JSON record per file to stdout and diagnostics to stderr. It does not change source files. Default scan rows omit paths and metadata values; --full includes the complete inspection, including paths and values. Folders skip links and hidden directories. Maximum 1,000 files / 10,000 directory entries.\n",env!("CARGO_PKG_VERSION"));Ok(())},
    Some("scan")=>scan::run(&args[2..]),
    Some("inventory")=>{let path=args.get(2).context("Usage: ki-meta inventory <file>")?;println!("{}",serde_json::to_string_pretty(&dispatch("inventory",json!({"path":path}))?)?);Ok(())},
    None|Some("serve")=>serve(),Some("doctor")=>{println!("{}",serde_json::to_string_pretty(&dispatch("doctor",Value::Null)?)?);Ok(())},
    Some("inspect")=>{let path=args.get(2).context("Usage: ki-meta inspect <file>")?;println!("{}",serde_json::to_string_pretty(&dispatch("inspect",json!({"path":path}))?)?);Ok(())},
    Some("request")=>{let path=args.get(2).context("Usage: ki-meta request <request.json>")?;let req:Request=serde_json::from_slice(&std::fs::read(path)?)?;println!("{}",serde_json::to_string_pretty(&dispatch(&req.method,req.params)?)?);Ok(())},
    _=>bail!("Usage: ki-meta [serve | doctor | inspect <file> | scan [options] <paths...> | request <request.json> | --help]")}}
fn main(){if let Err(e)=run(){eprintln!("{e:#}");std::process::exit(1)}}
