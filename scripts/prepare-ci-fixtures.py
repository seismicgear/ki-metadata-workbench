from pathlib import Path
import hashlib, os, tarfile
root = Path(__file__).resolve().parents[1]
archive = root / 'vendor/licenses/source/Image-ExifTool-13.59.tar.gz'
expected = '668ea3acececb7235fbd0f4900e72d5f12c9b07e5c778fd36cb1e9b5828fd65a'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected, 'Upstream fixture archive changed'
destination = root / '.tmp/exiftool-fixtures'
destination.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive) as source:
    members = [m for m in source.getmembers() if m.name.startswith('Image-ExifTool-13.59/t/images/')]
    assert members
    source.extractall(destination, members=members, filter='data')
fixtures = destination / 'Image-ExifTool-13.59/t/images'
assert (fixtures / 'ExifTool.tif').is_file()
with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as stream:
    stream.write('KI_EXIFTOOL_FIXTURES=' + str(fixtures) + '\n')
print('The verified upstream ExifTool image fixtures are available for Windows qualification.')
