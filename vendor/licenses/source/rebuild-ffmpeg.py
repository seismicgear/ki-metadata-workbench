"""Build the supplied unmodified FFmpeg source for Windows x64 with MinGW."""
from pathlib import Path
import argparse
import json
import os
import shlex
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--cross-prefix', default='x86_64-w64-mingw32-')
parser.add_argument('--cc')
parser.add_argument('--jobs', type=int, default=4)
args = parser.parse_args()
source, output = args.source.resolve(), args.output.resolve()
if not (source / 'configure').is_file():
    parser.error('--source must contain the extracted FFmpeg configure script')
if args.jobs < 1:
    parser.error('--jobs must be positive')
output.mkdir(parents=True, exist_ok=True)
compiler = args.cc or args.cross_prefix + 'gcc'
cpp, windres = output / 'cpp-ki', output / 'windres-ki'
cpp.write_text('#!/bin/sh\nexec ' + shlex.quote(compiler) + ' -E -xc -DRC_INVOKED "$@"\n')
windres.write_text('#!/bin/sh\nexec ' + shlex.quote(args.cross_prefix + 'windres') + ' --preprocessor=' + shlex.quote(str(cpp)) + ' "$@"\n')
cpp.chmod(0o755)
windres.chmod(0o755)
command = [str(source / 'configure'), '--prefix=' + str(output / 'install'),
    '--target-os=mingw32', '--arch=x86_64', '--enable-cross-compile',
    '--cross-prefix=' + args.cross_prefix, '--cc=' + compiler, '--windres=' + str(windres),
    '--disable-everything', '--enable-protocol=file,pipe', '--enable-demuxers',
    '--enable-muxers', '--enable-parsers', '--enable-bsfs',
    '--enable-decoder=pcm_s16le,mp3,flac,aac,vorbis,opus,mjpeg,h264,hevc,vp8,vp9,av1',
    '--enable-filter=aformat,anull,format,null', '--enable-avfilter',
    '--enable-ffmpeg', '--enable-ffprobe', '--disable-network', '--disable-gpl',
    '--disable-nonfree', '--disable-doc', '--disable-debug', '--disable-autodetect',
    '--disable-x86asm', '--disable-avdevice', '--disable-ffplay',
    '--disable-shared', '--enable-static', '--extra-ldflags=-static']
(output / 'configure-command.json').write_text(json.dumps(command, indent=2) + '\n')
with (output / 'build.log').open('w') as log:
    subprocess.run(command, cwd=output, stdout=log, stderr=subprocess.STDOUT, check=True)
    subprocess.run(['make', '-j' + str(args.jobs)], cwd=output, stdout=log, stderr=subprocess.STDOUT, check=True)
    subprocess.run(['make', 'install'], cwd=output, stdout=log, stderr=subprocess.STDOUT, check=True)
print('Built media engines in', output / 'install/bin')
