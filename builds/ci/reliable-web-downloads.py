"""Allow slow upstream downloads and reject HTTP error pages in EasyRPG CI."""
from pathlib import Path
import sys

common = Path(sys.argv[1]) / "shared" / "common.sh"
source = common.read_text()
replacements = {
    'curl --fail -sSLOR -y3 -Y102400 --connect-timeout 3 $url':
        'curl --fail --retry 5 --retry-all-errors --retry-delay 2 -sSLOR '
        '--connect-timeout 20 --max-time 600 "$url"',
    'curl -sSLOR https://easyrpg.org/downloads/sources/$file':
        'curl --fail --retry 5 --retry-all-errors --retry-delay 2 -sSLOR '
        '--connect-timeout 20 --max-time 600 "https://easyrpg.org/downloads/sources/$file"',
}
for original, replacement in replacements.items():
    if original not in source:
        raise SystemExit("EasyRPG downloader changed; review the pinned CI patch.")
    source = source.replace(original, replacement)
common.write_text(source)

# The zlib website can serve a successful HTML response to hosted runners.
# Use the identical archive published by zlib's maintainer on GitHub.
packages = common.parent / "packages.sh"
source = packages.read_text()
original = 'https://zlib.net/fossils/zlib-1.3.2.tar.gz'
if original not in source:
    raise SystemExit("Pinned zlib URL changed; review the CI mirror.")
packages.write_text(source.replace(original,
    'https://github.com/madler/zlib/releases/download/v1.3.2/zlib-1.3.2.tar.gz'))
