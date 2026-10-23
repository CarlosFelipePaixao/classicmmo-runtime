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
