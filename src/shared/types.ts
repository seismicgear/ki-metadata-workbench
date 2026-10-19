export type Kind = 'audio' | 'image' | 'video' | 'document' | 'other';
export type Policy = 'keep' | 'clear_descriptive' | 'privacy' | 'strip_metadata';
export interface ImagePrivacy { removable_blocks: number; categories: string[]; trailing_bytes: number; exif_orientation: number | null; color_profiles: number }
export interface RawField { namespace: string; key: string; value: string; writable: boolean }
export interface Artwork { index: number; kind: string; mime: string; bytes: number; description: string; data_url: string | null }
export interface Capabilities { fields: string[]; artwork: boolean; raw_edit: boolean; policies: Policy[]; writer: string }
export interface Evidence {sha256:string;blake3:string;bytes_hashed:number;header_hex:string;detected_type:string|null;mime_type:string|null;extension_status:'compatible'|'mismatch'|'unknown';scope:string}
export interface SessionState {read_only:boolean;locked:boolean}
export interface Inspection {
  path: string; name: string; kind: Kind; format: string; size: number; etag: string;
  fields: Record<string, string>; raw: RawField[]; artwork: Artwork[];
  properties: Record<string, unknown> & { image_privacy?: ImagePrivacy; evidence?:Evidence }; warnings: string[]; capabilities: Capabilities;
}
export interface RawEdit { namespace: string; key: string; value: string | null }
export type ArtworkEdit = { action: 'keep' } | { action: 'remove' } | { action: 'replace'; path: string };
export interface Patch { fields: Record<string, string | null>; raw: RawEdit[]; policy: Policy; artwork: ArtworkEdit }
export interface Verification { status: 'matched' | 'metadata_only' | 'unverified'; method: string; before: string | null; after: string | null; detail: string }
export interface SaveRequest {
  path: string; expected_etag: string; patch: Patch; replace_original: boolean;
  allow_unverified: boolean; accept_remux: boolean; batch_token?: string;
}
export interface SaveResult {
  saved_at_ms?: number | null;
  output: string; backup: string | null; journal: string | null; verification: Verification;
  before: Inspection; after: Inspection; warnings: string[];
}
export interface Preset { id: string; name: string; fields: Record<string, string>; policy: Policy; builtin?: boolean }
export interface ToolStatus { available: boolean; version: string; error?: string }
export interface Doctor { version: string; ffmpeg: ToolStatus; ffprobe: ToolStatus; exiftool: ToolStatus; native_documents: boolean; formats?: Record<string,string[]|string>; data_dir: string; native_audio: boolean; native_images: boolean }
export interface PickResult { paths: string[]; warnings: string[] }
export interface Bridge {
  sessionState():Promise<SessionState>;
  setReadOnly(value:boolean):Promise<SessionState>;
  launchFiles():Promise<PickResult>;
  onOpenFiles(callback:(pick:PickResult)=>void):void;
  onSession(callback:(state:SessionState)=>void):void;
  pickFiles(folder?: boolean): Promise<PickResult>;
  dropped(files: File[]): Promise<PickResult>;
  inspect(path: string): Promise<Inspection>;
  save(request: SaveRequest): Promise<SaveResult | null>;
  preview(path: string): Promise<string>;
  pickArtwork(): Promise<string | null>;
  exportArtwork(path: string, index: number): Promise<string | null>;
  exportJson(data: unknown, suggested: string): Promise<string | null>;
  exportReport(data:unknown,format:'json'|'csv',suggested:string):Promise<string|null>;
  chooseExportFolder(options?: {neutral_names:boolean}): Promise<string|null>;
  releaseExportFolder(token:string): Promise<void>;
  importPresets(): Promise<Preset[]|null>;
  exportPresets(): Promise<string|null>;
  presets(): Promise<Preset[]>;
  savePreset(preset: Preset): Promise<Preset[]>;
  deletePreset(id: string): Promise<Preset[]>;
  doctor(): Promise<Doctor>;
  chooseTool(tool: 'ffmpeg' | 'ffprobe' | 'exiftool'): Promise<Doctor | null>;
  reveal(path: string): Promise<void>;
  history(): Promise<SaveResult[]>;
  restore(journal: string): Promise<Inspection | null>;
  setDirty(dirty: boolean): void;
  onMenu(callback: (action: string) => void): void;
}
declare global { interface Window { ki: Bridge; KI_PREVIEW?: boolean } }
