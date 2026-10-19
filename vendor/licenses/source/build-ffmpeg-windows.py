from pathlib import Path
import subprocess,os
root=Path(__file__).resolve().parent
src=root/'ffmpeg-9.0.2'; out=root/'ffmpeg-windows'; out.mkdir(exist_ok=True)
mingw=root.parent/'mingw/usr/bin'
env=dict(os.environ);env['PATH']=str(mingw)+os.pathsep+env['PATH']
args=[str(src/'configure'),'--prefix='+str(out/'install'),'--target-os=mingw32','--arch=x86_64','--enable-cross-compile','--cross-prefix='+str(mingw/'x86_64-w64-mingw32-'),'--cc='+str(mingw/'x86_64-w64-mingw32-gcc-posix'),'--windres='+str(root/'windres-ki'),'--disable-everything','--enable-protocol=file,pipe','--enable-demuxers','--enable-muxers','--enable-parsers','--enable-bsfs','--enable-decoder=pcm_s16le,mp3,flac,aac,vorbis,opus,mjpeg,h264,hevc,vp8,vp9,av1','--enable-filter=aformat,anull,format,null','--enable-avfilter','--enable-ffmpeg','--enable-ffprobe','--disable-network','--disable-gpl','--disable-nonfree','--disable-doc','--disable-debug','--disable-autodetect','--disable-x86asm','--disable-avdevice','--disable-ffplay','--disable-shared','--enable-static','--extra-ldflags=-static']
(root/'ffmpeg-configure.json').write_text(__import__('json').dumps(args,indent=2))
with (root/'ffmpeg-build.log').open('w') as log:
 subprocess.run(args,cwd=out,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
 subprocess.run(['make','-j4'],cwd=out,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
 subprocess.run(['make','install'],cwd=out,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
print('Windows FFmpeg and ffprobe built from source.',flush=True)
