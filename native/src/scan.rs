//! Bounded, read-only JSONL inventory for scripts and incident-review workflows.
use anyhow::{bail, Context, Result};
use serde_json::json;
use std::{collections::HashSet, fs, io::{self,Write}, path::PathBuf};

pub fn run(args:&[String])->Result<()> {
    let mut recursive=false;let mut full=false;let mut paths=false;let mut literal=false;let mut queue=Vec::new();
    for arg in args {match arg.as_str() {
        "--" if !literal=>literal=true,
        "--recursive" if !literal=>recursive=true,
        "--full" if !literal=>full=true,
        "--include-paths" if !literal=>paths=true,
        value if !literal&&value.starts_with('-')=>bail!("Unknown scan option: {value}"),
        value=>queue.push(PathBuf::from(value)),
    }}
    if queue.is_empty(){bail!("Usage: ki-meta scan [--recursive] [--full] [--include-paths] [--] <file-or-folder> ...")}
    let mut output=io::stdout().lock();let mut seen=HashSet::new();let mut files=0usize;let mut visited=0usize;let mut errors=0usize;let mut skipped=0usize;
    queue.reverse();
    while let Some(path)=queue.pop(){
        visited+=1;if files>=1000||visited>10000 {bail!("Scan limit reached: 1,000 files / 10,000 entries. Earlier JSONL rows are complete.")}
        let meta=match fs::symlink_metadata(&path){Ok(m)=>m,Err(e)=>{errors+=1;eprintln!("{}: {e}",path.display());continue;}};
        if meta.file_type().is_symlink(){skipped+=1;continue;}
        if meta.is_dir(){
            if !recursive {bail!("Directory input requires --recursive: {}",path.display());}
            if path.file_name().and_then(|s|s.to_str()).map(|s|s.starts_with('.')).unwrap_or(false){skipped+=1;continue;}
            let mut children=fs::read_dir(&path).with_context(||format!("Could not read {}",path.display()))?.take(10001).map(|r|r.map(|e|e.path())).collect::<std::io::Result<Vec<_>>>()?;
            if children.len()>10000||queue.len()+children.len()>10000{bail!("Scan directory queue exceeds 10,000 entries. Scan smaller folders separately.");}
            children.sort();children.reverse();queue.extend(children);continue;
        }
        if !meta.is_file(){skipped+=1;continue;}
        let canonical=fs::canonicalize(&path)?;if !seen.insert(canonical.clone()){continue;}
        files+=1;
        let row=match crate::transaction::inventory(&canonical){
            Ok(doc)=>{
                let mut row=json!({"schema":"industries.kuykendall.metadata.scan","schema_version":1,"file_id":format!("FILE-{files:04}"),"kind":doc.kind,"format":doc.format,"bytes":doc.size,"sha256":doc.properties["evidence"]["sha256"],"blake3":doc.etag,"signature":doc.properties["evidence"]["detected_type"],"extension_status":doc.properties["evidence"]["extension_status"],"metadata_count":doc.raw.len(),"warning_count":doc.warnings.len(),"writer":doc.capabilities.writer,"policies":doc.capabilities.policies});
                if paths{row["path"]=json!(doc.path);row["name"]=json!(doc.name);}
                if full{row["inspection"]=serde_json::to_value(doc)?;}row
            },
            Err(e)=>{errors+=1;eprintln!("{}: {e:#}",canonical.display());let mut row=json!({"schema":"industries.kuykendall.metadata.scan","schema_version":1,"file_id":format!("FILE-{files:04}"),"error":"Inspection failed; see stderr."});if paths{row["path"]=json!(canonical);}row}
        };
        serde_json::to_writer(&mut output,&row)?;writeln!(output)?;output.flush()?;
    }
    eprintln!("Scanned {files} file(s); {errors} error(s); {skipped} link, hidden-directory or special-file entry/entries skipped. Source files were not edited.");
    if errors>0 {bail!("Some files could not be inspected. Successful JSONL rows remain valid.");}
    Ok(())
}

